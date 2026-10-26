import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const output = 'test-results/best-turns', checks = [], errors = [];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
p.on('pageerror', e => errors.push(e.message));
const record = text => { checks.push(text); console.log('PASS', text); };
async function play({ mode = 'easy', moves, score, turns = 10, character = 'beth', energy = 0 }) {
  await p.evaluate(x => {
    const api = window.__royalGems;
    const board = Array.from({ length: 56 }, (_, i) => api.newTile((i % 8 + Math.floor(i / 8) * 2) % 5));
    [0, 1, 10].forEach(i => board[i] = api.newTile(3)); board[2] = api.newTile(1); board[3] = api.newTile(4);
    api.load({ board, difficulty: x.mode, moves: x.moves, score: x.score, turns: x.turns, character: x.character, energy: x.energy, firstFired: !x.energy, status: 'playing' });
  }, { mode, moves, score, turns, character, energy });
  const b = await p.locator('canvas').boundingBox();
  const pt = i => ({ x: b.x + (12 + (i % 8 + .5) * 90) / 744 * b.width, y: b.y + (12 + (Math.floor(i / 8) + .5) * 90) / 654 * b.height });
  const a = pt(10), c = pt(2);
  await p.mouse.move(a.x, a.y); await p.mouse.down(); await p.mouse.move(c.x, c.y, { steps: 4 }); await p.mouse.up();
  await p.waitForFunction(() => !window.__royalGems.busy(), null, { timeout: 60000 });
  await expect(p.locator('#modal')).toBeVisible();
}
let failure;
try {
  await p.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('royal-best-easy', '19999'); localStorage.setItem('royal-best-challenge', '42000'); sessionStorage.setItem('seeded', 'yes'); } });
  await p.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' });
  await expect(p.locator('#best-label')).toHaveText('通关最少回合'); await expect(p.locator('#best-score')).toHaveText('—');
  record('old score records are not misread as a turn count; no clear shows a dash');
  await play({ moves: 7, score: 2490 }); await expect(p.locator('#best-score')).toHaveText('8 回合');
  await expect(p.locator('#modal-content')).toContainText('新的最少回合记录'); await p.locator('#result-back').click();
  await play({ moves: 10, score: 2490 }); await expect(p.locator('#best-score')).toHaveText('8 回合'); await expect(p.locator('#modal-content')).toContainText('本次多用 3 回合'); await p.locator('#result-back').click();
  await play({ moves: 3, score: 2490 }); await expect(p.locator('#best-score')).toHaveText('4 回合');
  await p.screenshot({ path: `${output}/faster-clear.png`, fullPage: true }); await p.locator('#result-back').click();
  await play({ moves: 3, score: 2490 }); await expect(p.locator('#modal-content')).toContainText('追平最少回合记录'); await p.locator('#result-back').click();
  record('wins compare valid moves; faster replaces, slower preserves and ties are identified');
  await play({ moves: 0, score: 0, turns: 1 }); await expect(p.locator('#modal-title')).toHaveText('再赴一场试炼'); await expect(p.locator('#best-score')).toHaveText('4 回合'); await p.locator('#result-back').click();
  await p.locator('[data-difficulty="hard"]').click(); await expect(p.locator('#best-score')).toHaveText('—');
  await play({ mode: 'hard', moves: 6, score: 9990 }); await expect(p.locator('#best-score')).toHaveText('7 回合'); await p.locator('#result-back').click();
  record('failed runs do not replace the record; hard has its own minimum');
  await p.locator('[data-difficulty="easy"]').click(); await p.locator('[data-character="3"]').click();
  await play({ moves: 4, score: 2490, turns: 2, character: 'ian', energy: 250 });
  expect(await p.evaluate(() => window.__royalGems.state().moves)).toBe(5);
  expect(await p.evaluate(() => window.__royalGems.state().turns)).toBeGreaterThan(1);
  await expect(p.locator('.result-score')).toContainText('5'); await expect(p.locator('#best-score')).toHaveText('4 回合'); await p.locator('#result-back').click();
  await p.reload({ waitUntil: 'networkidle' }); await expect(p.locator('#best-score')).toHaveText('4 回合');
  await p.locator('[data-difficulty="hard"]').click(); await expect(p.locator('#best-score')).toHaveText('7 回合');
  await p.locator('[data-difficulty="challenge"]').click(); await expect(p.locator('#best-label')).toHaveText('个人最佳积分'); await expect(p.locator('#best-score')).toHaveText('42,000');
  record('Ian extra turns do not reduce used moves; all mode records persist and challenge still uses score');
  await p.locator('[data-difficulty="easy"]').click(); await p.setViewportSize({ width: 360, height: 844 });
  await p.screenshot({ path: `${output}/mobile-best.png`, fullPage: true }); expect(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]); record('mobile label fits and runtime is error-free');
} catch (e) { failure = e; console.error(e); }
finally { await writeFile(`${output}/report.json`, JSON.stringify({ passed: checks.length, checks, errors, failure: failure?.stack }, null, 2)); await browser.close(); }
if (failure) process.exitCode = 1;
