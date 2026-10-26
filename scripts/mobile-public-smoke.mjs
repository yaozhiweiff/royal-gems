import { chromium, expect } from '@playwright/test';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
const output = 'test-results/mobile-public'; await mkdir(output, { recursive: true });
await build({ entryPoints: ['src/engine.ts'], outfile: '.data/mobile-test-engine.mjs', bundle: true, format: 'esm', platform: 'node' });
const { findMove, GameEngine, seededRandom } = await import('../.data/mobile-test-engine.mjs');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await context.newPage(), cdp = await context.newCDPSession(page), errors = [];
page.on('pageerror', error => errors.push(error.message));
let player, failure;
try {
  await page.goto(process.env.GAME_URL || 'https://yaozhiweiff.github.io/royal-gems/', { waitUntil: 'networkidle' });
  await page.locator('#register-name').fill(`手机验收${Date.now().toString().slice(-9)}`);
  const registered = page.waitForResponse(r => new URL(r.url()).pathname === '/api/register' && r.status() === 201);
  await page.locator('#register-submit').tap(); player = (await (await registered).json()).player;
  await expect(page.locator('#start')).toBeEnabled({ timeout: 20000 });
  const companion = await page.locator('.companion').boundingBox(), board = await page.locator('canvas').boundingBox();
  expect(companion.y + companion.height).toBeLessThan(board.y); expect(Math.abs(board.width - board.height)).toBeLessThan(1); expect(board.width).toBeGreaterThan(354);
  expect(await page.evaluate(() => typeof window.__royalGems)).toBe('undefined');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('[data-character="1"]').tap(); await page.locator('[data-difficulty="challenge"]').tap();
  const started = page.waitForResponse(r => new URL(r.url()).pathname === '/api/runs' && r.request().method() === 'POST');
  await page.locator('#start').tap(); const start = await (await started).json();
  const mirror = new GameEngine('challenge', seededRandom(start.seed), 'lance'); mirror.start(); let state = mirror.snapshot();
  await expect(page.locator('#hint')).toBeEnabled();
  for (const step of ['match', 'bottom-row']) {
    const pair = step === 'match' ? findMove(state.board) : [55, 54];
    await page.locator('canvas').scrollIntoViewIfNeeded(); const box = await page.locator('canvas').boundingBox();
    const point = i => ({ x: box.x + (12 + (i % 8 + .5) * 90) / 744 * box.width, y: box.y + (12 + (Math.floor(i / 8) + .5) * (720 / 7)) / 744 * box.height });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point(pair[0]), id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point(pair[1]), id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    mirror.move(...pair); state = mirror.snapshot();
    await expect(page.locator('#hint')).toBeDisabled(); await expect(page.locator('#hint')).toBeEnabled({ timeout: 60000 });
    await expect(page.locator('#score')).toHaveText(state.score.toLocaleString('en-US'));
  }
  expect(state.moves).toBeGreaterThan(0); expect(errors).toEqual([]);
  await page.screenshot({ path: `${output}/phone.png`, fullPage: true });
  console.log('PASS: public phone layout and local touch matches, including the bottom row, match a deterministic replay.');
} catch (error) { failure = error; console.error(error); }
finally {
  await writeFile(`${output}/report.json`, JSON.stringify({ passed: !failure, errors, playerId: player?.id, failure: failure?.stack }, null, 2));
  if (player && /^[a-f0-9-]{36}$/.test(player.id)) await writeFile(`${output}/cleanup.sql`, `DELETE FROM records WHERE player_id = '${player.id}';\nDELETE FROM runs WHERE player_id = '${player.id}';\nDELETE FROM players WHERE id = '${player.id}';\n`);
  await browser.close();
}
if (failure) process.exitCode = 1;
