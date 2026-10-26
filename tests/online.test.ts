import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { handleApi } from '../backend/api';
import { sqliteDatabase } from '../backend/sqlite.mjs';
import { findMove } from '../src/engine';
const origin = 'https://example.github.io';
function fixture() {
  const db = sqliteDatabase(':memory:'); db.exec(readFileSync('backend/migrations/0001_online.sql', 'utf8'));
  const call = async (path: string, token = 'a'.repeat(64), data?: unknown, requestOrigin = origin) => {
    const response = await handleApi(new Request(`https://game.test/api${path}`, { method: data === undefined ? 'GET' : 'POST', headers: { Authorization: `Device ${token}`, Origin: requestOrigin, 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) }), db, origin);
    return { status: response.status, data: await response.json() as any };
  }; return { db, call };
}
describe('online identity and authoritative leaderboards', () => {
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
});
