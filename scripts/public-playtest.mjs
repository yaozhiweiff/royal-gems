import { chromium, expect } from '@playwright/test';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('test-results/public', { recursive: true });
await build({ entryPoints: ['src/engine.ts'], outfile: '.data/test-engine.mjs', bundle: true, format: 'esm', platform: 'node' });
const { findMove } = await import('../.data/test-engine.mjs');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const url = process.env.GAME_URL || 'https://yaozhiweiff.github.io/royal-gems/';
const ids = [], errors = [], checks = [], name = `验收${Date.now().toString().slice(-10)}`;
const pass = message => { checks.push(message); console.log('PASS', message); };
async function open(viewport) {
  const context = await browser.newContext({ viewport }); const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', async r => { if (new URL(r.url()).pathname === '/api/register' && r.status() === 201) ids.push((await r.json()).player.id); });
  await page.goto(url, { waitUntil: 'networkidle' }); return page;
}
async function signup(p, n) { await p.locator('#register-name').fill(n); await p.locator('#register-submit').click(); }
let failure;
try {
  const p = await open({ width: 1440, height: 900 });
  await expect(p.locator('#register-name')).toBeVisible({ timeout: 20000 });
  await expect(p.locator('#start')).toBeDisabled();
  expect(await p.evaluate(() => typeof window.__royalGems)).toBe('undefined');
  expect(await p.evaluate(() => [...document.images].every(i => i.complete && i.naturalWidth > 0))).toBe(true);
  await signup(p, name); await expect(p.locator('#start')).toBeEnabled({ timeout: 20000 });
  pass('public registration and all subpath assets work; development hooks absent');
  const mobile = await open({ width: 390, height: 844 });
  await signup(mobile, name); await expect(mobile.locator('#register-error')).toContainText('已经注册');
  await signup(mobile, `${name}乙`); await expect(mobile.locator('#start')).toBeEnabled({ timeout: 20000 });
  pass('independent browser rejects duplicate name and registers another account');
  await p.locator('[data-difficulty="challenge"]').click();
  await p.locator('[data-character="1"]').click();
  const started = p.waitForResponse(r => new URL(r.url()).pathname === '/api/runs' && r.request().method() === 'POST');
  await p.locator('#start').click(); let state = (await (await started).json()).state;
  await p.screenshot({ path: 'test-results/public/game.png', fullPage: true });
  for (let turn = 0; turn < 30; turn++) {
    await expect(p.locator('#hint')).toBeEnabled({ timeout: 60000 });
    const pair = findMove(state.board); expect(pair).toBeTruthy();
    const box = await p.locator('canvas').boundingBox();
    const point = i => ({ x: box.x + (12 + (i % 8 + .5) * 90) / 744 * box.width, y: box.y + (12 + (Math.floor(i / 8) + .5) * 90) / 654 * box.height });
    const a = point(pair[0]), b = point(pair[1]);
    const moved = p.waitForResponse(r => /\/api\/runs\/.+\/move$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST');
    await p.mouse.move(a.x, a.y); await p.mouse.down(); await p.mouse.move(b.x, b.y, { steps: 4 }); await p.mouse.up();
    const response = await moved; expect(response.status()).toBe(200); state = (await response.json()).state;
    expect(state.moves).toBe(turn + 1); console.log(`TURN ${turn + 1}: ${state.score}`);
  }
  await expect(p.locator('#modal-title')).toHaveText('挑战完成', { timeout: 60000 });
  expect(state.status).toBe('completed');
  await p.locator('#result-rankings').click();
  await expect(p.locator('#ranking-status')).toContainText('当前第');
  await expect(p.locator('#ranking-personal')).toContainText('当前第');
  await expect(p.locator('.challenge-table')).toContainText(name);
  await expect(p.locator('.challenge-table')).toContainText('兰斯');
  await expect(p.locator('.challenge-table')).toContainText(state.score.toLocaleString('en-US'));
  await p.screenshot({ path: 'test-results/public/ranking.png', fullPage: true });
  pass('30 actual UI swaps, animations and server-computed challenge score complete and rank');
  await mobile.locator('#online-rankings').click(); await mobile.locator('[data-ranking="challenge"]').click();
  await expect(mobile.locator('.challenge-table')).toContainText(name);
  await mobile.screenshot({ path: 'test-results/public/mobile.png', fullPage: true });
  for (const mode of ['easy', 'hard']) { await mobile.locator(`[data-ranking="${mode}"]`).click(); await expect(mobile.locator('#ranking-body')).not.toContainText(name); }
  expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  pass('shared ranking visible on another browser; three boards separate; mobile fits');
  await p.reload({ waitUntil: 'networkidle' });
  await expect(p.locator('#player-name')).toContainText(name); await expect(p.locator('#start')).toBeEnabled();
  await p.locator('[data-difficulty="challenge"]').click(); await expect(p.locator('#best-score')).toHaveText(state.score.toLocaleString('en-US'));
  expect(errors).toEqual([]); pass('refresh restores account and cloud best; no runtime errors');
  await p.locator('#start').click(); await expect(p.locator('#hint')).toBeEnabled();
  await p.locator('#restart').click(); await p.locator('#confirm-restart').click();
  await expect(p.locator('#setup-actions')).toBeVisible(); await expect(p.locator('#play-actions')).toBeHidden();
  await p.locator('[data-difficulty="hard"]').click(); await p.locator('[data-character="3"]').click();
  await expect(p.locator('[data-character="3"]')).toHaveAttribute('aria-pressed', 'true');
  pass('public restart returns to selectable difficulty and hero setup');
} catch (error) { failure = error; console.error(error); }
finally {
  await writeFile('test-results/public/report.json', JSON.stringify({ passed: checks.length, checks, errors, playerIds: ids, failure: failure?.stack }, null, 2));
  if (ids.length && ids.every(id => /^[a-f0-9-]{36}$/.test(id))) {
    const list = ids.map(id => `'${id}'`).join(',');
    await writeFile('test-results/public/cleanup.sql', `DELETE FROM records WHERE player_id IN (${list});\nDELETE FROM runs WHERE player_id IN (${list});\nDELETE FROM players WHERE id IN (${list});\n`);
  }
  await browser.close();
}
if (failure) process.exitCode = 1;
