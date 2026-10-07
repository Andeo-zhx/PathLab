import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const CHROME =
  process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.resolve('verify-out');
const DL = path.resolve('verify-downloads');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.rmSync(DL, { recursive: true, force: true });
fs.mkdirSync(DL, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (n, ok, d = '') => { results.push({ n, ok, d }); console.log((ok ? 'PASS' : 'FAIL') + ' :: ' + n + (d ? ' :: ' + d : '')); };

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu'], defaultViewport: { width: 1600, height: 1000 } });
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
const cdp = await page.createCDPSession();
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL, eventsEnabled: true });

await page.goto('http://localhost:5199/', { waitUntil: 'networkidle0' });
await page.evaluate(() => new Promise((res) => { const r = indexedDB.deleteDatabase('pathlab'); r.onsuccess = r.onerror = r.onblocked = () => res(); }));
await page.reload({ waitUntil: 'networkidle0' });
await sleep(800);
await page.evaluate(async () => {
  function img(w, h, base, seed) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
    let s = seed; const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
    for (let i = 0; i < 700; i++) { ctx.beginPath(); ctx.arc(rnd()*w, rnd()*h, 8 + rnd()*22, 0, 7); ctx.fillStyle = 'rgba(150,86,132,0.42)'; ctx.fill(); }
    return c;
  }
  const a = await new Promise((r) => img(1400, 1000, '#f2dbe6', 5).toBlob(r, 'image/png'));
  const b = await new Promise((r) => img(1200, 900, '#e9d3dd', 9).toBlob(r, 'image/png'));
  window.dispatchEvent(new CustomEvent('pathlab:import-files', { detail: [new File([a], 'a.png', { type: 'image/png' }), new File([b], 'b.png', { type: 'image/png' })] }));
});
await sleep(2400);

await page.click('[aria-label="更多"]');
await sleep(400);
check('更多菜单打开', (await page.$('.menu')) !== null);
await page.screenshot({ path: path.join(OUT, '30-more-menu.png') });
const shortcutsItem = await page.evaluate(() => {
  const b = [...document.querySelectorAll('.menu .menu-item')].find((x) => (x.textContent || '').includes('快捷键'));
  if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
if (shortcutsItem) await page.mouse.click(shortcutsItem.x, shortcutsItem.y);
await sleep(400);
check('快捷键面板打开', (await page.$('.shortcut-grid')) !== null);
await page.screenshot({ path: path.join(OUT, '31-shortcuts.png') });
await page.keyboard.press('Escape');
await sleep(300);

await page.mouse.click(1420, 220);
await sleep(300);
await page.keyboard.type('低倍镜下：肝小叶结构紊乱。');
await sleep(400);
await page.evaluate(() => {
  const el = document.querySelector('.prose-editor');
  const range = document.createRange();
  const tn = el.querySelector('p').firstChild;
  range.setStart(tn, 0); range.setEnd(tn, 5);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
});
await sleep(600);
check('选中文字出现格式浮条', (await page.$('.bubble-bar')) !== null);
await page.screenshot({ path: path.join(OUT, '32-bubble.png') });
const boldBtn = await page.evaluate(() => {
  const b = [...document.querySelectorAll('.bubble-bar button')].find((x) => x.getAttribute('aria-label') === '粗体');
  if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
if (boldBtn) await page.mouse.click(boldBtn.x, boldBtn.y);
await sleep(400);
const html = await page.evaluate(() => document.querySelector('.prose-editor')?.innerHTML || '');
check('浮条加粗生效', html.includes('<strong>'), html.slice(0, 140));

await sleep(1400);
await page.reload({ waitUntil: 'networkidle0' });
await sleep(3200);
const editorText = await page.evaluate(() => document.querySelector('.prose-editor')?.textContent || '');
check('刷新后写作内容恢复', editorText.includes('低倍镜下'), editorText.slice(0, 40));

async function waitForNewPng(timeout) {
  const before = new Set(fs.readdirSync(DL));
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const fresh = fs.readdirSync(DL).find((f) => !before.has(f) && f.endsWith('.png'));
    if (fresh) { await sleep(900); return fresh; }
    await sleep(400);
  }
  return null;
}

// 2× 白底导出（4× 另行验证尺寸上限）
await page.evaluate(() => window.__pathlab.useUi.getState().openExport('canvas'));
await sleep(500);
check('导出弹窗打开', (await page.$('.dialog')) !== null);
await page.evaluate(() => { const b = document.querySelector('.dialog .btn.primary'); if (b) b.click(); });
const f2 = await waitForNewPng(90000);
check('2× 导出成功', !!f2, String(f2));
if (f2) {
  const buf = fs.readFileSync(path.join(DL, f2));
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  check('2× 尺寸合理', w > 4000 && h > 1500, w + 'x' + h + ' ' + buf.length + 'B');
}

// 整页 A4
await page.evaluate(() => window.__pathlab.useUi.getState().openExport('page'));
await sleep(500);
await page.evaluate(() => { const b = document.querySelector('.dialog .btn.primary'); if (b) b.click(); });
const fp = await waitForNewPng(90000);
check('整页导出成功', !!fp, String(fp));

await page.setViewport({ width: 900, height: 800 });
await sleep(700);
const drawerTransform = await page.evaluate(() => getComputedStyle(document.querySelector('.writing-region')).transform);
const drawerX = (() => { const m = /matrix\(([^)]+)\)/.exec(drawerTransform); return m ? Number(m[1].split(',')[4]) : 0; })();
check('窄窗口写作区收起为抽屉', drawerX > 100, drawerTransform);
await page.screenshot({ path: path.join(OUT, '33-narrow.png') });
const toggle = await page.$('.drawer-toggle');
check('抽屉按钮存在', !!toggle);
if (toggle) {
  await toggle.click();
  await sleep(700);
  const t2 = await page.evaluate(() => getComputedStyle(document.querySelector('.writing-region')).transform);
  const openX = (() => { const m = /matrix\(([^)]+)\)/.exec(t2); return m ? Number(m[1].split(',')[4]) : (t2 === 'none' ? 0 : 999); })();
  check('抽屉可展开', openX <= 1, t2);
  await page.screenshot({ path: path.join(OUT, '34-narrow-open.png') });
}
await page.setViewport({ width: 1600, height: 1000 });
await sleep(600);

await page.evaluate(() => {
  const s = window.__pathlab.state();
  if (s.images[0]) window.__pathlab.useUi.getState().setSelection([{ id: s.images[0].id, kind: 'image' }]);
});
await sleep(500);
await page.screenshot({ path: path.join(OUT, '35-selected-image.png') });
check('无运行期错误', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log('\n==== ' + results.filter((r) => !r.ok).length + ' failures / ' + results.length + ' checks ====');
await browser.close();
