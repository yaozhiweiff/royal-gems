import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}});
const errors=[], external=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
await page.route('**/*',route=>{
  if(new URL(route.request().url()).hostname!=='127.0.0.1'){external.push(route.request().url());return route.abort();}
  return route.continue();
});
try {
  await page.goto('http://127.0.0.1:4173',{waitUntil:'networkidle'});
  await expect(page.locator('#register-name')).toBeVisible();
  await expect(page.locator('#start')).toBeDisabled();
  await page.locator('#register-name').fill(`验证${Date.now().toString().slice(-9)}`);
  await page.locator('#register-submit').click();
  await expect(page.locator('#start')).toBeEnabled();
  expect(await page.evaluate(()=>typeof window.__royalGems)).toBe('undefined');
  expect(await page.evaluate(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0))).toBe(true);
  await page.screenshot({path:'preview.png',fullPage:true});
  await page.locator('#start').click(); await page.locator('#hint').click(); await expect(page.locator('#toast')).toContainText('高亮');
  await page.locator('#pause').click(); await expect(page.locator('#modal-title')).toHaveText('片刻休憩'); await page.locator('#resume').click();
  await page.locator('header .guide-button').click(); await expect(page.locator('#modal-content')).toContainText('550'); await page.locator('#rules-done').click();
  expect(errors).toEqual([]);expect(external).toEqual([]);
  await writeFile('test-results/production-report.json',JSON.stringify({passed:true,externalRequests:external,errors,debugHooksAbsent:true},null,2));
  console.log('PASS: production registration and server-backed play work with no console errors or development hooks.');
}finally{await browser.close();}
