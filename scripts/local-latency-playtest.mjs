import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
const output = 'test-results/local-latency'; await mkdir(output, { recursive: true });
const api = spawn(process.execPath, ['scripts/api-server.mjs'], { windowsHide: true, stdio: 'pipe', env: { ...process.env, API_PORT: '8792', DATABASE_PATH: `.data/latency-${Date.now()}.sqlite`, ALLOWED_ORIGINS: 'http://127.0.0.1:5182' } });
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5182', '--strictPort'], { windowsHide: true, stdio: 'pipe', env: { ...process.env, VITE_API_URL: 'http://127.0.0.1:8792' } });
const timings = [], checks = [], errors = []; let browser, failure, stepRequests = 0;
const pass = text => { checks.push(text); console.log('PASS', text); };
async function ready(url) { for (let i = 0; i < 100; i++) { try { if ((await fetch(url)).ok) return; } catch {} await new Promise(r => setTimeout(r, 100)); } throw Error(`Server failed: ${url}`); }
try {
  await Promise.all([ready('http://127.0.0.1:8792/api/health'), ready('http://127.0.0.1:5182')]);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true });
  const page = await context.newPage(), cdp = await context.newCDPSession(page);
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (/\/api\/runs\/.+\/move$/.test(new URL(r.url()).pathname)) stepRequests++; });
  await page.goto('http://127.0.0.1:5182', { waitUntil: 'networkidle' });
  await page.locator('#register-name').fill('即时响应验收'); await page.locator('#register-submit').click(); await expect(page.locator('#start')).toBeEnabled({ timeout: 20000 });
  await page.locator('[data-difficulty="challenge"]').click(); await page.locator('#start').click(); await expect(page.locator('#hint')).toBeEnabled();
  await context.setOffline(true);
  await page.evaluate(() => document.querySelector('canvas').addEventListener('pointerup', () => {
    const probe = window.__latencyProbe = { start: performance.now(), elapsed: null };
    const tick = () => { if (window.__royalGems.presentation().frameKind !== 'idle') probe.elapsed = performance.now() - probe.start; else requestAnimationFrame(tick); }; requestAnimationFrame(tick);
  }));
  async function point(i) { await page.locator('canvas').scrollIntoViewIfNeeded(); const b = await page.locator('canvas').boundingBox(), layout = await page.evaluate(() => window.__royalGems.layout()); return { x: b.x + (12 + (i % 8 + .5) * 90) / layout.width * b.width, y: b.y + (12 + (Math.floor(i / 8) + .5) * layout.rowHeight) / layout.height * b.height }; }
  async function play(touch) {
    const pair = await page.evaluate(() => window.__royalGems.hint()), before = await page.evaluate(() => window.__royalGems.state().moves), a = await point(pair[0]), b = await point(pair[1]);
    if (touch) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...a, id: 1 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...b, id: 1 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else { await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 3 }); await page.mouse.up(); }
    await expect.poll(() => page.evaluate(() => window.__latencyProbe?.elapsed)).not.toBeNull();
    const elapsed = await page.evaluate(() => window.__latencyProbe.elapsed); expect(elapsed).toBeLessThan(150); timings.push({ touch, elapsedMs: Math.round(elapsed) });
    await expect(page.locator('#hint')).toBeEnabled({ timeout: 60000 }); expect(await page.evaluate(() => window.__royalGems.state().moves)).toBe(before + 1);
  }
  await play(false); await play(false); await page.setViewportSize({ width: 390, height: 844 }); await play(true); await play(true);
  expect(stepRequests).toBe(0); pass('desktop and touch moves start animation within 150ms with the network offline; zero per-step requests');
  const original = await page.evaluate(() => window.__royalGems.state());
  await page.evaluate(() => { const s = window.__royalGems.state(); s.board[10].special = 'ultimate'; window.__royalGems.load(s); });
  let p = await point(10); await page.mouse.click(p.x, p.y);
  await expect.poll(() => page.evaluate(() => window.__royalGems.input().selected), { timeout: 150 }).toBe(10);
  await page.waitForTimeout(300); p = await point(0); await page.mouse.click(p.x, p.y); p = await point(9); await page.mouse.click(p.x, p.y); await page.waitForTimeout(300);
  p = await point(10); await page.mouse.dblclick(p.x, p.y, { delay: 65 }); await expect(page.locator('#modal-title')).toContainText('终极');
  expect(await page.evaluate(() => window.__royalGems.state().moves)).toBe(original.moves);
  await page.locator('#modal-close').click(); await page.evaluate(s => window.__royalGems.load(s), original);
  pass('special first selection highlights immediately; double-click inspection with adjacent selection consumes no move');
  await page.evaluate(async () => { const online = await import('/src/online.ts'), { findMove } = await import('/src/engine.ts'); let s = window.__royalGems.state(); while (s.moves < 29) s = online.moveRun(...findMove(s.board)).state; window.__royalGems.load(s); });
  const finalPair = await page.evaluate(() => window.__royalGems.hint()), a = await point(finalPair[0]), b = await point(finalPair[1]);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 3 }); await page.mouse.up();
  await expect(page.locator('#modal-title')).toHaveText('挑战完成', { timeout: 60000 });
  await expect(page.locator('#result-submit-retry')).toBeVisible({ timeout: 20000 });
  const score = await page.evaluate(() => window.__royalGems.state().score);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('royal-pending-results-v1')).length)).toBe(1); expect(stepRequests).toBe(0);
  await page.screenshot({ path: `${output}/offline-result.png`, fullPage: true });
  await page.route('**/api/runs/*/complete', route => route.abort('internetdisconnected'));
  await context.setOffline(false); await page.reload({ waitUntil: 'networkidle' }); await expect(page.locator('#start')).toBeEnabled();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('royal-pending-results-v1')).length)).toBe(1);
  await page.unroute('**/api/runs/*/complete'); await page.evaluate(() => dispatchEvent(new Event('online')));
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('royal-pending-results-v1')).length)).toBe(0);
  await page.locator('[data-difficulty="challenge"]').click(); await expect(page.locator('#best-score')).toHaveText(score.toLocaleString('en-US'));
  await page.locator('#online-rankings').click(); await expect(page.locator('.challenge-table')).toContainText('即时响应验收');
  await page.screenshot({ path: `${output}/recovered-ranking.png`, fullPage: true });
  expect(errors).toEqual([]); pass('completed result survives network failure and reload, then uploads once on recovery and appears in the cloud ranking');
} catch (error) { failure = error; console.error(error); }
finally { await writeFile(`${output}/report.json`, JSON.stringify({ checks, timings, stepRequests, errors, failure: failure?.stack }, null, 2)); console.log('Latency measurements:', JSON.stringify(timings)); await browser?.close(); api.kill(); vite.kill(); }
if (failure) process.exitCode = 1;
