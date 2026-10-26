import type { State, Difficulty, Frame } from './engine';
import type { CharacterId } from './skills';
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
let runId = '', revision = 0;
export async function startRun(mode: Difficulty, character: CharacterId) {
  const result = await request<{ runId: string; revision: number; state: State }>('/runs', { mode, character });
  runId = result.runId; revision = result.revision; return result.state;
}
export async function moveRun(a: number, b: number) {
  const result = await request<{ frames: Frame[]; state: State; revision: number; bests?: Player['bests'] }>(`/runs/${runId}/move`, { a, b, revision, nonce: crypto.randomUUID() }, true);
  revision = result.revision; return result;
}
