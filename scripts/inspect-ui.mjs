import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
await mkdir('test-results', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
page.on('pageerror', error => console.log('PAGE ERROR:', error.message));
await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' });
await page.locator('#start').waitFor({ state: 'visible' });
await page.waitForFunction(() => !document.querySelector('#start').disabled);
await page.screenshot({ path: 'test-results/desktop-initial.png', fullPage: true });
console.log('desktop', await page.evaluate(() => ({ width:innerWidth, scrollWidth:document.documentElement.scrollWidth, height:document.documentElement.scrollHeight, images:[...document.images].map(i => ({src:i.src,loaded:i.complete && i.naturalWidth>0})), canvas:document.querySelector('canvas')?.getBoundingClientRect().toJSON() })));
for (const [i,name] of ['beth','lance','chris','ian'].entries()) {
  await page.locator(`[data-character="${i}"]`).click();
  await page.screenshot({ path:`test-results/character-${name}.png`, fullPage:true });
}
await page.locator('[data-character="0"]').click();
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: 'test-results/mobile-initial.png', fullPage: true });
console.log('mobile', await page.evaluate(() => ({ width:innerWidth, scrollWidth:document.documentElement.scrollWidth, height:document.documentElement.scrollHeight })));
await browser.close();
