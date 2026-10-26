import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const output = 'test-results/combinations', checks = [], errors = [], runs = [];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const record = text => { checks.push(text); console.log('PASS', text); };
const idle = p => p.waitForFunction(() => !window.__royalGems.busy(), null, { timeout: 60000 });
async function page(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', ...options });
  await context.addInitScript(() => {
    let seed = 681;
    Math.random = () => { let t = seed += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    window.__combinationTrace = { frames: [], effects: [], creation: [], lastSerial: -1, lastFrame: '' };
    function observe() {
      const api = window.__royalGems, trace = window.__combinationTrace;
      if (api) {
        const p = api.presentation(), fx = api.effects(), c = api.creation();
        const key = p.frameKind + (p.combination?.kind || '');
        if (key !== trace.lastFrame) { trace.lastFrame = key; trace.frames.push({ ...p, state: api.displayed(), time: performance.now() }); }
        if (fx.serial !== trace.lastSerial) { trace.lastSerial = fx.serial; trace.effects.push({ ...fx, frame: p.frameKind, time: performance.now() }); }
        if (p.frameKind === 'combine' && c.phase !== 'idle') trace.creation.push({ ...c, time: performance.now() });
      }
      requestAnimationFrame(observe);
    }
    requestAnimationFrame(observe);
  });
  const p = await context.newPage();
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  p.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  await p.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' });
  await expect(p.locator('#start')).toBeEnabled();
  return p;
}
async function point(p, cell, badge = false) {
  const box = await p.locator('canvas').boundingBox(), offset = badge ? 28 : 0;
  return { x: box.x + (12 + (cell % 8 + .5) * 90 + offset) / 744 * box.width, y: box.y + (12 + (Math.floor(cell / 8) + .5) * 90 + offset) / 654 * box.height };
}
async function exchange(p, pair, touch) {
  const a = await point(p, pair[0]), b = await point(p, pair[1]);
  if (touch) { await p.touchscreen.tap(a.x, a.y); await p.touchscreen.tap(b.x, b.y); }
  else { await p.mouse.move(a.x, a.y); await p.mouse.down(); await p.mouse.move(b.x, b.y, { steps: 4 }); await p.mouse.up(); }
}
async function fixture(p, kinds, pair) {
  await idle(p);
  await p.evaluate(({ kinds, pair }) => {
    const api = window.__royalGems;
    const board = Array.from({ length: 56 }, (_, i) => api.newTile((i % 8 + Math.floor(i / 8) * 2) % 5));
    board[pair[0]] = api.newTile(0, kinds[0]); board[pair[1]] = api.newTile(1, kinds[1]);
    api.load({ board, score: 0, energy: 0, turns: 30, character: 'ian', firstFired: true, difficulty: 'hard', status: 'playing' });
    window.__combinationTrace = { frames: [], effects: [], creation: [], lastSerial: api.effects().serial, lastFrame: '' };
  }, { kinds, pair });
  await p.locator('canvas').scrollIntoViewIfNeeded();
}
async function run(p, kind, kinds, { expected, pair = [26, 27], touch = false, suffix = '', conversion = false } = {}) {
  await fixture(p, kinds, pair);
  const stem = kind + suffix;
  await exchange(p, pair, touch);
  await p.waitForFunction(kind => {
    const a = window.__royalGems.presentation(); return a.frameKind === 'combine' && a.combination?.kind === kind;
  }, kind);
  const locked = await p.evaluate(() => window.__royalGems.state());
  await expect(p.locator('#restart')).toBeDisabled();
  if (conversion) {
    await p.waitForFunction(() => window.__royalGems.creation().phase === 'forming');
    await p.locator('canvas').screenshot({ path: `${output}/${stem}-conversion.png` });
  }
  await p.waitForFunction(kind => {
    const api = window.__royalGems, fx = api.effects(), p = api.presentation();
    return p.frameKind === 'clear' && p.combination?.kind === kind && fx.combination === kind && fx.count > 0;
  }, kind);
  const fx = await p.evaluate(() => window.__royalGems.effects());
  if (expected) expect(fx.count).toBe(expected);
  expect(fx.activeObjects).toBeGreaterThan(0);
  const a = await p.locator('canvas').screenshot({ path: `${output}/${stem}-burst.png` });
  await p.waitForTimeout(90);
  const b = await p.locator('canvas').screenshot({ path: `${output}/${stem}-burst-next.png` });
  expect((await sharp(a).raw().toBuffer()).equals(await sharp(b).raw().toBuffer())).toBe(false);
  await exchange(p, pair, touch);
  expect(await p.evaluate(() => window.__royalGems.state())).toEqual(locked);
  await idle(p); await p.waitForFunction(() => window.__royalGems.effects().activeObjects === 0);
  const trace = await p.evaluate(() => window.__combinationTrace);
  const combined = trace.frames.find(f => f.frameKind === 'combine'), clear = trace.frames.find(f => f.frameKind === 'clear' && f.combination?.kind === kind);
  expect(combined).toBeTruthy(); expect(clear).toBeTruthy();
  expect(clear.state.turns).toBe(29); expect(clear.state.score).toBe(fx.count * 10); expect(clear.state.energy).toBe(50 + fx.count * 2);
  if (conversion) {
    const swap = trace.frames.find(f => f.frameKind === 'swap');
    const color = combined.combination.color, special = kind.endsWith('bomb') ? 'bomb' : 'cross';
    const cells = swap.state.board.flatMap((t, i) => t && t.special !== 'ultimate' && t.color === color ? [i] : []);
    expect(cells.length).toBeGreaterThan(1);
    cells.forEach(i => expect(combined.state.board[i].special).toBe(special));
    expect(combined.state.score).toBe(0); expect(combined.state.energy).toBe(50);
    expect([...new Set(trace.creation.map(t => t.phase))]).toEqual(['clearing', 'empty', 'forming']);
    expect(trace.creation.filter(t => t.phase !== 'forming').every(t => t.newViews.every(v => v === null))).toBe(true);
    expect(trace.creation.at(-1).time).toBeLessThan(clear.time);
  }
  await expect(p.locator('#target')).toHaveText('10,000');
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  runs.push({ stem, fx, trace }); record(`${stem}: actual swap, combination effect, ${fx.count} scored once, input lock and cleanup${conversion ? ', visible conversion before blast' : ''}`);
}
let failure;
try {
  const desktop = await page();
  expect(await desktop.evaluate(() => ({ mode: window.__royalGems.presentation().mode, speed: window.__royalGems.presentation().speed }))).toEqual({ mode: 'full', speed: 'normal' });
  await desktop.locator('#motion-settings').click();
  await expect(desktop.locator('#motion-mode')).toHaveValue('full'); await expect(desktop.locator('#animation-speed')).toHaveValue('normal');
  await desktop.screenshot({ path: `${output}/defaults.png`, fullPage: true });
  await desktop.locator('#motion-save').click(); record('fresh defaults are full effects + standard speed even with system reduced motion');
  await desktop.locator('[data-difficulty="hard"]').click(); await expect(desktop.locator('#target')).toHaveText('10,000');
  await desktop.locator('header .guide-button').click();
  await expect(desktop.locator('.rule-combinations')).toContainText('3 整行与 3 整列');
  await desktop.locator('.rule-combinations').scrollIntoViewIfNeeded(); await desktop.screenshot({ path: `${output}/rules.png`, fullPage: true }); await desktop.locator('#rules-done').click();
  for (const [kind, kinds, expected] of [['bomb-bomb', ['bomb', 'bomb'], 25], ['bomb-cross', ['bomb', 'cross'], 36], ['cross-cross', ['cross', 'cross'], 26], ['ultimate-ultimate', ['ultimate', 'ultimate'], 56]]) await run(desktop, kind, kinds, { expected });
  await run(desktop, 'ultimate-bomb', ['ultimate', 'bomb'], { conversion: true });
  await run(desktop, 'ultimate-cross', ['ultimate', 'cross'], { conversion: true });
  await run(desktop, 'bomb-bomb', ['bomb', 'bomb'], { expected: 9, pair: [1, 0], suffix: '-corner' });
  await desktop.locator('#motion-settings').click(); await desktop.locator('#motion-mode').selectOption('gentle'); await desktop.locator('#motion-save').click();
  await desktop.reload({ waitUntil: 'networkidle' }); expect((await desktop.evaluate(() => window.__royalGems.presentation())).mode).toBe('gentle');
  await run(desktop, 'ultimate-cross', ['ultimate', 'cross'], { conversion: true, suffix: '-gentle' });
  const mobile = await page({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await run(mobile, 'bomb-cross', ['bomb', 'cross'], { expected: 36, touch: true, suffix: '-mobile' });
  await run(mobile, 'ultimate-bomb', ['ultimate', 'bomb'], { conversion: true, touch: true, suffix: '-mobile' });
  await fixture(mobile, ['bomb', 'cross'], [26, 27]);
  const before = await mobile.evaluate(() => window.__royalGems.state()), badge = await point(mobile, 26, true);
  await mobile.touchscreen.tap(badge.x, badge.y); await expect(mobile.locator('#modal-content')).toContainText('组合交换');
  await expect(mobile.locator('#modal-content')).toContainText('5×5');
  await mobile.screenshot({ path: `${output}/mobile-inspection.png`, fullPage: true }); await mobile.locator('#inspect-done').click();
  expect(await mobile.evaluate(() => window.__royalGems.state())).toEqual(before);
  expect(errors).toEqual([]); record('mobile combination descriptions, preference persistence, no runtime or asset errors');
} catch (error) { failure = error; console.error(error); }
finally { await writeFile(`${output}/report.json`, JSON.stringify({ passed: checks.length, checks, errors, runs, failure: failure?.stack }, null, 2)); await browser.close(); }
if (failure) process.exitCode = 1;
