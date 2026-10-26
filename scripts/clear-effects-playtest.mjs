import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

// Fixture boards are loaded only through the development hook; every tested move
// is a real pointer drag or touch interaction through the canvas.
const url = process.env.GAME_URL || 'http://127.0.0.1:5173';
const output = 'test-results/clear-effects';
const checks = [], errors = [], runs = [];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const contexts = [];
const record = name => { checks.push(name); console.log('PASS', name); };
const idle = page => page.waitForFunction(() => !window.__royalGems.busy(), null, { timeout: 60000 });
const state = page => page.evaluate(() => window.__royalGems.state());
const effects = page => page.evaluate(() => window.__royalGems.effects());

async function createPage(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  contexts.push(context);
  await context.addInitScript(() => {
    window.__fxAcceptance = { events: [], lastSerial: -1 };
    const observe = () => {
      const api = window.__royalGems, trace = window.__fxAcceptance;
      if (api?.effects) {
        const stats = api.effects();
        if (stats.serial > 0 && stats.serial !== trace.lastSerial) {
          trace.lastSerial = stats.serial;
          trace.events.push({ ...stats, startedBusy: api.busy(), maxActive: stats.activeObjects, lastActive: stats.activeObjects });
        }
        const current = trace.events.at(-1);
        if (current?.serial === stats.serial) {
          current.maxActive = Math.max(current.maxActive, stats.activeObjects);
          current.lastActive = stats.activeObjects;
        }
      }
      requestAnimationFrame(observe);
    };
    requestAnimationFrame(observe);
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => {
    if (response.status() >= 400 && ['127.0.0.1', 'localhost'].includes(new URL(response.url()).hostname)) {
      errors.push(`HTTP ${response.status()} ${response.url()}`);
    }
  });
  await page.goto(url, { waitUntil: 'networkidle' });
  await expect(page.locator('#start')).toBeEnabled();
  if (options.reducedMotion === 'reduce') {
    await page.locator('#motion-settings').click(); await page.locator('#motion-mode').selectOption('gentle'); await page.locator('#motion-save').click();
  }
  await page.locator('[data-difficulty="hard"]').click();
  await page.locator('#start').click();
  await page.waitForFunction(() => typeof window.__royalGems?.effects === 'function');
  return page;
}

async function fixture(page, kind) {
  await idle(page);
  await page.waitForFunction(() => window.__royalGems.effects().activeObjects === 0);
  return page.evaluate(kind => {
    const api = window.__royalGems;
    const board = Array.from({ length: 56 }, (_, i) => api.newTile((i % 8 + Math.floor(i / 8) * 2) % 5));
    const set = (cells, color, special = 'normal') => cells.forEach(i => { board[i] = api.newTile(color, special); });
    let pair = [10, 2], expectedCount = 3;
    if (['normal', 'bomb', 'cross', 'cross-chain'].includes(kind)) {
      set([0, 1, 10], 3); set([2], 1); set([3], 4);
      if (kind === 'bomb') { set([10], 3, 'bomb'); expectedCount = 7; }
      if (kind === 'cross' || kind === 'cross-chain') { set([10], 3, 'cross'); expectedCount = 14; }
      if (kind === 'cross-chain') { set([18], board[18].color, 'cross'); set([34], board[34].color, 'cross'); expectedCount = 28; }
    } else if (kind === 'six-normal') {
      // One exchange completes independent triples on both sides of the swap.
      set([16, 17, 26], 2); set([18, 24, 25], 0); set([19], 3);
      pair = [18, 26]; expectedCount = 6;
    } else if (kind === 'cascade') {
      // Clearing column 0 drops a retained blue gem beside the blue pair on row 5.
      // This second wave is guaranteed, independent of randomly refilled gems.
      set([24, 32, 41], 0); set([16, 40, 42], 2);
      pair = [41, 40]; expectedCount = 3;
    } else {
      set([0], 0, 'ultimate'); pair = [0, 1];
      if (kind === 'double-ultimate') { set([1], 1, 'ultimate'); expectedCount = 56; }
      else expectedCount = board.filter(tile => tile.color === board[1].color).length + 1;
    }
    api.load({ board, score: 0, turns: 30, energy: 0, firstFired: false, status: 'playing', difficulty: 'hard' });
    window.__fxAcceptance.events = [];
    window.__fxAcceptance.lastSerial = api.effects().serial;
    return { pair, expectedCount, serial: api.effects().serial };
  }, kind);
}

async function point(page, cell) {
  const box = await page.locator('canvas').boundingBox();
  expect(box).not.toBeNull();
  return {
    x: box.x + (12 + (cell % 8 + .5) * 90) / 744 * box.width,
    y: box.y + (12 + (Math.floor(cell / 8) + .5) * 90) / 654 * box.height,
  };
}

async function exchange(page, pair, touch = false, steps = 5) {
  const from = await point(page, pair[0]), to = await point(page, pair[1]);
  if (touch) {
    await page.touchscreen.tap(from.x, from.y);
    await page.touchscreen.tap(to.x, to.y);
  } else {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps });
    await page.mouse.up();
  }
}

async function playCase(page, kind, suffix = '', { touch = false, reduced = false, verifyInput = false } = {}) {
  const setup = await fixture(page, kind);
  await page.locator('canvas').scrollIntoViewIfNeeded();
  await exchange(page, setup.pair, touch);
  await page.waitForFunction(serial => window.__royalGems.effects().serial > serial, setup.serial);
  const first = await effects(page);
  const tier = setup.expectedCount >= 24 ? 3 : setup.expectedCount >= 12 ? 2 : setup.expectedCount >= 6 ? 1 : 0;
  expect(first.count, `${kind}: actual first-wave removed gem count`).toBe(setup.expectedCount);
  expect(first.tier, `${kind}: visual strength follows removed gem count`).toBe(tier);
  expect(first.reducedMotion).toBe(reduced);
  expect(first.activeObjects).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__royalGems.busy())).toBe(true);
  await expect(page.locator('#restart')).toBeDisabled();
  await expect(page.locator('#hint')).toBeDisabled();
  const lockedState = await state(page);
  if (verifyInput) {
    // A second real drag while the first move resolves must be ignored, never queued.
    // Use a legal move on the engine's resolved board so an unlocked handler would
    // necessarily spend a turn instead of silently reverting an invalid exchange.
    const legalPair = await page.evaluate(() => window.__royalGems.hint());
    expect(legalPair).not.toBeNull();
    await exchange(page, legalPair, false, 1);
    expect(await state(page)).toEqual(lockedState);
  }
  await page.screenshot({ path: `${output}/${kind}${suffix}-active.png`, fullPage: true });
  await idle(page);
  await page.waitForFunction(() => window.__royalGems.effects().activeObjects === 0, null, { timeout: 2000 });
  const after = await state(page);
  expect(after.turns, 'All cascades must consume exactly one turn').toBe(29);
  expect(after.score).toBeGreaterThanOrEqual(setup.expectedCount * 10);
  expect(after.score % 10).toBe(0);
  expect(after.board).toHaveLength(56);
  expect(after.board.every(Boolean)).toBe(true);
  expect(new Set(after.board.map(tile => tile.id)).size).toBe(56);
  if (verifyInput) expect(after).toEqual(lockedState);
  const trace = await page.evaluate(() => window.__fxAcceptance.events);
  expect(trace.length).toBeGreaterThan(0);
  for (const event of trace) {
    expect(event.startedBusy).toBe(true);
    expect(event.tier).toBe(event.count >= 24 ? 3 : event.count >= 12 ? 2 : event.count >= 6 ? 1 : 0);
  }
  if (kind === 'cascade') expect(trace.length, 'Retained gems produce a guaranteed second clear').toBeGreaterThanOrEqual(2);
  await expect(page.locator('#hint')).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${output}/${kind}${suffix}-settled.png`, fullPage: true });
  const result = { name: `${kind}${suffix}`, first, score: after.score, turns: after.turns, waves: trace.length, trace };
  runs.push(result);
  record(`${kind}${suffix}: tier ${tier}, ${setup.expectedCount} gems, ${trace.length} wave(s), effects cleaned up and input restored`);
  return result;
}

let failure;
try {
  const desktop = await createPage();
  const ordinary = await playCase(desktop, 'normal');
  await playCase(desktop, 'six-normal');
  await playCase(desktop, 'bomb');
  await playCase(desktop, 'cross');
  await playCase(desktop, 'ultimate');
  await playCase(desktop, 'cross-chain');
  const grand = await playCase(desktop, 'double-ultimate', '', { verifyInput: true });
  await playCase(desktop, 'cascade');
  await playCase(desktop, 'normal', '-input-lock', { verifyInput: true });
  expect(grand.first.peakObjects).toBeGreaterThan(ordinary.first.peakObjects);
  expect(grand.first.duration).toBeGreaterThan(ordinary.first.duration);
  record('large clears add visible effect layers and a longer flourish than ordinary triples');

  const reducedPage = await createPage({ reducedMotion: 'reduce' });
  const reduced = await playCase(reducedPage, 'double-ultimate', '-reduced', { reduced: true });
  expect(reduced.first.duration).toBeLessThan(grand.first.duration);
  expect(reduced.first.peakObjects).toBeLessThan(grand.first.peakObjects);
  record('reduced-motion mode keeps large-clear feedback shorter and lighter');

  const mobile = await createPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await playCase(mobile, 'double-ultimate', '-mobile', { touch: true });
  await playCase(mobile, 'normal', '-mobile', { touch: true });
  expect(errors).toEqual([]);
  record('desktop and mobile produce no runtime errors, console errors, or failed local assets');
} catch (error) {
  failure = error;
  console.error(error);
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify({ passed: checks.length, checks, errors, runs, failure: failure?.stack }, null, 2));
  for (const context of contexts) await context.close();
  await browser.close();
}
if (failure) throw failure;
