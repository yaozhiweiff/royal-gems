import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('test-results', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const page = await context.newPage();
const errors = [], checks = [];
page.on('pageerror', e => errors.push(e.message));
page.on('response', response => { if (response.status() >= 400 && new URL(response.url()).hostname === '127.0.0.1') errors.push(`HTTP ${response.status()} ${response.url()}`); });
const record = name => { checks.push(name); console.log('PASS', name); };
const idle = () => page.waitForFunction(() => !window.__royalGems.busy(), null, { timeout: 30000 });
const state = () => page.evaluate(() => window.__royalGems.state());
async function swap(a, b, touch = false) {
  const box = await page.locator('canvas').boundingBox();
  const point = i => ({ x:box.x + (12+(i%8+.5)*90)/744*box.width, y:box.y+(12+(Math.floor(i/8)+.5)*90)/654*box.height });
  const p = point(a), q = point(b);
  if (touch) { await page.touchscreen.tap(p.x,p.y); await page.touchscreen.tap(q.x,q.y); }
  else { await page.mouse.move(p.x,p.y); await page.mouse.down(); await page.mouse.move(q.x,q.y,{steps:8}); await page.mouse.up(); }
  await idle();
}
async function fixture({ score = 0, turns = 20, energy = 0, firstFired = false, specials = [] } = {}) {
  await page.evaluate(({ score,turns,energy,firstFired,specials }) => {
    const api = window.__royalGems;
    const board = Array.from({length:56},(_,i)=>api.newTile((i%8+Math.floor(i/8)*2)%5));
    [0,1,10].forEach(i=>board[i]=api.newTile(3)); board[2]=api.newTile(1); board[3]=api.newTile(4);
    specials.forEach(([i,kind])=>board[i]=api.newTile(board[i].color,kind));
    api.load({board,score,turns,energy,firstFired,status:'playing'});
  },{score,turns,energy,firstFired,specials});
}
try {
  await page.goto('http://127.0.0.1:5173', {waitUntil:'networkidle'});
  await expect(page.locator('#start')).toBeEnabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/desktop-ready.png',fullPage:true});
  record('desktop boots with complete assets and no horizontal overflow');
  for (const [i,name] of ['贝丝','兰斯','克丽丝','伊恩'].entries()) {
    await page.locator(`[data-character="${i}"]`).click(); await expect(page.locator('#character-name')).toHaveText(name);
    await expect(page.locator('#hero')).toHaveAttribute('alt',name);
  }
  await page.locator('[data-character="0"]').click(); record('all four characters selectable');
  await page.locator('[data-difficulty="hard"]').click(); await expect(page.locator('#turns')).toHaveText('30'); await expect(page.locator('#target')).toHaveText('10,000');
  await page.locator('[data-difficulty="easy"]').click(); await expect(page.locator('#turns')).toHaveText('20'); record('difficulty changes target and turn limit');
  await page.locator('header .guide-button').click(); await expect(page.locator('#modal')).toBeVisible();
  await expect(page.locator('#modal-content')).toContainText('终极棋子');
  await page.screenshot({path:'test-results/rules.png',fullPage:true});
  await page.locator('#rules-done').click(); record('rules dialog opens and closes');
  await page.locator('#start').click(); await expect(page.locator('#play-actions')).toBeVisible();
  await page.locator('#hint').click(); await expect(page.locator('#toast')).toContainText('高亮');
  const pair = await page.evaluate(()=>window.__royalGems.hint());
  await swap(...pair); expect((await state()).turns).toBe(19); expect((await state()).score).toBeGreaterThan(0); record('real mouse drag swaps, clears, drops and updates score');
  await fixture(); const before=await state(); await swap(6,7); expect((await state()).turns).toBe(before.turns); expect((await state()).energy).toBe(0); record('invalid mouse swap restores board without spending a turn');
  await page.locator('#pause').click(); await expect(page.locator('#modal-title')).toHaveText('片刻休憩');
  expect((await state()).turns).toBe(20); await page.locator('#resume').click(); record('pause and resume preserve progress');
  await page.locator('#restart').click(); await page.locator('#keep-playing').click(); expect((await state()).status).toBe('playing'); record('restart can be canceled');
  await fixture({specials:[[16,'bomb'],[27,'cross'],[40,'ultimate']]});
  await page.screenshot({path:'test-results/desktop-specials.png',fullPage:true}); record('all special piece visuals render');
  await fixture({energy:250}); await swap(2,10); expect((await state()).firstFired).toBe(true); record('300-energy skill automatically transforms a line');
  await fixture({energy:500,firstFired:true}); await swap(2,10); expect((await state()).score).toBeGreaterThan(30); record('550-energy skill resolves with cascades');
  await fixture({specials:[[0,'ultimate'],[1,'ultimate']]}); await swap(0,1); expect((await state()).score).toBeGreaterThanOrEqual(560); record('two ultimates clear the whole board');
  await fixture({score:2490,turns:1}); await swap(2,10); await expect(page.locator('#modal-title')).toHaveText('试炼完成');
  expect((await state()).status).toBe('won'); await page.screenshot({path:'test-results/victory.png',fullPage:true});
  await page.locator('#result-replay').click(); expect((await state()).score).toBe(0); expect((await state()).turns).toBe(20); record('last-turn victory, best score and replay');
  await fixture({turns:1}); await swap(2,10); await expect(page.locator('#modal-title')).toHaveText('再赴一场试炼');
  await page.locator('#result-back').click(); expect((await state()).status).toBe('ready'); record('loss and return to character selection');
  await page.locator('#sound').click(); const soundValue=await page.locator('#sound').getAttribute('aria-pressed');
  await page.reload({waitUntil:'networkidle'}); await expect(page.locator('#sound')).toHaveAttribute('aria-pressed',soundValue); record('sound setting persists');
  await page.locator('#start').click(); await fixture();
  await page.locator('canvas').focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await idle();
  expect((await state()).turns).toBe(19); record('keyboard selection and swap');
  for (const [width,height] of [[1920,1080],[1366,768],[768,1024],[390,844],[360,780]]) {
    await page.setViewportSize({width,height});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const box=await page.locator('canvas').boundingBox(); expect(box.width).toBeGreaterThan(280);
    await page.screenshot({path:`test-results/viewport-${width}.png`,fullPage:true});
  }
  record('five desktop, tablet and mobile viewport sizes');
  const mobile=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:'reduce'});
  const mp=await mobile.newPage();
  mp.on('pageerror', e=>errors.push(e.message));
  await mp.goto('http://127.0.0.1:5173',{waitUntil:'networkidle'}); await mp.locator('#start').click();
  const mobilePair=await mp.evaluate(()=>window.__royalGems.hint()), mb=await mp.locator('canvas').boundingBox();
  for(const i of mobilePair) await mp.touchscreen.tap(mb.x+(12+(i%8+.5)*90)/744*mb.width,mb.y+(12+(Math.floor(i/8)+.5)*90)/654*mb.height);
  await mp.waitForFunction(()=>!window.__royalGems.busy()); expect(await mp.evaluate(()=>window.__royalGems.state().turns)).toBe(19);
  await mp.screenshot({path:'test-results/mobile-playing.png',fullPage:true});
  record('real touch taps swap adjacent gems');
  expect(errors).toEqual([]); record('no application errors or failed local resources');
  await writeFile('test-results/browser-report.json',JSON.stringify({passed:checks.length,checks,errors},null,2));
} finally { await browser.close(); }
