import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
const output = 'test-results/mobile-layout'; await mkdir(output, { recursive: true });
const api = spawn(process.execPath, ['scripts/api-server.mjs'], { windowsHide: true, stdio: 'pipe', env: { ...process.env, API_PORT: '8791', DATABASE_PATH: `.data/mobile-ui-${Date.now()}.sqlite`, ALLOWED_ORIGINS: 'http://127.0.0.1:5181' } });
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5181', '--strictPort'], { windowsHide: true, stdio: 'pipe', env: { ...process.env, VITE_API_URL: 'http://127.0.0.1:8791' } });
const errors = [], checks = [], metrics = []; let browser, failure;
const pass = text => { checks.push(text); console.log('PASS', text); };
async function ready(url) { for (let i = 0; i < 80; i++) { try { if ((await fetch(url)).ok) return; } catch {} await new Promise(r => setTimeout(r, 100)); } throw Error(`Server failed: ${url}`); }
try {
  await Promise.all([ready('http://127.0.0.1:8791/api/health'), ready('http://127.0.0.1:5181')]);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await context.newPage(), cdp = await context.newCDPSession(page);
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:5181', { waitUntil: 'networkidle' });
  await page.locator('#register-name').fill('手机适配验收'); await page.locator('#register-submit').click();
  await expect(page.locator('#start')).toBeEnabled({ timeout: 20000 });
  for (const width of [320, 360, 390, 430, 680]) {
    await page.setViewportSize({ width, height: 900 });
    const box = await page.evaluate(() => {
      const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom }; };
      return { companion: rect('.companion'), board: rect('canvas'), frame: rect('.board-frame'), roster: rect('.character-roster'), layout: window.__royalGems.layout(), overflow: document.documentElement.scrollWidth > innerWidth };
    });
    expect(box.companion.bottom).toBeLessThan(box.board.y);
    expect(Math.abs(box.board.width - box.board.height)).toBeLessThan(1);
    expect(box.board.width).toBeGreaterThan(width - 36);
    expect(box.layout.height).toBe(744); expect(box.overflow).toBe(false);
    metrics.push({ width, ...box });
    if (width === 390 || width === 320) await page.screenshot({ path: `${output}/ready-${width}.png`, fullPage: true });
  }
  pass('320–680px: hero selection precedes a larger square board; no horizontal overflow');
  await page.setViewportSize({ width: 390, height: 844 });
  for (let i = 0; i < 4; i++) { await page.locator(`[data-character="${i}"]`).tap(); await expect(page.locator(`[data-character="${i}"]`)).toHaveAttribute('aria-pressed', 'true'); }
  await page.locator('[data-difficulty="challenge"]').tap(); await page.locator('#start').tap(); await expect(page.locator('#hint')).toBeEnabled();
  async function point(index, badge = false) {
    await page.locator('canvas').scrollIntoViewIfNeeded(); const b = await page.locator('canvas').boundingBox(), layout = await page.evaluate(() => window.__royalGems.layout());
    return { x: b.x + (12 + (index % 8 + .5) * 90 + (badge ? 28 : 0)) / layout.width * b.width, y: b.y + (12 + (Math.floor(index / 8) + .5) * layout.rowHeight + (badge ? 28 : 0)) / layout.height * b.height };
  }
  async function swipe(a, b) {
    const start = await point(a), end = await point(b), serial = await page.evaluate(() => window.__royalGems.input().serial);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...end, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => page.evaluate(() => window.__royalGems.input().serial)).toBe(serial + 1);
    expect(await page.evaluate(() => window.__royalGems.input().pair)).toEqual([a, b]);
  }
  for (const pair of [[55, 54], [0, 8]]) { await swipe(...pair); await expect(page.locator('#hint')).toBeEnabled({ timeout: 60000 }); }
  const pair = await page.evaluate(() => window.__royalGems.hint()); await swipe(...pair);
  await expect(page.locator('#hint')).toBeEnabled({ timeout: 60000 });
  expect(await page.evaluate(() => window.__royalGems.state().moves)).toBeGreaterThan(0);
  await page.screenshot({ path: `${output}/playing-390.png`, fullPage: true });
  pass('touch swipes hit the bottom-right and top-left cells and resolve local matches');
  const original = await page.evaluate(() => window.__royalGems.state());
  await page.evaluate(() => { const s = window.__royalGems.state(); s.board[55].special = 'ultimate'; window.__royalGems.load(s); });
  const badge = await point(55, true); await page.touchscreen.tap(badge.x, badge.y);
  await expect(page.locator('#modal-title')).toContainText('终极'); await page.locator('#modal-close').tap();
  await page.evaluate(s => window.__royalGems.load(s), original);
  pass('last-row special-gem inspect badge remains aligned with its hit area');
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(() => page.evaluate(() => window.__royalGems.layout().height)).toBe(654);
  const desktop = await page.locator('canvas').boundingBox(); expect(desktop.width / desktop.height).toBeCloseTo(744 / 654, 2);
  const before = await page.evaluate(() => window.__royalGems.state().moves);
  const next = await page.evaluate(() => window.__royalGems.hint()); await swipe(...next);
  await page.setViewportSize({ width: 390, height: 844 }); // Switch while clear/drop animations are running.
  await expect(page.locator('#hint')).toBeEnabled({ timeout: 60000 });
  await expect.poll(() => page.evaluate(() => window.__royalGems.layout().height)).toBe(744);
  const after = await page.evaluate(() => ({ state: window.__royalGems.state(), displayed: window.__royalGems.displayed() }));
  expect(after.state.moves).toBe(before + 1); expect(after.displayed.board).toEqual(after.state.board);
  await swipe(55, 54); await expect(page.locator('#hint')).toBeEnabled({ timeout: 60000 });
  await page.screenshot({ path: `${output}/after-rotation.png`, fullPage: true });
  pass('desktop proportions stay unchanged; rotating during animation preserves the board and touch mapping');
  expect(errors).toEqual([]);
} catch (error) { failure = error; console.error(error); }
finally { await writeFile(`${output}/report.json`, JSON.stringify({ checks, metrics, errors, failure: failure?.stack }, null, 2)); await browser?.close(); api.kill(); vite.kill(); }
if (failure) process.exitCode = 1;
