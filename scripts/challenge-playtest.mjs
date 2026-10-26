import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const output = 'test-results/challenge', checks = [], errors = [];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const state = () => p.evaluate(() => window.__royalGems.state());
const idle = () => p.waitForFunction(() => !window.__royalGems.busy(), null, { timeout: 60000 });
const record = message => { checks.push(message); console.log('PASS', message); };
async function fixture(score, turns = 1) {
  await p.evaluate(({ score, turns }) => {
    const a = window.__royalGems;
    const board = Array.from({ length: 56 }, (_, i) => a.newTile((i % 8 + Math.floor(i / 8) * 2) % 5));
    [0, 1, 10].forEach(i => board[i] = a.newTile(3)); board[2] = a.newTile(1); board[3] = a.newTile(4);
    a.load({ board, score, turns, energy: 0, firstFired: true, difficulty: 'challenge', status: 'playing', character: 'beth' });
  }, { score, turns });
}
async function swap() {
  await p.locator('canvas').scrollIntoViewIfNeeded();
  const b = await p.locator('canvas').boundingBox();
  const point = i => ({ x: b.x + (12 + (i % 8 + .5) * 90) / 744 * b.width, y: b.y + (12 + (Math.floor(i / 8) + .5) * 90) / 654 * b.height });
  const a = point(10), c = point(2);
  await p.mouse.move(a.x, a.y); await p.mouse.down(); await p.mouse.move(c.x, c.y, { steps: 5 }); await p.mouse.up(); await idle();
}
let failure;
try {
  await p.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' });
  await p.locator('[data-difficulty="challenge"]').click();
  expect((await state()).turns).toBe(30);
  await expect(p.locator('#target-wrap')).toBeHidden(); await expect(p.locator('#score-label')).toHaveText('挑战积分');
  await p.locator('#challenge-records').click(); await expect(p.locator('#modal-content')).toContainText('还没有完成'); await p.locator('#records-done').click();
  await p.screenshot({ path: `${output}/ready.png`, fullPage: true });
  record('third mode starts with 30 turns, score-only HUD and empty local records');
  await p.locator('[data-character="3"]').click(); await p.locator('#skill-one').click();
  await expect(p.locator('#modal-content')).toContainText('挑战模式固定30回合'); await p.locator('#skills-done').click();
  await p.locator('[data-difficulty="hard"]').click(); await p.locator('#skill-one').click();
  await expect(p.locator('#modal-content')).toContainText('增加 2 个回合'); await p.locator('#skills-done').click();
  await p.locator('[data-difficulty="challenge"]').click(); await p.locator('[data-character="0"]').click();
  record('Ian skill description changes only in challenge mode');
  await p.locator('#start').click(); await fixture(20000, 2); await swap();
  expect((await state()).status).toBe('playing'); expect((await state()).turns).toBe(1); await expect(p.locator('#modal')).not.toBeVisible();
  record('passing the old hard target does not finish challenge early');
  await fixture(20000); await swap();
  await expect(p.locator('#modal-title')).toHaveText('挑战完成');
  const first = (await state()).score; expect((await state()).status).toBe('completed'); expect((await state()).turns).toBe(0);
  await expect(p.locator('.challenge-table tbody tr')).toHaveCount(1); await expect(p.locator('.current-record')).toContainText(first.toLocaleString('en-US'));
  await p.screenshot({ path: `${output}/result-first.png`, fullPage: true });
  await p.locator('#result-replay').click(); expect((await state()).difficulty).toBe('challenge'); expect((await state()).turns).toBe(30); expect((await state()).score).toBe(0);
  await fixture(0); await swap();
  const second = (await state()).score; expect(second).toBeLessThan(first);
  await expect(p.locator('.challenge-table tbody tr')).toHaveCount(2); await expect(p.locator('.challenge-table tbody tr').first()).toContainText(first.toLocaleString('en-US'));
  await expect(p.locator('#modal-content')).toContainText('相差'); await expect(p.locator('#best-score')).toHaveText(first.toLocaleString('en-US'));
  record('last move settles before results; replay resets 30 turns; lower result preserves best and sorted comparison');
  await p.locator('#result-back').click();
  await p.reload({ waitUntil: 'networkidle' }); await p.locator('[data-difficulty="challenge"]').click();
  await expect(p.locator('#best-score')).toHaveText(first.toLocaleString('en-US')); await p.locator('#challenge-records').click();
  await expect(p.locator('.challenge-table tbody tr')).toHaveCount(2); await p.locator('#records-done').click();
  await p.locator('[data-difficulty="easy"]').click(); await expect(p.locator('#best-score')).toHaveText('—'); await expect(p.locator('#target')).toHaveText('2,500');
  await p.locator('[data-difficulty="hard"]').click(); await expect(p.locator('#target')).toHaveText('10,000');
  record('records persist after reload and remain separate from easy and hard scores');
  await p.evaluate(() => localStorage.setItem('royal-challenge-records', JSON.stringify(Array.from({ length: 15 }, (_, i) => ({ score: 1000 + i * 10, character: 'beth', at: Date.now() - i * 1000 })))));
  await p.locator('[data-difficulty="challenge"]').click(); await p.locator('#start').click(); await fixture(0); await swap();
  await expect(p.locator('.challenge-table tbody tr')).toHaveCount(10); expect(await p.evaluate(() => JSON.parse(localStorage.getItem('royal-challenge-records')).length)).toBe(10);
  record('leaderboard is capped at the highest 10 completed records');
  for (const width of [390, 360]) {
    await p.setViewportSize({ width, height: 844 }); expect(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await p.screenshot({ path: `${output}/result-${width}.png`, fullPage: true });
  }
  await p.locator('#result-back').click(); await p.screenshot({ path: `${output}/ready-360.png`, fullPage: true });
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]); record('three-mode selector and ranking fit mobile widths without runtime errors');
} catch (e) { failure = e; console.error(e); }
finally { await writeFile(`${output}/report.json`, JSON.stringify({ passed: checks.length, checks, errors, failure: failure?.stack }, null, 2)); await browser.close(); }
if (failure) process.exitCode = 1;
