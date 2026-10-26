import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { sqliteDatabase } from '../backend/sqlite.mjs';
const database = `.data/ranking-ui-${Date.now()}.sqlite`, output = 'test-results/ranking-restart';
await mkdir(output, { recursive: true });
const api = spawn(process.execPath, ['scripts/api-server.mjs'], { windowsHide: true, stdio: 'pipe', env: { ...process.env, API_PORT: '8790', DATABASE_PATH: database, ALLOWED_ORIGINS: 'http://127.0.0.1:5180' } });
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5180', '--strictPort'], { windowsHide: true, stdio: 'pipe', env: { ...process.env, VITE_API_URL: 'http://127.0.0.1:8790' } });
const errors = [], checks = []; let browser, db, failure;
const pass = text => { checks.push(text); console.log('PASS', text); };
async function ready(url) { for (let i = 0; i < 80; i++) { try { if ((await fetch(url)).ok) return; } catch { /* wait for owned servers */ } await new Promise(r => setTimeout(r, 100)); } throw Error(`Server failed: ${url}`); }
try {
  await Promise.all([ready('http://127.0.0.1:8790/api/health'), ready('http://127.0.0.1:5180')]);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => errors.push(e.message));
  let starts = 0;
  page.on('request', r => { if (new URL(r.url()).pathname === '/api/runs' && r.method() === 'POST') starts++; });
  await page.goto('http://127.0.0.1:5180', { waitUntil: 'networkidle' });
  await page.locator('#register-name').fill('排行验收');
  const registered = page.waitForResponse(r => new URL(r.url()).pathname === '/api/register' && r.status() === 201);
  await page.locator('#register-submit').click(); const player = (await (await registered).json()).player;
  await expect(page.locator('#ranking-status')).toContainText('当前未上榜');
  pass('unranked player gets completion guidance');
  db = sqliteDatabase(database);
  for (let i = 0; i < 11; i++) {
    await db.prepare('INSERT INTO players VALUES(?,?,?,?,?)').bind(`fixture${i}`, `排行对手${i}`, `fixturekey${i}`, `fixturehash${i}`, i).run();
    for (const mode of ['easy', 'hard', 'challenge']) await db.prepare('INSERT INTO records VALUES(?,?,?,?,?)').bind(`fixture${i}`, mode, 'beth', mode === 'challenge' ? 2000 - i * 50 : (i + 1) * 2, i).run();
  }
  for (const [mode, value] of [['easy', 24], ['hard', 30], ['challenge', 1000]]) await db.prepare('INSERT INTO records VALUES(?,?,?,?,?)').bind(player.id, mode, 'lance', value, 100).run();
  await page.locator('#online-rankings').click();
  await expect(page.locator('#ranking-personal')).toHaveText('当前第 12 名 · 距上一名 2 回合');
  await expect(page.locator('#ranking-status')).toHaveText('当前第 12 名 · 距上一名 2 回合');
  await expect(page.locator('.challenge-table tbody tr')).toHaveCount(10);
  await page.screenshot({ path: `${output}/modal.png`, fullPage: true });
  await page.locator('[data-ranking="challenge"]').click(); await expect(page.locator('#ranking-personal')).toHaveText('当前第 12 名 · 距上一名 500 分');
  await page.locator('#modal-close').click();
  await page.locator('[data-difficulty="hard"]').click(); await expect(page.locator('#ranking-status')).toHaveText('当前第 12 名 · 距上一名 8 回合');
  pass('rank beyond top ten and previous-place gaps match each mode');
  await db.prepare('UPDATE records SET value = 22 WHERE player_id = ? AND mode = ?').bind(player.id, 'easy').run();
  await page.locator('[data-difficulty="easy"]').click(); await expect(page.locator('#ranking-status')).toContainText('与上一名回合相同');
  await page.screenshot({ path: `${output}/desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${output}/mobile.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await db.prepare('UPDATE records SET value = 1 WHERE player_id = ? AND mode = ?').bind(player.id, 'easy').run();
  await page.locator('#online-rankings').click(); await expect(page.locator('#ranking-personal')).toHaveText('当前第 1 名 · 已位居榜首');
  await page.locator('#modal-close').click();
  pass('ties and first place have accurate hints; mobile text fits');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('#start').click(); await expect(page.locator('#hint')).toBeEnabled(); expect(starts).toBe(1);
  await page.locator('#restart').click(); await page.locator('#keep-playing').click(); await expect(page.locator('#hint')).toBeEnabled();
  await page.locator('#restart').click(); await page.locator('#confirm-restart').click();
  await expect(page.locator('#setup-actions')).toBeVisible(); await expect(page.locator('#play-actions')).toBeHidden();
  for (const button of await page.locator('[data-character], [data-difficulty]').all()) await expect(button).toBeEnabled();
  expect(starts).toBe(1); // Returning to setup must not create a game automatically.
  await page.locator('[data-difficulty="hard"]').click(); await page.locator('[data-character="3"]').click();
  const next = page.waitForRequest(r => new URL(r.url()).pathname === '/api/runs' && r.method() === 'POST');
  await page.locator('#start').click(); expect((await next).postDataJSON()).toEqual({ mode: 'hard', character: 'ian' });
  await expect(page.locator('#hint')).toBeEnabled(); expect(starts).toBe(2);
  await page.evaluate(() => window.__royalGems.load({ status: 'won' }));
  await page.locator('#restart').click(); await expect(page.locator('#setup-actions')).toBeVisible(); expect(starts).toBe(2);
  pass('restart cancellation preserves play; confirmation and ended-game restart return to hero/difficulty setup; next start uses the new choices');
  expect(errors).toEqual([]);
} catch (error) { failure = error; console.error(error); }
finally {
  await writeFile(`${output}/report.json`, JSON.stringify({ passed: checks.length, checks, errors, failure: failure?.stack }, null, 2));
  await browser?.close(); db?.close(); api.kill(); vite.kill();
}
if (failure) process.exitCode = 1;
