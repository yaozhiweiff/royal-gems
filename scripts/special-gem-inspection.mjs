import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

// Run against Vite dev mode so deterministic fixtures can use its local-only hook.
// GAME_URL=http://127.0.0.1:5173 node scripts/special-gem-inspection.mjs
const url = process.env.GAME_URL || 'http://127.0.0.1:5173';
const output = 'test-results';
const kinds = [
  { kind: 'bomb', title: '爆炸宝石', description: /3\s*[×xX]\s*3/ },
  { kind: 'cross', title: '十字宝石', description: /整行.*整列/s },
  { kind: 'ultimate', title: '终极宝石', description: /清空|全部|全盘|整个棋盘/ },
];
const checks = [], errors = [];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
const page = await desktop.newPage(), touchPage = await mobile.newPage();
for (const p of [page, touchPage]) {
  p.on('pageerror', error => errors.push(error.message));
  p.on('response', response => {
    if (response.status() >= 400 && ['127.0.0.1', 'localhost'].includes(new URL(response.url()).hostname)) {
      errors.push(`HTTP ${response.status()} ${response.url()}`);
    }
  });
}
const record = name => { checks.push(name); console.log('PASS', name); };
const state = p => p.evaluate(() => window.__royalGems.state());
const idle = p => p.waitForFunction(() => !window.__royalGems.busy(), null, { timeout: 30000 });
// Deferred special-tile single taps must expire before checking for unwanted work.
const settle = async p => { await p.waitForTimeout(400); await idle(p); };

async function fixture(p, specials = []) {
  // A fresh page also resets selection and pending tap history between scenarios.
  await p.goto(url, { waitUntil: 'networkidle' });
  await expect(p.locator('#start')).toBeEnabled();
  await p.locator('#start').click();
  await p.evaluate(specials => {
    const api = window.__royalGems;
    const board = Array.from({ length: 56 }, (_, i) => api.newTile((i % 8 + Math.floor(i / 8) * 2) % 5));
    // Swapping cell 10 into cell 2 is a legal, deterministic opening match.
    [0, 1, 10].forEach(i => { board[i] = api.newTile(3); });
    board[2] = api.newTile(1); board[3] = api.newTile(4);
    for (const [i, kind] of specials) board[i] = api.newTile(board[i].color, kind);
    api.load({ board, score: 120, turns: 30, energy: 96, firstFired: false, status: 'playing', difficulty: 'hard' });
  }, specials);
  await idle(p);
  await expect(p.locator('#modal')).not.toBeVisible();
  await p.locator('canvas').scrollIntoViewIfNeeded();
}

async function point(p, cell, badge = false) {
  const box = await p.locator('canvas').boundingBox();
  expect(box).not.toBeNull();
  const offset = badge ? 28 : 0;
  return {
    x: box.x + (12 + (cell % 8 + .5) * 90 + offset) / 744 * box.width,
    y: box.y + (12 + (Math.floor(cell / 8) + .5) * 90 + offset) / 654 * box.height,
  };
}

async function click(p, cell, { badge = false, double = false, touch = false } = {}) {
  const { x, y } = await point(p, cell, badge);
  if (touch) {
    await p.touchscreen.tap(x, y);
    if (double) { await p.waitForTimeout(65); await p.touchscreen.tap(x, y); }
  } else if (double) await p.mouse.dblclick(x, y, { delay: 65 });
  else await p.mouse.click(x, y);
}

async function drag(p, a, b) {
  const from = await point(p, a), to = await point(p, b);
  await p.mouse.move(from.x, from.y);
  await p.mouse.down();
  await p.mouse.move(to.x, to.y, { steps: 8 });
  await p.mouse.up();
  await settle(p);
}

async function inspect(p, spec, before, screenshot) {
  await expect(p.locator('#modal')).toBeVisible();
  await expect(p.locator('#modal-title')).toHaveText(spec.title);
  await expect(p.locator('#modal-content')).toContainText(spec.description);
  await settle(p);
  expect(await state(p), 'Reading a special gem must preserve the entire game state').toEqual(before);
  if (screenshot) await p.screenshot({ path: `${output}/${screenshot}.png`, fullPage: true });
}

async function close(p, selector, before) {
  await p.locator(selector).click();
  await expect(p.locator('#modal')).not.toBeVisible();
  await settle(p);
  expect(await state(p), 'Closing details must not run a queued swap').toEqual(before);
}

async function expectMove(p, before) {
  await settle(p);
  await expect(p.locator('#modal')).not.toBeVisible();
  const after = await state(p);
  expect(after.turns).toBe(before.turns - 1);
  expect(after.score).toBeGreaterThan(before.score);
  expect(after.board).not.toEqual(before.board);
}

let failure;
try {
  await fixture(page, [[16, 'bomb'], [27, 'cross'], [40, 'ultimate']]);
  await page.screenshot({ path: `${output}/special-inspection-badges-desktop.png`, fullPage: true });
  record('desktop screenshot includes the inspection badges of all three special gem types');

  for (const spec of kinds) {
    await fixture(page, [[10, spec.kind]]);
    const before = await state(page);
    await click(page, 10, { badge: true });
    await inspect(page, spec, before, `special-inspection-${spec.kind}`);
    await close(page, '#inspect-done', before);
    record(`${spec.kind}: badge click opens matching details and confirmation preserves state`);

    await fixture(page, [[10, spec.kind]]);
    const doubleBefore = await state(page);
    await click(page, 10, { double: true });
    await inspect(page, spec, doubleBefore);
    await close(page, '#modal-close', doubleBefore);
    record(`${spec.kind}: double click opens matching details and X preserves state`);

    await fixture(page, [[10, spec.kind]]);
    const selectedBefore = await state(page);
    await click(page, 2); // Adjacent, and swapping 2/10 would actually clear gems.
    await click(page, 10, { double: true });
    await inspect(page, spec, selectedBefore);
    await close(page, '#inspect-done', selectedBefore);
    record(`${spec.kind}: double click with an adjacent selected gem does not swap or spend resources`);

    await fixture(page, [[10, spec.kind]]);
    const selectedBadgeBefore = await state(page);
    await click(page, 2);
    await click(page, 10, { badge: true });
    await inspect(page, spec, selectedBadgeBefore);
    await close(page, '#modal-close', selectedBadgeBefore);
    record(`${spec.kind}: badge click with an adjacent selected gem never acts as a swap`);

    await fixture(page, [[10, spec.kind]]);
    const swapBefore = await state(page);
    await click(page, 10);
    await click(page, 2);
    await expectMove(page, swapBefore);
    record(`${spec.kind}: ordinary single-click selection still swaps with an adjacent gem`);

    await fixture(page, [[10, spec.kind]]);
    const reverseSwapBefore = await state(page);
    await click(page, 2);
    await click(page, 10);
    await expectMove(page, reverseSwapBefore);
    record(`${spec.kind}: selecting a normal gem then single-clicking a special still swaps`);

    await fixture(page, [[10, spec.kind]]);
    const dragBefore = await state(page);
    await drag(page, 10, 2);
    await expectMove(page, dragBefore);
    record(`${spec.kind}: dragging still swaps and resolves its effect`);
  }

  await fixture(page);
  const normalBefore = await state(page);
  await click(page, 10, { double: true });
  await settle(page);
  await expect(page.locator('#modal')).not.toBeVisible();
  expect(await state(page)).toEqual(normalBefore);
  record('double clicking an ordinary gem does not open details or spend resources');

  await fixture(page, [[40, 'ultimate']]);
  const resumeBefore = await state(page);
  await click(page, 40, { badge: true });
  await inspect(page, kinds[2], resumeBefore);
  await close(page, '#inspect-done', resumeBefore);
  await drag(page, 10, 2);
  await expectMove(page, resumeBefore);
  record('normal gameplay resumes after closing a special-gem description');

  for (const spec of kinds) {
    await fixture(touchPage, [[10, spec.kind]]);
    const before = await state(touchPage);
    await click(touchPage, 10, { badge: true, touch: true });
    await inspect(touchPage, spec, before, `special-inspection-mobile-${spec.kind}`);
    await close(touchPage, '#inspect-done', before);
    record(`${spec.kind}: touch badge opens readable details without changing state`);

    await fixture(touchPage, [[10, spec.kind]]);
    const doubleBefore = await state(touchPage);
    await click(touchPage, 2, { touch: true });
    await click(touchPage, 10, { double: true, touch: true });
    await inspect(touchPage, spec, doubleBefore);
    await close(touchPage, '#modal-close', doubleBefore);
    record(`${spec.kind}: double tap wins over a pending adjacent selection`);
  }

  await fixture(touchPage, [[10, 'ultimate']]);
  const mobileMoveBefore = await state(touchPage);
  await click(touchPage, 10, { touch: true });
  await click(touchPage, 2, { touch: true });
  await expectMove(touchPage, mobileMoveBefore);
  record('touch single taps still swap a special gem');

  expect(errors, 'No application or local asset errors').toEqual([]);
  record('no application errors or failed local resources');
} catch (error) {
  failure = error;
  console.error(error);
  await Promise.allSettled([
    page.screenshot({ path: `${output}/special-inspection-failure-desktop.png`, fullPage: true }),
    touchPage.screenshot({ path: `${output}/special-inspection-failure-mobile.png`, fullPage: true }),
  ]);
} finally {
  await writeFile(`${output}/special-gem-inspection-report.json`, JSON.stringify({
    url, passed: checks.length, checks, errors, failure: failure ? String(failure.stack || failure) : null,
  }, null, 2));
  await browser.close();
}
if (failure) throw failure;
