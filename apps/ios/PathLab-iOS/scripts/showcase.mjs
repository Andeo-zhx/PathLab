import puppeteer from 'puppeteer-core';

import path from 'node:path';
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.resolve('verify-out');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu'], defaultViewport: { width: 1600, height: 1000 } });
const page = await browser.newPage();
await page.goto('http://localhost:5199/', { waitUntil: 'networkidle0' });
await page.evaluate(() => new Promise((res) => { const r = indexedDB.deleteDatabase('pathlab'); r.onsuccess = r.onerror = r.onblocked = () => res(); }));
await page.reload({ waitUntil: 'networkidle0' });
await sleep(800);
await page.evaluate(async () => {
  function make(seed, w, h, base, dark) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); ctx.fillStyle = base; ctx.fillRect(0,0,w,h);
    let s = seed; const rnd = () => { s = (s*1103515245+12345)%2147483648; return s/2147483648; };
    for (let i=0;i<2400;i++){ const x=rnd()*w,y=rnd()*h,r=4+rnd()*30;
      ctx.beginPath(); ctx.ellipse(x,y,r,r*(0.55+rnd()*0.8),rnd()*3.14,0,6.3);
      const t=rnd();
      ctx.fillStyle = dark ? (t<0.5?'rgba(120,60,120,0.5)':'rgba(190,120,170,0.36)') : (t<0.5?'rgba(160,95,140,0.42)':'rgba(232,196,214,0.34)');
      ctx.fill(); }
    for (let i=0;i<40;i++){ ctx.beginPath(); ctx.arc(rnd()*w,rnd()*h,1.5+rnd()*4,0,6.3); ctx.fillStyle='rgba(60,36,74,0.7)'; ctx.fill(); }
    return c;
  }
  const defs = [[201,1500,1000,'#f6e3ec',false],[77,1300,950,'#efd6e2',true],[41,1100,850,'#f2dee8',false]];
  const files = [];
  for (const [seed,w,h,b,dark] of defs) {
    const blob = await new Promise((r) => make(seed,w,h,b,dark).toBlob(r,'image/png'));
    files.push(new File([blob], 'slice.png', { type: 'image/png' }));
  }
  window.dispatchEvent(new CustomEvent('pathlab:import-files', { detail: files }));
});
await sleep(2600);
// 排列为横向
await page.evaluate(() => {
  const s = window.__pathlab.state();
  window.__pathlab.useUi.getState().setSelection(s.images.map((i) => ({ id: i.id, kind: 'image' })));
});
await sleep(300);
const grid = await page.evaluate(() => {
  const b = [...document.querySelectorAll('.selection-toolbar button')].find((x) => x.getAttribute('aria-label') === '网格排列');
  if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x+r.width/2, y: r.y+r.height/2 };
});
if (grid) await page.mouse.click(grid.x, grid.y);
await sleep(500);
await page.keyboard.down('Control'); await page.keyboard.press('Digit0'); await page.keyboard.up('Control');
await sleep(700);

const P = (i, fx, fy) => page.evaluate((idx, a, b) => {
  const s = window.__pathlab.state(); const img = s.images[idx]; const v = s.canvas;
  const rect = document.querySelector('.canvas-host').getBoundingClientRect();
  return { x: rect.left + (img.x + img.width*a)*v.zoom + v.panX, y: rect.top + (img.y + img.height*b)*v.zoom + v.panY };
}, i, fx, fy);
async function drag(a, b) { await page.mouse.move(a.x,a.y); await page.mouse.down(); await page.mouse.move(b.x,b.y,{steps:10}); await page.mouse.up(); await sleep(320); }

// 在中间那张图上画椭圆 + 箭头
await page.keyboard.press('o'); await sleep(150);
await drag(await P(1,0.2,0.22), await P(1,0.52,0.5));
await page.keyboard.press('a'); await sleep(150);
await drag(await P(1,0.62,0.72), await P(1,0.86,0.42));
await page.keyboard.press('r'); await sleep(150);
await drag(await P(0,0.12,0.16), await P(0,0.42,0.38));
// 放大引用
await page.keyboard.press('m'); await sleep(150);
await drag(await P(1,0.58,0.16), await P(1,0.7,0.3));
await sleep(700);
// 缩小一点放大镜的倍率
await page.evaluate(() => {
  const s = window.__pathlab.state();
  window.__pathlab.useUi.getState().setSelection([{ id: s.magnifiers[0].id, kind: 'magnifier' }]);
});
await sleep(400);

// 右侧写作
await page.mouse.click(1420, 200); await sleep(300);
await page.keyboard.type('低倍镜下：肝小叶结构基本完整，中央静脉周围可见轻度淤血。');
await sleep(300);
const ins = await page.$('.insert-btn');
if (ins) { await ins.click(); await sleep(300);
  const items = await page.$$('.menu .menu-item');
  if (items.length) await items[0].click(); }
await sleep(400);
// 在模板里补一句
await page.evaluate(() => {
  const el = document.querySelector('.prose-editor');
  el.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  const paras = el.querySelectorAll('p');
  const target = paras[paras.length - 1];
  range.selectNodeContents(target); range.collapse(false);
  sel.removeAllRanges(); sel.addRange(range);
});
await page.keyboard.type('肝索排列尚整齐，未见明确坏死。');
await sleep(500);
// 建立大倍视野的观察
await page.evaluate(() => {
  const el = document.querySelector('.prose-editor');
  el.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  const paras = el.querySelectorAll('p');
  const target = paras[paras.length - 1];
  range.selectNodeContents(target); range.collapse(false);
  sel.removeAllRanges(); sel.addRange(range);
});
await page.keyboard.press('Enter');
await page.keyboard.type('高倍镜下：细胞核深染、核浆比增高，需结合临床。');
await sleep(700);
await page.evaluate(() => window.__pathlab.useUi.getState().setSelection([]));
await sleep(400);
await page.screenshot({ path: path.join(OUT, 'hero.png') });
await page.screenshot({ path: path.join(OUT, 'hero-full.png'), fullPage: false });
console.log('hero captured');
await browser.close();
