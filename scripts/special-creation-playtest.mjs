import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const url = process.env.GAME_URL || 'http://127.0.0.1:5173';
const output = 'test-results/special-creation';
const checks = [], errors = [], runs = [];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const record = message => { checks.push(message); console.log('PASS', message); };
const idle = page => page.waitForFunction(() => !window.__royalGems.busy(), null, { timeout: 120000 });

async function createPage(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference', ...options });
  await context.addInitScript(() => {
    let seed = 681;
    Math.random = () => {
      let t = seed += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
    window.__birthTrace = [];
    const observe = () => {
      const api = window.__royalGems;
      if (api?.creation) {
        const state = api.creation();
        if (state.phase !== 'idle') window.__birthTrace.push({ ...state, time: performance.now(), frame: api.presentation().frameKind });
      }
      requestAnimationFrame(observe);
    };
    requestAnimationFrame(observe);
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(url, { waitUntil: 'networkidle' });
  await expect(page.locator('#start')).toBeEnabled();
  if (options.reducedMotion === 'reduce') {
    await page.locator('#motion-settings').click(); await page.locator('#motion-mode').selectOption('gentle'); await page.locator('#motion-save').click();
  }
  return page;
}

async function fixture(page, kind) {
  await idle(page);
  return page.evaluate(async kind => {
    const api = window.__royalGems, { findMatches } = await import('/src/engine.ts');
    const board = Array.from({ length: 56 }, (_, i) => api.newTile((i % 8 + Math.floor(i / 8) * 2) % 5));
    const set = (cells, color) => cells.forEach(i => board[i] = api.newTile(color));
    let pair = [10, 2], expected = 1, special = kind, energy = 0, character = 'ian';
    if (kind === 'bomb') { set([0, 1, 3, 10], 3); set([2], 1); }
    else if (kind === 'ultimate') { set([0, 1, 3, 4, 10], 3); set([2], 1); }
    else if (kind === 'cross') { set([17, 19, 10, 2, 26], 3); set([18], 1); set([20], 0); pair = [26, 18]; }
    else if (kind === 'double-bomb') {
      set([16, 17, 19, 26], 2); set([24, 25, 27, 18], 0); set([28], 1); pair = [18, 26]; expected = 2; special = 'bomb';
    } else {
      set([0, 1, 10], 3); set([2], 1); set([3], 4);
      if (kind === 'lance') { character = 'lance'; special = 'cross'; energy = 250; expected = 2; }
      if (kind === 'chris') { character = 'chris'; special = 'bomb'; energy = 250; expected = 2; }
      if (kind === 'ian') { special = 'ultimate'; energy = 500; }
    }
    if (findMatches(board).length) throw new Error(`Fixture ${kind} has an initial match`);
    window.__birthTrace = [];
    api.load({ board, character, difficulty: 'hard', score: 0, turns: 30, energy, firstFired: energy === 500, status: 'playing' });
    return { pair, expected, special, frame: energy ? 'skill' : 'clear' };
  }, kind);
}

async function exchange(page, pair, touch = false) {
  await page.locator('canvas').scrollIntoViewIfNeeded();
  const box = await page.locator('canvas').boundingBox();
  const point = i => ({ x: box.x + (12 + (i % 8 + .5) * 90) / 744 * box.width, y: box.y + (12 + (Math.floor(i / 8) + .5) * 90) / 654 * box.height });
  const a = point(pair[0]), b = point(pair[1]);
  if (touch) { await page.touchscreen.tap(a.x, a.y); await page.touchscreen.tap(b.x, b.y); }
  else { await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 4 }); await page.mouse.up(); }
}

async function run(page, kind, suffix = '', touch = false) {
  const setup = await fixture(page, kind), stem = `${kind}${suffix}`;
  await exchange(page, setup.pair, touch);
  await page.waitForFunction(frame => {
    const api = window.__royalGems, creation = api.creation();
    return api.presentation().frameKind === frame && creation.phase === 'clearing';
  }, setup.frame, { timeout: 30000 });
  const begin = await page.evaluate(() => ({ creation: window.__royalGems.creation(), displayed: window.__royalGems.displayed() }));
  expect(begin.creation.cells).toHaveLength(setup.expected);
  expect(begin.creation.newViews.every(v => v === null)).toBe(true);
  expect(begin.creation.cells.every(i => begin.displayed.board[i].special === setup.special)).toBe(true);
  await page.waitForFunction(() => {
    const c = window.__royalGems.creation();
    return c.phase === 'clearing' && c.oldViews.some(v => v && v.alpha > .05 && v.alpha < .85) && c.newViews.every(v => v === null);
  });
  await page.locator('canvas').screenshot({ path: `${output}/${stem}-1-old-dissolving.png` });
  await page.waitForFunction(() => window.__royalGems.creation().phase === 'empty');
  const empty = await page.evaluate(() => window.__royalGems.creation());
  expect(empty.oldViews.every(v => v === null)).toBe(true);
  expect(empty.newViews.every(v => v === null)).toBe(true);
  expect(empty.effectActive).toBe(false);
  await page.locator('canvas').screenshot({ path: `${output}/${stem}-2-empty.png` });
  await page.waitForFunction(() => window.__royalGems.creation().phase === 'forming');
  const forming = await page.evaluate(() => ({ creation: window.__royalGems.creation(), displayed: window.__royalGems.displayed() }));
  expect(forming.displayed).toEqual(begin.displayed);
  expect(forming.creation.oldViews.every(v => v === null)).toBe(true);
  expect(forming.creation.newViews.every(v => v && v.alpha < 1)).toBe(true);
  expect(forming.creation.effectActive).toBe(true);
  const first = await page.locator('canvas').screenshot({ path: `${output}/${stem}-3-forming.png` });
  const locked = await page.evaluate(() => window.__royalGems.state());
  await expect(page.locator('#motion-settings')).toBeDisabled();
  await exchange(page, setup.pair, touch);
  expect(await page.evaluate(() => window.__royalGems.state())).toEqual(locked);
  const second = await page.locator('canvas').screenshot({ path: `${output}/${stem}-4-formed.png` });
  expect((await sharp(first).raw().toBuffer()).equals(await sharp(second).raw().toBuffer())).toBe(false);
  await idle(page);
  await page.waitForFunction(() => window.__royalGems.effects().activeObjects === 0);
  const trace = await page.evaluate(() => window.__birthTrace);
  const events = trace.filter(t => t.newIds.join(',') === begin.creation.newIds.join(','));
  const phases = [...new Set(events.map(t => t.phase))];
  expect(phases).toEqual(['clearing', 'empty', 'forming']);
  expect(events.filter(t => t.phase !== 'forming').every(t => t.newViews.every(v => v === null))).toBe(true);
  expect(events.filter(t => t.phase === 'forming').every(t => t.oldViews.every(v => v === null))).toBe(true);
  const fade = events.filter(t => t.phase === 'clearing');
  expect(fade.some(t => t.oldViews.every(v => v && v.alpha === 0))).toBe(true);
  const birth = events.filter(t => t.phase === 'forming');
  expect(birth.at(-1).time - birth[0].time).toBeGreaterThan(250);
  expect(birth.at(-1).newViews.every(v => v && v.alpha > .95)).toBe(true);
  expect(await page.evaluate(() => window.__royalGems.creation().effectActive)).toBe(false);
  await page.screenshot({ path: `${output}/${stem}-5-settled.png`, fullPage: true });
  runs.push({ stem, phases, cells: begin.creation.cells, duration: birth.at(-1).time - birth[0].time, trace: events });
  record(`${stem}: original dissolves completely → empty cell → new ${setup.special} forms, no early overlay or extra resource change`);
}

let failure;
try {
  const desktop = await createPage();
  for (const kind of ['bomb', 'cross', 'ultimate', 'double-bomb', 'lance', 'chris', 'ian']) await run(desktop, kind);
  const gentle = await createPage({ reducedMotion: 'reduce' });
  for (const kind of ['bomb', 'cross', 'ultimate']) await run(gentle, kind, '-gentle');
  const mobile = await createPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await run(mobile, 'ultimate', '-mobile', true);
  expect(errors).toEqual([]);
  record('desktop, gentle mode and phone touch have no runtime or asset errors');
} catch (error) { failure = error; console.error(error); }
finally {
  await writeFile(`${output}/report.json`, JSON.stringify({ passed: checks.length, checks, errors, runs, failure: failure?.message }, null, 2));
  await browser.close();
}
if (failure) process.exitCode = 1;
