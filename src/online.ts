import type { State, Difficulty } from './engine';
import type { CharacterId } from './skills';
import { LocalRun, type CompletedRun } from './local-run';
export type Player = { id: string; name: string; bests: Partial<Record<Difficulty, number>> };
export type Ranking = { playerId: string; name: string; character: CharacterId; value: number; achievedAt: number };
export type PersonalRank = { rank: number; value: number; gap: number | null };
const origin = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
let credential: Promise<string> | null = null;
export class OnlineError extends Error { constructor(public code: string, message: string) { super(message); } }
function deviceCredential(): Promise<string> {
  return credential ??= new Promise<string>((resolve, reject) => {
    const request = indexedDB.open('royal-gems-device', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('device');
    request.onerror = () => reject(new OnlineError('DEVICE_STORAGE', '无法保存设备凭据，请允许此网站使用浏览器存储后重试'));
    request.onsuccess = () => {
      const db = request.result, transaction = db.transaction('device', 'readwrite'), store = transaction.objectStore('device');
      const get = store.get('credential'); let token: string;
      get.onsuccess = () => {
        let backup = ''; try { backup = localStorage.getItem('royal-device-credential') ?? ''; } catch { /* IndexedDB remains authoritative */ }
        token = /^[a-f0-9]{64}$/.test(get.result || '') ? get.result : /^[a-f0-9]{64}$/.test(backup) ? backup : [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('');
        store.put(token, 'credential');
      };
      transaction.oncomplete = () => { db.close(); try { localStorage.setItem('royal-device-credential', token); } catch { /* optional backup */ } resolve(token); };
      transaction.onerror = () => { db.close(); reject(new OnlineError('DEVICE_STORAGE', '设备凭据保存失败，请允许浏览器存储后重试')); };
    };
  }).catch(error => { credential = null; throw error; });
}
async function request<T>(path: string, data?: unknown, nonceRetry = false): Promise<T> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${origin}/api${path}`, { method: data === undefined ? 'GET' : 'POST', headers: { Authorization: `Device ${await deviceCredential()}`, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: data === undefined ? undefined : JSON.stringify(data), signal: controller.signal });
    const result = await response.json();
    if (!response.ok) throw new OnlineError(result.code || 'SERVER_ERROR', result.message || '网络请求失败');
    return result as T;
  } catch (error) {
    if (error instanceof OnlineError) throw error;
    if (nonceRetry) return request<T>(path, data, false);
    throw new OnlineError('NETWORK_ERROR', '无法连接游戏服务，请检查网络后重试');
  } finally { clearTimeout(timer); }
}
export const account = () => request<{ player: Player | null }>('/account');
export const register = (name: string) => request<{ player: Player }>('/register', { name });
export const rankings = (mode: Difficulty) => request<{ entries: Ranking[]; self: PersonalRank | null }>(`/leaderboards?mode=${mode}`);
let activeRun: LocalRun | null = null;
export async function startRun(mode: Difficulty, character: CharacterId) {
  const result = await request<{ runId: string; seed: number; state: State }>('/runs', { mode, character });
  if (!Number.isSafeInteger(result.seed)) throw new OnlineError('UPDATE_REQUIRED', '游戏版本需要更新，请刷新后再试');
  const run = new LocalRun(result.runId, result.seed, mode, character);
  if (!run.matches(result.state)) throw new OnlineError('UPDATE_REQUIRED', '游戏版本需要更新，请刷新后再试');
  activeRun = run; return run.game.snapshot();
}
export function moveRun(a: number, b: number) {
  if (!activeRun) throw new OnlineError('RUN_REQUIRED', '请先开始游戏');
  return activeRun.move(a, b);
}
const pendingKey = 'royal-pending-results-v1';
let pending: Map<string, CompletedRun> | null = null;
const submitting = new Map<string, Promise<Player['bests']>>();
function pendingResults() {
  if (!pending) {
    pending = new Map();
    try {
      const saved = JSON.parse(localStorage.getItem(pendingKey) || '[]');
      if (Array.isArray(saved)) for (const r of saved) if (r && /^[a-f0-9-]{36}$/.test(r.runId) && Array.isArray(r.actions) && r.actions.length <= 500 && r.actions.every((p: unknown) => Array.isArray(p) && p.length === 2 && p.every(n => Number.isSafeInteger(n) && n >= 0 && n < 56))) pending.set(r.runId, r);
    } catch { /* Retain an in-memory queue if browser storage is unavailable. */ }
  }
  return pending;
}
function savePending() { try { localStorage.setItem(pendingKey, JSON.stringify([...pendingResults().values()])); } catch { /* The result remains available in this tab. */ } }
async function submitResult(report: CompletedRun): Promise<Player['bests']> {
  const existing = submitting.get(report.runId); if (existing) return existing;
  const task = request<{ bests: Player['bests'] }>(`/runs/${report.runId}/complete`, { actions: report.actions }, true).then(result => {
    pendingResults().delete(report.runId); savePending(); return result.bests;
  }).catch(error => {
    if (error instanceof OnlineError && ['RUN_EXPIRED', 'INVALID_RESULT', 'STALE_MOVE', 'RUN_FINISHED'].includes(error.code)) { pendingResults().delete(report.runId); savePending(); }
    throw error;
  }).finally(() => submitting.delete(report.runId));
  submitting.set(report.runId, task); return task;
}
export function completeRun() {
  if (!activeRun) throw new OnlineError('RUN_REQUIRED', '请先开始游戏');
  const report = activeRun.completion(); pendingResults().set(report.runId, report); savePending();
  return submitResult(report);
}
export function hasPendingResult() { return !!activeRun && pendingResults().has(activeRun.runId); }
export async function retryPendingResults() {
  let bests: Player['bests'] | undefined;
  for (const report of [...pendingResults().values()]) try { bests = await submitResult(report); } catch { /* Keep temporary failures queued without blocking gameplay. */ }
  return bests;
}
