import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const url = process.env.GAME_URL || 'http://127.0.0.1:5174';
const output = 'test-results/online', errors = [], checks = [];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const name = `玩家${Date.now().toString().slice(-9)}`;
const record = t => { checks.push(t); console.log('PASS', t); };
async function page(viewport) {
  const context = await browser.newContext({ viewport }); const p = await context.newPage();
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !m.text().includes('409')) errors.push(m.text()); });
  await p.goto(url, { waitUntil: 'networkidle' }); return p;
}
async function signup(p, name) { await p.locator('#register-name').fill(name); await p.locator('#register-submit').click(); }
let failure;
try {
  const p = await page({ width: 1440, height: 900 });
  await expect(p.locator('#register-name')).toBeVisible(); await expect(p.locator('#start')).toBeDisabled();
  await p.keyboard.press('Escape'); await expect(p.locator('#register-name')).toBeVisible();
  await p.screenshot({ path: `${output}/registration.png`, fullPage: true });
  await signup(p, name); await expect(p.locator('#modal')).not.toBeVisible(); await expect(p.locator('#start')).toBeEnabled();
  await expect(p.locator('#player-name')).toContainText(name);
  record('registration is required before play; device-bound account is recognized');
  const mobile = await page({ width: 390, height: 844 });
  await signup(mobile, name); await expect(mobile.locator('#register-error')).toContainText('已经注册');
  await signup(mobile, `${name}乙`); await expect(mobile.locator('#modal')).not.toBeVisible();
  expect(await p.evaluate(async () => { try { await (await import('/src/online.ts')).register('另一个名字'); return ''; } catch (e) { return e.code; } })).toBe('DEVICE_REGISTERED');
  record('another device cannot register the same name; registered device cannot register a second account');
  await p.locator('[data-difficulty="challenge"]').click(); await p.locator('[data-character="1"]').click(); await p.locator('#start').click();
  await p.waitForFunction(() => window.__royalGems.state().status === 'playing' && !window.__royalGems.busy());
  await p.evaluate(async () => {
    const online = await import('/src/online.ts'), { findMove } = await import('/src/engine.ts');
    let s = window.__royalGems.state();
    for (let i = 0; i < 29; i++) { const pair = findMove(s.board); s = (await online.moveRun(...pair)).state; }
    window.__royalGems.load(s);
  });
  const pair = await p.evaluate(() => window.__royalGems.hint()), box = await p.locator('canvas').boundingBox();
  const point = i => ({ x: box.x + (12 + (i % 8 + .5) * 90) / 744 * box.width, y: box.y + (12 + (Math.floor(i / 8) + .5) * 90) / 654 * box.height });
  const a = point(pair[0]), b = point(pair[1]);
  await p.mouse.move(a.x, a.y); await p.mouse.down(); await p.mouse.move(b.x, b.y, { steps: 4 }); await p.mouse.up();
  await expect(p.locator('#modal-title')).toHaveText('挑战完成', { timeout: 60000 });
  const score = await p.evaluate(() => window.__royalGems.state().score);
  await expect(p.locator('#modal-content')).not.toContainText('本机');
  await p.locator('#result-rankings').click(); await expect(p.locator('.challenge-table')).toContainText(name);
  await expect(p.locator('.challenge-table')).toContainText('兰斯'); await expect(p.locator('.challenge-table')).toContainText(score.toLocaleString('en-US'));
  await p.screenshot({ path: `${output}/challenge-ranking.png`, fullPage: true });
  record('30 server-computed moves create a ranked score with registered name and actual character');
  await mobile.locator('#online-rankings').click(); await mobile.locator('[data-ranking="challenge"]').click();
  await expect(mobile.locator('.challenge-table')).toContainText(name);
  await mobile.screenshot({ path: `${output}/ranking-mobile.png`, fullPage: true });
  for (const mode of ['easy', 'hard']) { await mobile.locator(`[data-ranking="${mode}"]`).click(); await expect(mobile.locator('#ranking-body')).toContainText('还没有有效成绩'); }
  expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  record('independent device sees shared challenge result; easy and hard boards are separate; mobile fits');
  await p.reload({ waitUntil: 'networkidle' }); await expect(p.locator('#start')).toBeEnabled(); await expect(p.locator('#player-name')).toContainText(name); await expect(p.locator('#register-name')).toHaveCount(0);
  await p.locator('[data-difficulty="challenge"]').click(); await expect(p.locator('#best-score')).toHaveText(score.toLocaleString('en-US'));
  expect(errors).toEqual([]); record('reload restores identity and server best; no runtime errors');
} catch (e) { failure = e; console.error(e); }
finally { await writeFile(`${output}/report.json`, JSON.stringify({ checks, passed: checks.length, errors, failure: failure?.stack }, null, 2)); await browser.close(); }
if (failure) process.exitCode = 1;
