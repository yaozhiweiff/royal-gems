import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { handleApi } from '../backend/api';
import { sqliteDatabase } from '../backend/sqlite.mjs';
import { findMove } from '../src/engine';
import { LocalRun } from '../src/local-run';
const origin = 'https://example.github.io';
function fixture() {
  const db = sqliteDatabase(':memory:'); db.exec(readFileSync('backend/migrations/0001_online.sql', 'utf8'));
  const call = async (path: string, token = 'a'.repeat(64), data?: unknown, requestOrigin = origin) => {
    const response = await handleApi(new Request(`https://game.test/api${path}`, { method: data === undefined ? 'GET' : 'POST', headers: { Authorization: `Device ${token}`, Origin: requestOrigin, 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) }), db, origin);
    return { status: response.status, data: await response.json() as any };
  }; return { db, call };
}
describe('online identity and authoritative leaderboards', () => {
  it('plays a complete challenge locally, then submits its action log once with idempotent ranking', async () => {
    const { db, call } = fixture(); await call('/register', undefined, { name: '本地即时' });
    const started = (await call('/runs', undefined, { mode: 'challenge', character: 'ian' })).data;
    const run = new LocalRun(started.runId, started.seed, 'challenge', 'ian');
    expect(run.matches(started.state)).toBe(true);
    for (let i = 0; i < 30; i++) { const pair = findMove(run.game.state.board)!; expect(run.move(...pair).frames.length).toBeGreaterThan(0); }
    expect((await call('/leaderboards?mode=challenge')).data.entries).toHaveLength(0);
    const report = run.completion();
    const result = await call(`/runs/${report.runId}/complete`, undefined, { actions: report.actions, score: 999999999, character: 'beth' });
    expect(result.status).toBe(200); expect(result.data.state).toEqual(run.game.snapshot());
    expect(result.data.bests.challenge).toBe(run.game.state.score);
    expect((await call(`/runs/${report.runId}/complete`, undefined, { actions: report.actions })).data).toEqual(result.data);
    const entries = (await call('/leaderboards?mode=challenge')).data.entries;
    expect(entries).toHaveLength(1); expect(entries[0]).toMatchObject({ value: run.game.state.score, character: 'ian' });
    expect((await call(`/runs/${report.runId}/complete`, undefined, { actions: report.actions.slice(1) })).status).toBe(409);
    db.close();
  });
  it('rejects incomplete, invalid, out-of-bounds, extra and foreign completion logs', async () => {
    const { db, call } = fixture(); await call('/register', undefined, { name: '整局提交' }); await call('/register', 'b'.repeat(64), { name: '另一玩家' });
    const started = (await call('/runs', undefined, { mode: 'challenge', character: 'beth' })).data;
    const run = new LocalRun(started.runId, started.seed, 'challenge', 'beth'), path = `/runs/${started.runId}/complete`;
    const pair = findMove(run.game.state.board)!; run.move(...pair);
    expect((await call(path, undefined, { actions: [pair] })).status).toBe(400);
    expect((await call(path, undefined, { actions: [[0, 55]] })).status).toBe(400);
    expect((await call(path, undefined, { actions: [[-1, 0]] })).status).toBe(400);
    expect((await call(path, undefined, { actions: Array(501).fill(pair) })).status).toBe(400);
    expect((await call(path, 'b'.repeat(64), { actions: [pair] })).status).toBe(404);
    while (run.game.state.status === 'playing') run.move(...findMove(run.game.state.board)!);
    const report = run.completion();
    expect((await call(path, undefined, { actions: [...report.actions, pair] })).status).toBe(400);
    expect((await call('/leaderboards?mode=challenge')).data.entries).toHaveLength(0);
    db.close();
  });
  it('submits successful easy-mode local play using actual moves, including turn-granting skills', async () => {
    const { db, call } = fixture(); await call('/register', undefined, { name: '回合排行' });
    const started = (await call('/runs', undefined, { mode: 'easy', character: 'ian' })).data;
    await db.prepare('UPDATE runs SET seed = ? WHERE id = ?').bind(26, started.runId).run();
    const run = new LocalRun(started.runId, 26, 'easy', 'ian');
    while (run.game.state.status === 'playing') run.move(...findMove(run.game.state.board)!);
    expect(run.game.state.status).toBe('won'); expect(run.game.state.moves).toBe(26);
    const result = await call(`/runs/${started.runId}/complete`, undefined, run.completion());
    expect(result.status).toBe(200); expect(result.data.bests.easy).toBe(26);
    db.close();
  });
  it('requires a name, canonicalizes duplicates and binds one account to one device', async () => {
    const { db, call } = fixture();
    expect((await call('/account')).data.player).toBeNull();
    expect((await call('/runs', undefined, { mode: 'easy', character: 'beth' })).status).toBe(401);
    expect((await call('/register', undefined, { name: 'a'.repeat(5000) })).status).toBe(413);
    expect((await call('/register', undefined, { name: ' Alice ' })).status).toBe(201);
    expect((await call('/register', 'b'.repeat(64), { name: 'ＡＬＩＣＥ' })).data.code).toBe('NAME_TAKEN');
    expect((await call('/register', undefined, { name: 'Another' })).data.code).toBe('DEVICE_REGISTERED');
    expect((await call('/account')).data.player.name).toBe('Alice');
    expect((await call('/register', 'c'.repeat(64), { name: '<script>' })).status).toBe(400);
    db.close();
  });
  it('computes moves on the server, rejects forged revisions and other owners, and makes retries idempotent', async () => {
    const { db, call } = fixture(); await call('/register', undefined, { name: '玩家甲' }); await call('/register', 'b'.repeat(64), { name: '玩家乙' });
    const run = (await call('/runs', undefined, { mode: 'challenge', character: 'ian' })).data;
    const pair = findMove(run.state.board)!;
    const action = { a: pair[0], b: pair[1], revision: 0, nonce: crypto.randomUUID(), score: 999999999 };
    expect((await call(`/runs/${run.runId}/move`, 'b'.repeat(64), action)).status).toBe(404);
    const moved = await call(`/runs/${run.runId}/move`, undefined, action);
    expect(moved.status).toBe(200); expect(moved.data.state.moves).toBe(1); expect(moved.data.state.score).toBeLessThan(999999999);
    expect((await call(`/runs/${run.runId}/move`, undefined, action)).data).toEqual(moved.data);
    expect((await call(`/runs/${run.runId}/move`, undefined, { ...action, nonce: crypto.randomUUID() })).status).toBe(409);
    expect((await call('/leaderboards?mode=challenge')).data.entries).toHaveLength(0);
    db.close();
  });
  it('accepts only a completed challenge result and restores the personal best', async () => {
    const { db, call } = fixture(); await call('/register', undefined, { name: '挑战者' });
    const run = (await call('/runs', undefined, { mode: 'challenge', character: 'lance' })).data;
    let state = run.state, revision = run.revision;
    for (let i = 0; i < 30; i++) {
      const pair = findMove(state.board)!;
      const result = await call(`/runs/${run.runId}/move`, undefined, { a: pair[0], b: pair[1], revision, nonce: crypto.randomUUID() });
      expect(result.status).toBe(200); state = result.data.state; revision = result.data.revision;
    }
    expect(state.status).toBe('completed'); expect(state.moves).toBe(30);
    const ranking = (await call('/leaderboards?mode=challenge')).data.entries;
    expect(ranking).toHaveLength(1); expect(ranking[0]).toMatchObject({ name: '挑战者', character: 'lance', value: state.score });
    expect((await call('/account')).data.player.bests.challenge).toBe(state.score);
    expect((await call(`/runs/${run.runId}/move`, undefined, { a: 0, b: 1, revision, nonce: crypto.randomUUID() })).data.code).toBe('RUN_FINISHED');
    db.close();
  });
  it('returns ten distinct registered players in the correct order for all modes', async () => {
    const { db, call } = fixture();
    for (let i = 0; i < 12; i++) {
      await db.prepare('INSERT INTO players VALUES(?,?,?,?,?)').bind(`id${i}`, `玩家${i}`, `key${i}`, `hash${i}`, i).run();
      for (const mode of ['easy', 'hard', 'challenge']) await db.prepare('INSERT INTO records VALUES(?,?,?,?,?)').bind(`id${i}`, mode, 'chris', i + 1, i).run();
    }
    for (const mode of ['easy', 'hard', 'challenge']) {
      const entries = (await call(`/leaderboards?mode=${mode}`)).data.entries;
      expect(entries).toHaveLength(10); expect(new Set(entries.map((r: any) => r.playerId)).size).toBe(10);
      expect(entries[0].value).toBe(mode === 'challenge' ? 12 : 1);
      expect(entries.every((r: any) => r.name && r.character === 'chris')).toBe(true);
    }
    expect((await call('/leaderboards?mode=unknown')).status).toBe(400);
    expect((await call('/account', undefined, undefined, 'https://evil.test')).status).toBe(403);
    db.close();
  });
  it('reports the full personal rank and gap beyond the top ten, including ties and first place', async () => {
    const { db, call } = fixture();
    const player = (await call('/register', undefined, { name: '榜外玩家' })).data.player;
    for (let i = 0; i < 11; i++) {
      const id = `rank${i}`;
      await db.prepare('INSERT INTO players VALUES(?,?,?,?,?)').bind(id, `排行玩家${i}`, `rankkey${i}`, `rankhash${i}`, i).run();
      for (const mode of ['easy', 'hard', 'challenge']) await db.prepare('INSERT INTO records VALUES(?,?,?,?,?)').bind(id, mode, 'beth', mode === 'challenge' ? (12 - i) * 100 : (i + 1) * 2, i).run();
    }
    for (const mode of ['easy', 'hard', 'challenge']) {
      expect((await call(`/leaderboards?mode=${mode}`)).data.self).toBeNull();
      await db.prepare('INSERT INTO records VALUES(?,?,?,?,?)').bind(player.id, mode, 'lance', mode === 'challenge' ? 100 : 24, 100).run();
      const result = (await call(`/leaderboards?mode=${mode}`)).data;
      expect(result.entries).toHaveLength(10); expect(result.entries.some((r: any) => r.playerId === player.id)).toBe(false);
      expect(result.self).toEqual({ rank: 12, value: mode === 'challenge' ? 100 : 24, gap: mode === 'challenge' ? 100 : 2 });
      await db.prepare('UPDATE records SET value = ? WHERE player_id = ? AND mode = ?').bind(mode === 'challenge' ? 200 : 22, player.id, mode).run();
      expect((await call(`/leaderboards?mode=${mode}`)).data.self).toMatchObject({ rank: 12, gap: 0 });
      await db.prepare('UPDATE records SET value = ? WHERE player_id = ? AND mode = ?').bind(mode === 'challenge' ? 2000 : 1, player.id, mode).run();
      expect((await call(`/leaderboards?mode=${mode}`)).data.self).toMatchObject({ rank: 1, gap: null });
    }
    db.close();
  });
  it('keeps personal ranking private while serving public top ten without a credential', async () => {
    const { db, call } = fixture();
    const player = (await call('/register', undefined, { name: '个人排行' })).data.player;
    await db.prepare('INSERT INTO records VALUES(?,?,?,?,?)').bind(player.id, 'easy', 'beth', 7, 1).run();
    const response = await handleApi(new Request('https://game.test/api/leaderboards?mode=easy'), db, origin);
    const result = await response.json() as any;
    expect(response.status).toBe(200); expect(result.entries).toHaveLength(1); expect(result.self).toBeNull();
    expect((await call('/leaderboards?mode=hard')).data.self).toBeNull();
    db.close();
  });
});
