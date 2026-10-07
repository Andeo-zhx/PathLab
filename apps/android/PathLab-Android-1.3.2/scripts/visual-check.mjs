import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.resolve('verify-out');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu'], defaultViewport: { width: 1600, height: 1000 } });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:5199/', { waitUntil: 'networkidle0' });
await page.evaluate(() => new Promise((res) => { const r = indexedDB.deleteDatabase('pathlab'); r.onsuccess = r.onerror = r.onblocked = () => res(); }));
await page.reload({ waitUntil: 'networkidle0' });
await sleep(800);
await page.evaluate(async () => {
  function img(seed, w, h, base) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); ctx.fillStyle = base; ctx.fillRect(0,0,w,h);
    let s = seed; const rnd = () => { s = (s*1103515245+12345)%2147483648; return s/2147483648; };
    for (let i=0;i<1800;i++){ const x=rnd()*w,y=rnd()*h,r=5+rnd()*26;
      ctx.beginPath(); ctx.ellipse(x,y,r,r*(0.6+rnd()*0.7),rnd()*3.14,0,6.3);
      ctx.fillStyle = rnd()<0.5?'rgba(150,86,132,0.45)':'rgba(230,196,214,0.4)'; ctx.fill(); }
    return c;
  }
  const a = await new Promise((r) => img(11, 1500, 1000, '#f6e3ec').toBlob(r, 'image/png'));
  window.dispatchEvent(new CustomEvent('pathlab:import-files', { detail: [new File([a],'s.png',{type:'image/png'})] }));
});
await sleep(2200);
const P = (fx, fy) => page.evaluate((a, b) => {
  const s = window.__pathlab.state(); const img = s.images[0]; const v = s.canvas;
  const rect = document.querySelector('.canvas-host').getBoundingClientRect();
  return { x: rect.left + (img.x + img.width*a)*v.zoom + v.panX, y: rect.top + (img.y + img.height*b)*v.zoom + v.panY };
}, fx, fy);
async function drag(a,b){ await page.mouse.move(a.x,a.y); await page.mouse.down(); await page.mouse.move(b.x,b.y,{steps:10}); await page.mouse.up(); await sleep(400); }

// 放大引用：拖一个 2x 的圈选区
await page.keyboard.press('m'); await sleep(200);
await drag(await P(0.2, 0.2), await P(0.32, 0.32));
await sleep(600);
await page.screenshot({ path: path.join(OUT, '50-magnifier-2x.png') });
const s1 = await page.evaluate(() => window.__pathlab.state());
console.log('zoom2', JSON.stringify({ zoom: s1.magnifiers[0].zoom, radius: Math.round(s1.magnifiers[0].destination.radius), roiW: Math.round(s1.magnifiers[0].sourceRegion.width) }));

// 套索：在图上逐点点出多边形，确认预览贴合点击点
await page.evaluate(() => window.__pathlab.useUi.getState().setSelection([]));
await page.keyboard.press('p'); await sleep(200);
const pts = [await P(0.55,0.25), await P(0.78,0.32), await P(0.72,0.62), await P(0.52,0.5)];
for (const p of pts) { await page.mouse.click(p.x, p.y); await sleep(200); }
await page.mouse.move((await P(0.6,0.68)).x, (await P(0.6,0.68)).y);
await sleep(300);
await page.screenshot({ path: path.join(OUT, '51-lasso-preview.png') });
await page.mouse.click(pts[0].x, pts[0].y); await page.mouse.click(pts[0].x, pts[0].y);
await sleep(500);
await page.screenshot({ path: path.join(OUT, '52-lasso-committed.png') });
console.log('anns', (await page.evaluate(() => window.__pathlab.state().annotations.length)));

// 提高倍率，看投射圆是否等比变大而 ROI 不变
await page.evaluate(() => {
  const m = window.__pathlab.state().magnifiers[0];
  window.__pathlab.useUi.getState().setSelection([{ id: m.id, kind: 'magnifier' }]);
});
await sleep(400);
const plus = await page.evaluate(() => {
  const b = [...document.querySelectorAll('.selection-toolbar button')].find((x) => x.getAttribute('aria-label') === '提高倍率');
  if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x+r.width/2, y: r.y+r.height/2 };
});
for (let i = 0; i < 4; i++) { if (plus) await page.mouse.click(plus.x, plus.y); await sleep(250); }
await sleep(400);
await page.screenshot({ path: path.join(OUT, '53-magnifier-4x.png') });
const s2 = await page.evaluate(() => window.__pathlab.state());
console.log('zoom4', JSON.stringify({ zoom: s2.magnifiers[0].zoom, radius: Math.round(s2.magnifiers[0].destination.radius), roiW: Math.round(s2.magnifiers[0].sourceRegion.width) }));
await browser.close();
