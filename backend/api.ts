import { GameEngine, seededRandom, type Difficulty } from '../src/engine';
import type { CharacterId } from '../src/skills';

export interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}
export interface Database { prepare(sql: string): Statement; batch(statements: Statement[]): Promise<unknown[]> }
type Player = { id: string; name: string };
type Run = { id: string; player_id: string; mode: Difficulty; character: CharacterId; seed: number; actions: string; revision: number; last_nonce: string | null; finished: number; created_at: number };
const modes = ['easy', 'hard', 'challenge'];
const characters = ['beth', 'lance', 'chris', 'ian'];
class ApiError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
const fail = (status: number, code: string, message: string): never => { throw new ApiError(status, code, message); };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
async function body(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) fail(415, 'JSON_REQUIRED', '请使用JSON请求');
  const reader = request.body?.getReader(), chunks: Uint8Array[] = []; let size = 0;
  if (reader) try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); fail(413, 'TOO_LARGE', '请求过大'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const text = new TextDecoder().decode(bytes); if (text.length > 4096) fail(413, 'TOO_LARGE', '请求过大');
  try { const data = JSON.parse(text); if (data && typeof data === 'object' && !Array.isArray(data)) return data; } catch { /* handled below */ }
  return fail(400, 'INVALID_JSON', '请求格式错误');
}
async function deviceHash(request: Request) {
  const token = request.headers.get('authorization')?.match(/^Device ([a-f0-9]{64})$/)?.[1];
  if (!token) return fail(401, 'DEVICE_REQUIRED', '需要此浏览器的设备凭据');
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function personalBests(db: Database, player: Player) {
  const { results } = await db.prepare('SELECT mode, value FROM records WHERE player_id = ?').bind(player.id).all<{ mode: string; value: number }>();
  return Object.fromEntries(results.map(r => [r.mode, r.value]));
}
function replay(run: Run, actions = JSON.parse(run.actions) as [number, number][]) {
  const game = new GameEngine(run.mode, seededRandom(run.seed), run.character); game.start();
  actions.forEach(pair => game.move(...pair)); return game;
}
async function route(request: Request, db: Database): Promise<Response> {
  const url = new URL(request.url), path = url.pathname.replace(/\/$/, ''), method = request.method;
  if (path === '/api/health' && method === 'GET') return json({ ok: true, version: 1 });
  if (path === '/api/leaderboards' && method === 'GET') {
    const mode = url.searchParams.get('mode'); if (!modes.includes(mode ?? '')) fail(400, 'INVALID_MODE', '模式不存在');
    const direction = mode === 'challenge' ? 'DESC' : 'ASC';
    const { results } = await db.prepare(`SELECT p.id AS playerId, p.name, r.character, r.value, r.achieved_at AS achievedAt FROM records r JOIN players p ON p.id = r.player_id WHERE r.mode = ? ORDER BY r.value ${direction}, r.achieved_at ASC, p.id ASC LIMIT 10`).bind(mode).all();
    let self = null;
    if (request.headers.has('authorization')) {
      const hash = await deviceHash(request);
      const viewer = await db.prepare('SELECT id FROM players WHERE device_hash = ?').bind(hash).first<{ id: string }>();
      if (viewer) {
        // Rank over the entire mode, then select the viewer, including players outside the top ten.
        const record = await db.prepare(`WITH ranked AS (SELECT r.player_id, r.value, ROW_NUMBER() OVER (ORDER BY r.value ${direction}, r.achieved_at ASC, r.player_id ASC) AS rank, LAG(r.value) OVER (ORDER BY r.value ${direction}, r.achieved_at ASC, r.player_id ASC) AS previousValue FROM records r WHERE r.mode = ?) SELECT rank, value, previousValue FROM ranked WHERE player_id = ?`).bind(mode, viewer.id).first<{ rank: number; value: number; previousValue: number | null }>();
        if (record) self = { rank: record.rank, value: record.value, gap: record.previousValue === null ? null : Math.abs(record.value - record.previousValue) };
      }
    }
    return json({ mode, entries: results, self });
  }
  const hash = await deviceHash(request);
  const player = await db.prepare('SELECT id, name FROM players WHERE device_hash = ?').bind(hash).first<Player>();
  if (path === '/api/account' && method === 'GET') return json({ player: player ? { ...player, bests: await personalBests(db, player) } : null });
  if (path === '/api/register' && method === 'POST') {
    if (player) return fail(409, 'DEVICE_REGISTERED', '此浏览器设备已注册账号，请使用现有账号');
    const input = await body(request);
    const name = typeof input.name === 'string' ? input.name.normalize('NFKC').trim() : '';
    if (!/^[\p{Script=Han}\p{L}\p{N}_-]{2,16}$/u.test(name)) fail(400, 'INVALID_NAME', '名字需为2至16个汉字、字母、数字、下划线或短横线');
    const id = crypto.randomUUID(), nameKey = name.toLocaleLowerCase('en-US');
    try { await db.prepare('INSERT INTO players(id,name,name_key,device_hash,created_at) VALUES(?,?,?,?,?)').bind(id, name, nameKey, hash, Date.now()).run(); }
    catch (error) {
      if (await db.prepare('SELECT id FROM players WHERE device_hash = ?').bind(hash).first()) fail(409, 'DEVICE_REGISTERED', '此浏览器设备已注册账号');
      if (await db.prepare('SELECT id FROM players WHERE name_key = ?').bind(nameKey).first()) fail(409, 'NAME_TAKEN', '这个名字已经注册，请换一个名字');
      throw error;
    }
    return json({ player: { id, name, bests: {} } }, 201);
  }
  if (!player) return fail(401, 'REGISTER_REQUIRED', '请先注册名字');
  if (path === '/api/runs' && method === 'POST') {
    const data = await body(request);
    if (!modes.includes(data.mode) || !characters.includes(data.character)) fail(400, 'INVALID_GAME', '模式或角色不存在');
    const recent = await db.prepare('SELECT COUNT(*) AS count FROM runs WHERE player_id = ? AND created_at > ?').bind(player.id, Date.now() - 3600000).first<{ count: number }>();
    if ((recent?.count ?? 0) >= 120) fail(429, 'TOO_MANY_RUNS', '开始过于频繁，请稍后再试');
    const id = crypto.randomUUID(), seed = crypto.getRandomValues(new Uint32Array(1))[0];
    await db.prepare('DELETE FROM runs WHERE created_at < ?').bind(Date.now() - 86400000 * 2).run();
    await db.prepare('INSERT INTO runs(id,player_id,mode,character,seed,created_at) VALUES(?,?,?,?,?,?)').bind(id, player.id, data.mode, data.character, seed, Date.now()).run();
    const game = new GameEngine(data.mode, seededRandom(seed), data.character); game.start();
    return json({ runId: id, seed, revision: 0, state: game.snapshot() }, 201);
  }
  const completePath = path.match(/^\/api\/runs\/([a-f0-9-]{36})\/complete$/);
  if (completePath && method === 'POST') {
    const data = await body(request);
    if (!Array.isArray(data.actions) || !data.actions.length || data.actions.length > 500 || !data.actions.every((pair: unknown) => Array.isArray(pair) && pair.length === 2 && pair.every(n => Number.isSafeInteger(n) && n >= 0 && n < 56))) fail(400, 'INVALID_RESULT', '本局行动记录格式错误');
    const run = await db.prepare('SELECT * FROM runs WHERE id = ? AND player_id = ?').bind(completePath[1], player.id).first<Run>();
    if (!run || run.created_at < Date.now() - 86400000) fail(404, 'RUN_EXPIRED', '对局不存在或已过期，请重新开始');
    const current = run!, actions = data.actions as [number, number][], encoded = JSON.stringify(actions);
    if (current.finished && current.actions !== encoded) fail(409, 'RUN_FINISHED', '此对局已提交另一份成绩');
    if (!current.finished && current.revision !== 0) fail(409, 'STALE_MOVE', '此对局已通过另一页面操作');
    const game = new GameEngine(current.mode, seededRandom(current.seed), current.character); game.start();
    for (const pair of actions) {
      const before = game.state.moves; game.move(...pair);
      if (game.state.moves !== before + 1) fail(400, 'INVALID_RESULT', '本局行动记录不完整或无效');
    }
    const state = game.snapshot();
    if (state.status !== 'won' && state.status !== 'completed') fail(400, 'INVALID_RESULT', '完成有效对局后才能提交成绩');
    if (!current.finished) {
      const value = current.mode === 'challenge' ? state.score : state.moves, direction = current.mode === 'challenge' ? '>' : '<';
      const result = await db.batch([
        db.prepare('UPDATE runs SET actions = ?, revision = ?, last_nonce = ?, finished = 1 WHERE id = ? AND revision = 0 AND finished = 0').bind(encoded, actions.length, 'batch-v1', current.id),
        db.prepare(`INSERT INTO records(player_id,mode,character,value,achieved_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM runs WHERE id = ? AND finished = 1 AND actions = ?) ON CONFLICT(player_id,mode) DO UPDATE SET character = excluded.character, value = excluded.value, achieved_at = excluded.achieved_at WHERE excluded.value ${direction} records.value`).bind(player.id, current.mode, current.character, value, Date.now(), current.id, encoded),
      ]) as { meta: { changes: number } }[];
      if (!result[0].meta.changes) {
        const saved = await db.prepare('SELECT actions, finished FROM runs WHERE id = ?').bind(current.id).first<{ actions: string; finished: number }>();
        if (!saved?.finished || saved.actions !== encoded) fail(409, 'RUN_FINISHED', '此对局已提交另一份成绩');
      }
    }
    return json({ state, bests: await personalBests(db, player) });
  }
  const movePath = path.match(/^\/api\/runs\/([a-f0-9-]{36})\/move$/);
  if (movePath && method === 'POST') {
    const data = await body(request);
    if (![data.a, data.b, data.revision].every(Number.isSafeInteger) || typeof data.nonce !== 'string' || !/^[a-f0-9-]{36}$/.test(data.nonce)) fail(400, 'INVALID_MOVE', '行动格式错误');
    const run = await db.prepare('SELECT * FROM runs WHERE id = ? AND player_id = ?').bind(movePath[1], player.id).first<Run>();
    if (!run || run.created_at < Date.now() - 86400000) fail(404, 'RUN_EXPIRED', '对局不存在或已过期，请重新开始');
    const current = run!;
    const actions: [number, number][] = JSON.parse(current.actions);
    // A retry returns the same frames, and never consumes another turn.
    if (current.revision === data.revision + 1 && current.last_nonce === data.nonce) {
      const last = actions.at(-1)!;
      if (last[0] !== data.a || last[1] !== data.b) fail(409, 'STALE_MOVE', '行动已改变');
      const game = replay(current, actions.slice(0, -1)), frames = game.move(...last);
      return json({ frames, state: game.snapshot(), revision: current.revision, bests: current.finished ? await personalBests(db, player) : undefined });
    }
    if (current.finished) fail(409, 'RUN_FINISHED', '此对局已经结束');
    if (current.revision !== data.revision) fail(409, 'STALE_MOVE', '此对局已在另一页面操作，请重新开始');
    if (actions.length >= 500) fail(400, 'MOVE_LIMIT', '此对局行动次数已达上限');
    const game = replay(current, actions), before = game.state.moves, frames = game.move(data.a, data.b);
    if (!frames.length) fail(400, 'INVALID_MOVE', '请选择相邻棋子');
    if (game.state.moves === before) return json({ frames, state: game.snapshot(), revision: current.revision });
    actions.push([data.a, data.b]);
    const state = game.snapshot(), finished = state.status !== 'playing';
    const statements = [db.prepare('UPDATE runs SET actions = ?, revision = revision + 1, last_nonce = ?, finished = ? WHERE id = ? AND revision = ?').bind(JSON.stringify(actions), data.nonce, Number(finished), current.id, current.revision)];
    if (state.status === 'won' || state.status === 'completed') {
      const direction = current.mode === 'challenge' ? '>' : '<';
      const value = current.mode === 'challenge' ? state.score : state.moves;
      statements.push(db.prepare(`INSERT INTO records(player_id,mode,character,value,achieved_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM runs WHERE id = ? AND revision = ? AND last_nonce = ?) ON CONFLICT(player_id,mode) DO UPDATE SET character = excluded.character, value = excluded.value, achieved_at = excluded.achieved_at WHERE excluded.value ${direction} records.value`).bind(player.id, current.mode, current.character, value, Date.now(), current.id, current.revision + 1, data.nonce));
    }
    const result = await db.batch(statements) as { meta: { changes: number } }[];
    if (!result[0].meta.changes) fail(409, 'STALE_MOVE', '行动已经提交，请重试');
    return json({ frames, state, revision: current.revision + 1, bests: finished ? await personalBests(db, player) : undefined });
  }
  return fail(404, 'NOT_FOUND', '接口不存在');
}

export async function handleApi(request: Request, db: Database, allowedOrigins: string): Promise<Response> {
  const origin = request.headers.get('origin');
  const allowed = allowedOrigins.split(',').map(s => s.trim()).filter(Boolean);
  if (origin && !allowed.includes(origin)) return json({ code: 'ORIGIN_DENIED', message: '来源网站未获授权' }, 403);
  let response: Response;
  if (request.method === 'OPTIONS') response = new Response(null, { status: 204 });
  else try { response = await route(request, db); }
  catch (error) { response = error instanceof ApiError ? json({ code: error.code, message: error.message }, error.status) : json({ code: 'SERVER_ERROR', message: '服务暂时不可用，请稍后重试' }, 500); }
  if (origin) { response.headers.set('Access-Control-Allow-Origin', origin); response.headers.set('Vary', 'Origin'); }
  response.headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Authorization,Content-Type');
  return response;
}
