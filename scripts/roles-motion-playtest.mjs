import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

// Fixture injection only arranges the board. Actions, settings, character choice,
// restarts and skill activation are exercised through the visible UI.
const url = process.env.GAME_URL || 'http://127.0.0.1:5173';
const output = 'test-results/roles-motion';
const checks = [], errors = [], runs = [], contexts = [];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const record = name => { checks.push(name); console.log('PASS', name); };
const state = page => page.evaluate(() => window.__royalGems.state());
const presentation = page => page.evaluate(() => window.__royalGems.presentation());
const idle = page => page.waitForFunction(() => !window.__royalGems.busy(), null, { timeout: 120000 });
const roster = [
  { id: 'beth', name: '贝丝' }, { id: 'lance', name: '兰斯' },
  { id: 'chris', name: '克丽丝' }, { id: 'ian', name: '伊恩' },
];

async function createPage(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  contexts.push(context);
  await context.addInitScript(() => {
    // A repeatable refill stream makes the skill fixture stable across runs.
    window.__roleSeed = 681;
    Math.random = () => {
      let seed = window.__roleSeed += 0x6D2B79F5;
      seed = Math.imul(seed ^ seed >>> 15, seed | 1);
      seed ^= seed + Math.imul(seed ^ seed >>> 7, seed | 61);
      return ((seed ^ seed >>> 14) >>> 0) / 4294967296;
    };
    window.__roleTrace = { effects: [], skills: [], lastSerial: -1, lastSkill: '', phases: [] };
    const observe = () => {
      const api = window.__royalGems, trace = window.__roleTrace;
      if (api?.effects) {
        const banner = document.querySelector('#skill-banner');
        const skill = banner?.classList.contains('visible') ? banner.textContent.trim() : '';
        if (skill && skill !== trace.lastSkill) {
          trace.skills.push({ name: skill, turns: Number(document.querySelector('#turns')?.textContent), at: performance.now() });
        }
        trace.lastSkill = skill;
        const stats = api.effects();
        if (stats.serial > 0 && stats.serial !== trace.lastSerial) {
          trace.lastSerial = stats.serial;
          trace.effects.push({ ...stats, startedAt: performance.now(), busy: api.busy(), afterSkill: trace.skills.at(-1)?.name || '' });
        }
        if (api.presentation) {
          const current = api.presentation();
          const phase = current.phase ?? current.frameKind;
          if (phase && trace.phases.at(-1)?.phase !== phase) trace.phases.push({ phase, at: performance.now() });
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
    if (response.status() >= 400 && ['127.0.0.1', 'localhost'].includes(new URL(response.url()).hostname)) errors.push(`HTTP ${response.status()} ${response.url()}`);
  });
  await page.goto(url, { waitUntil: 'networkidle' });
  await expect(page.locator('#start')).toBeEnabled();
  await page.waitForFunction(() => typeof window.__royalGems?.presentation === 'function');
  return page;
}

async function settings(page, mode, speed) {
  await idle(page);
  const before = await state(page);
  await page.locator('#motion-settings').click();
  await expect(page.locator('#modal')).toBeVisible();
  await page.locator('#motion-mode').selectOption(mode);
  await page.locator('#animation-speed').selectOption(speed);
  await page.screenshot({ path: `${output}/settings-${mode}-${speed}-${page.viewportSize().width}.png`, fullPage: true });
  await page.locator('#motion-save').click();
  await expect(page.locator('#modal')).not.toBeVisible();
  expect(await state(page), 'Changing presentation must preserve the whole match').toEqual(before);
  const result = await presentation(page);
  expect(result.mode).toBe(mode); expect(result.speed).toBe(speed);
}

async function ready(page) {
  await idle(page);
  if ((await state(page)).status === 'ready') return;
  if (await page.locator('#result-back').isVisible()) { await page.locator('#result-back').click(); return; }
  await page.locator('#pause').click();
  await page.locator('#pause-home').click();
  await page.locator('#confirm-home').click();
  expect((await state(page)).status).toBe('ready');
}

async function fixture(page, { character = 'beth', skill = 0, grand = false } = {}) {
  await idle(page);
  return page.evaluate(({ character, skill, grand }) => {
    const api = window.__royalGems;
    const board = Array.from({ length: 56 }, (_, i) => api.newTile((i % 8 + Math.floor(i / 8) * 2) % 5));
    [0, 1, 10].forEach(i => { board[i] = api.newTile(3); });
    board[2] = api.newTile(1); board[3] = api.newTile(4);
    if (grand) { board[0] = api.newTile(0, 'ultimate'); board[1] = api.newTile(1, 'ultimate'); }
    window.__roleSeed = 681;
    api.load({ board, character, difficulty: 'hard', score: 0, turns: 30, energy: skill === 1 ? 250 : skill === 2 ? 500 : 0, firstFired: skill === 2, status: 'playing' });
    window.__roleTrace = { effects: [], skills: [], lastSerial: api.effects().serial, lastSkill: '', phases: [] };
    return { serial: api.effects().serial, pair: grand ? [0, 1] : [10, 2] };
  }, { character, skill, grand });
}

async function exchange(page, pair, touch = false) {
  await page.locator('canvas').scrollIntoViewIfNeeded();
  const box = await page.locator('canvas').boundingBox();
  expect(box).not.toBeNull();
  const point = i => ({ x: box.x + (12 + (i % 8 + .5) * 90) / 744 * box.width, y: box.y + (12 + (Math.floor(i / 8) + .5) * 90) / 654 * box.height });
  const from = point(pair[0]), to = point(pair[1]);
  if (touch) { await page.touchscreen.tap(from.x, from.y); await page.touchscreen.tap(to.x, to.y); }
  else {
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 4 }); await page.mouse.up();
  }
}

async function runSkill(page, character, number, config) {
  const setup = await fixture(page, { character: character.id, skill: number });
  await exchange(page, setup.pair);
  await page.waitForFunction(name => window.__roleTrace.skills.some(skill => skill.name.includes(name)), config.name, { timeout: 120000 });
  await page.screenshot({ path: `${output}/${character.id}-skill-${number}.png`, fullPage: true });
  await idle(page);
  const after = await state(page), trace = await page.evaluate(() => window.__roleTrace);
  expect(after.character).toBe(character.id);
  expect(trace.skills.some(skill => skill.name.includes(character.name) && skill.name.includes(config.name))).toBe(true);
  if (number === 1 && character.id === 'lance') expect(after.board.filter(tile => tile.special === 'cross').length).toBeGreaterThanOrEqual(2);
  if (number === 1 && character.id === 'chris') expect(after.board.filter(tile => tile.special === 'bomb').length).toBeGreaterThanOrEqual(2);
  if (number === 1 && character.id === 'ian') expect(after.turns).toBe(31);
  if (number === 2 && character.id === 'ian') expect(after.board.filter(tile => tile.special === 'ultimate').length).toBeGreaterThanOrEqual(1);
  if (number === 2 && character.id === 'lance') expect(trace.effects.some(effect => effect.afterSkill.includes(config.name) && effect.count >= 16)).toBe(true);
  if (number === 2 && character.id === 'chris') expect(trace.effects.some(effect => effect.afterSkill.includes(config.name) && effect.count >= 25)).toBe(true);
  if (character.id === 'beth') expect(trace.effects.filter(effect => effect.afterSkill.includes(config.name)).length).toBeGreaterThan(0);
  runs.push({ kind: 'skill', character: character.id, number, score: after.score, turns: after.turns, trace });
  record(`${character.name} ${number === 1 ? 300 : 550} energy: ${config.name} has its own actual gameplay effect and matching banner`);
}

async function motionCase(page, { grand = false, gentle = false, suffix = '', touch = false, captureDrop = false } = {}) {
  if ((await state(page)).character !== 'ian') {
    await ready(page);
    await page.locator('[data-character="3"]').click();
    await page.locator('#start').click();
  }
  const setup = await fixture(page, { grand, character: 'ian' });
  // Ian's first skill adds turns, avoiding additional transforming cascades in
  // the full-board-clear timing scenario.
  await exchange(page, setup.pair, touch);
  await page.waitForFunction(serial => window.__royalGems.effects().serial > serial, setup.serial);
  const fx = await page.evaluate(() => window.__royalGems.effects());
  expect(fx.reducedMotion).toBe(gentle);
  expect(fx.duration).toBeGreaterThanOrEqual(gentle ? 400 : grand ? 885 : 500);
  expect(fx.activeObjects).toBeGreaterThan(0);
  await expect(page.locator('#hint')).toBeDisabled();
  await expect(page.locator('#restart')).toBeDisabled();
  await expect(page.locator('#motion-settings')).toBeDisabled();
  const lockedState = await state(page);
  const nextPair = await page.evaluate(() => window.__royalGems.hint());
  if (nextPair) await exchange(page, nextPair, touch);
  expect(await state(page)).toEqual(lockedState);
  const stem = `${grand ? 'grand' : 'ordinary'}${gentle ? '-gentle' : '-full'}${suffix}`;
  const first = await page.locator('canvas').screenshot({ path: `${output}/${stem}-burst-1.png` });
  await page.waitForTimeout(160);
  const second = await page.locator('canvas').screenshot({ path: `${output}/${stem}-burst-2.png` });
  const rawA = await sharp(first).raw().toBuffer(), rawB = await sharp(second).raw().toBuffer();
  expect(rawA.equals(rawB), 'Two frames during a clear must show visible animation').toBe(false);
  if (captureDrop) {
    // The runtime exposes a presentation phase only in development, allowing a
    // screenshot of the real refill instead of an arbitrary timeout.
    await page.waitForFunction(() => {
      const current = window.__royalGems.presentation();
      return (current.phase ?? current.frameKind) === 'drop';
    }, null, { timeout: 15000 });
    await page.waitForTimeout(120);
    expect(await page.evaluate(() => window.__royalGems.busy())).toBe(true);
    await page.screenshot({ path: `${output}/${stem}-drop.png`, fullPage: true });
  }
  await idle(page);
  await page.waitForFunction(() => window.__royalGems.effects().activeObjects === 0);
  expect(await state(page)).toEqual(lockedState);
  await expect(page.locator('#hint')).toBeEnabled();
  await expect(page.locator('#motion-settings')).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${output}/${stem}-settled.png`, fullPage: true });
  runs.push({ kind: 'motion', stem, fx, presentation: await presentation(page), trace: await page.evaluate(() => window.__roleTrace) });
  record(`${stem}: ${fx.duration} ms visible changing effects; clear/drop input locked, no extra turn spent, controls restored`);
  return fx;
}

let failure;
try {
  const page = await createPage({ reducedMotion: 'no-preference' });
  expect((await presentation(page)).mode).toBe('full');
  expect((await presentation(page)).speed).toBe('normal');
  record('default presentation is full effects with standard timing');
  const configs = await page.evaluate(async () => (await import('/src/skills.ts')).SKILLS);
  expect(new Set(Object.values(configs).flatMap(config => config.skills.map(skill => skill.name))).size).toBe(8);
  await settings(page, 'full', 'normal');
  for (const [index, character] of roster.entries()) {
    await ready(page);
    await page.locator(`[data-character="${index}"]`).click();
    await expect(page.locator('#character-name')).toHaveText(character.name);
    expect((await state(page)).character).toBe(character.id);
    for (const [skillIndex, skill] of configs[character.id].skills.entries()) {
      const button = page.locator(skillIndex ? '#skill-two' : '#skill-one');
      await expect(button).toContainText(skill.name);
      await button.click();
      await expect(page.locator('#modal-content')).toContainText(skill.name);
      await expect(page.locator('#modal-content')).toContainText(skill.description);
      await page.locator('#modal-close').click();
    }
    await page.locator('[data-difficulty="hard"]').click();
    expect((await state(page)).character).toBe(character.id);
    await page.locator('#start').click();
    expect((await state(page)).character).toBe(character.id);
    await expect(page.locator(`[data-character="${index}"]`)).toBeDisabled();
    await runSkill(page, character, 1, configs[character.id].skills[0]);
    await runSkill(page, character, 2, configs[character.id].skills[1]);
    await page.locator('#restart').click(); await page.locator('#confirm-restart').click();
    const restarted = await state(page);
    expect(restarted.character).toBe(character.id); expect(restarted.difficulty).toBe('hard');
    expect(restarted.turns).toBe(30); expect(restarted.score).toBe(0);
    record(`${character.name}: both skill descriptions, difficulty change, start and restart all retain the selected role`);
  }
  await page.reload({ waitUntil: 'networkidle' });
  expect((await state(page)).character).toBe('ian');
  await expect(page.locator('#skill-one')).toContainText(configs.ian.skills[0].name);
  await expect(page.locator('#skill-two')).toContainText(configs.ian.skills[1].name);
  await page.locator('#start').click();
  record('reloading restores the selected character and its actual skill configuration');
  await settings(page, 'full', 'slow');
  await page.locator('#pause').click();
  const paused = await state(page);
  await page.locator('#resume').click();
  await settings(page, 'gentle', 'normal');
  expect(await state(page)).toEqual(paused);
  await settings(page, 'full', 'slow');
  record('pause/resume and saving motion settings preserve board, turns, score, energy and selected character');
  const ordinary = await motionCase(page, { captureDrop: true });
  const grand = await motionCase(page, { grand: true, captureDrop: true });
  expect(grand.peakObjects).toBeGreaterThan(ordinary.peakObjects);
  expect(grand.duration).toBeGreaterThan(ordinary.duration);
  record('larger clear produces more effect objects and lasts longer than a triple');

  const reduced = await createPage({ reducedMotion: 'reduce' });
  expect((await presentation(reduced)).mode).toBe('full');
  expect((await presentation(reduced)).speed).toBe('normal');
  expect((await presentation(reduced)).systemReducedMotion).toBe(true);
  await settings(reduced, 'gentle', 'slow');
  await reduced.locator('#start').click();
  await motionCase(reduced, { gentle: true });
  await settings(reduced, 'full', 'normal');
  await reduced.reload({ waitUntil: 'networkidle' });
  expect((await presentation(reduced)).mode).toBe('full');
  expect((await presentation(reduced)).speed).toBe('normal');
  expect((await presentation(reduced)).systemReducedMotion).toBe(true);
  await settings(reduced, 'full', 'slow');
  await reduced.locator('#start').click();
  await motionCase(reduced, { suffix: '-override-reduced' });
  record('full + standard defaults also apply with system reduced motion; explicit gentle and full preferences persist');

  const mobile = await createPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'no-preference' });
  await mobile.locator('[data-character="2"]').click();
  await mobile.locator('#skill-one').click();
  await expect(mobile.locator('#modal-content')).toContainText(configs.chris.skills[0].description);
  await mobile.screenshot({ path: `${output}/mobile-character-skills.png`, fullPage: true });
  await mobile.locator('#modal-close').click();
  await settings(mobile, 'full', 'slow');
  await mobile.locator('#start').click();
  await motionCase(mobile, { grand: true, touch: true, suffix: '-mobile', captureDrop: true });
  expect(errors).toEqual([]);
  record('mobile touch, skill description and animation settings fit the screen; no runtime or resource errors');
} catch (error) {
  failure = error; console.error(error);
  await Promise.allSettled(contexts.flatMap((context, index) => context.pages().map(page => page.screenshot({ path: `${output}/failure-${index}.png`, fullPage: true }))));
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify({ url, passed: checks.length, checks, errors, runs, failure: failure?.stack }, null, 2));
  for (const context of contexts) await context.close();
  await browser.close();
}
if (failure) throw failure;
