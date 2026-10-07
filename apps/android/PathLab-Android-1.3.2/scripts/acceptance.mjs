import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const CHROME =
  process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.resolve('verify-out');
const DL = path.resolve('verify-downloads');
fs.mkdirSync(OUT, { recursive: true });
fs.rmSync(DL, { recursive: true, force: true });
fs.mkdirSync(DL, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log((ok ? 'PASS' : 'FAIL') + ' :: ' + name + (detail ? ' :: ' + detail : ''));
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1600,1000'],
  defaultViewport: { width: 1600, height: 1000 },
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
const cdp = await page.createCDPSession();
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL, eventsEnabled: true });


const dumpImgs = async (label) => {
  const inf = await page.evaluate(() => window.__pathlab.state().images.map((i) => [Math.round(i.x), Math.round(i.y), Math.round(i.width), Math.round(i.height), i.zIndex]));
  console.log('DBG ' + label, JSON.stringify(inf));
};
const st0 = () => page.evaluate(() => window.__pathlab.state());
const toScreen = (wx, wy) => page.evaluate((x, y) => {
  const v = window.__pathlab.state().canvas;
  const rect = document.querySelector('.canvas-host').getBoundingClientRect();
  return { x: rect.left + x * v.zoom + v.panX, y: rect.top + y * v.zoom + v.panY };
}, wx, wy);

const screenToWorld = (p) => page.evaluate((pt) => {
  const v = window.__pathlab.state().canvas;
  const rect = document.querySelector('.canvas-host').getBoundingClientRect();
  return { x: (pt.x - rect.left - v.panX) / v.zoom, y: (pt.y - rect.top - v.panY) / v.zoom };
}, p);

const worldToScreen = (w) => page.evaluate((pt) => {
  const v = window.__pathlab.state().canvas;
  const rect = document.querySelector('.canvas-host').getBoundingClientRect();
  return { x: rect.left + pt.x * v.zoom + v.panX, y: rect.top + pt.y * v.zoom + v.panY };
}, w);

async function pickTool(key) { await page.keyboard.press(key); await sleep(130); }
async function dragFromTo(a, b, steps = 12) {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
  await sleep(280);
}

await page.goto('http://localhost:5199/', { waitUntil: 'networkidle0', timeout: 60000 });
await page.evaluate(() => new Promise((res) => { const r = indexedDB.deleteDatabase('pathlab'); r.onsuccess = r.onerror = r.onblocked = () => res(); }));
await page.reload({ waitUntil: 'networkidle0' });
await sleep(800);
check('空状态引导显示', (await page.$('.empty-guide')) !== null);

await page.evaluate(async () => {
  function make(seed, w, h, base) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
    let s = seed; const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
    for (let i = 0; i < 2200; i++) {
      ctx.beginPath();
      ctx.ellipse(rnd() * w, rnd() * h, 4 + rnd() * 24, 3 + rnd() * 16, rnd() * 3, 0, Math.PI * 2);
      const t = rnd();
      ctx.fillStyle = t < 0.5 ? 'rgba(150,86,132,0.45)' : 'rgba(226,186,206,0.35)';
      ctx.fill();
    }
    return c;
  }
  const names = [['low.png', 3, 1500, 1000, '#f4dfe8'], ['mid.png', 77, 1300, 950, '#efd6e2'], ['high.png', 41, 1100, 850, '#e9d3dd']];
  const files = [];
  for (const [n, seed, w, h, b] of names) {
    const blob = await new Promise((r) => make(seed, w, h, b).toBlob(r, 'image/png'));
    files.push(new File([blob], n, { type: 'image/png' }));
  }
  window.dispatchEvent(new CustomEvent('pathlab:import-files', { detail: files }));
});
await sleep(2400);
let st = await st0();
check('导入 3 张图片', st.images.length === 3, 'n=' + st.images.length);
check('导入后适应视图', st.canvas.zoom > 0.05, 'zoom=' + st.canvas.zoom.toFixed(3));

// ---- 在第二张图上绘制各类标注（避开工具栏与左侧浮条）
const imgB = st.images[1];
const bx = imgB.x, by = imgB.y, bw = imgB.width, bh = imgB.height;
const P = async (fx, fy) => toScreen(bx + bw * fx, by + bh * fy);
const pt = {
  a: await P(0.12, 0.14), b: await P(0.46, 0.44),
  c: await P(0.5, 0.12), d: await P(0.86, 0.42),
  e: await P(0.14, 0.5), f: await P(0.44, 0.78),
  g: await P(0.5, 0.5), h: await P(0.62, 0.66),
  t: await P(0.6, 0.14),
};

await pickTool('r'); await dragFromTo(pt.a, pt.b);
await pickTool('o'); await dragFromTo(pt.c, pt.d);
await pickTool('l'); await dragFromTo(pt.e, pt.f);
await pickTool('a'); await dragFromTo(pt.g, pt.h);

await pickTool('p');
const polyPts = [await P(0.12, 0.62), await P(0.3, 0.6), await P(0.34, 0.82)];
for (const p of polyPts) { await page.mouse.click(p.x, p.y); await sleep(180); }
const pendingBefore = await page.evaluate(() => window.__pathlab.useUi.getState().pendingPolygon);
check('多边形已开始累积顶点', pendingBefore && pendingBefore.points.length === 3, pendingBefore ? 'pts=' + pendingBefore.points.length : 'null');

// 预览必须画在鼠标点击的位置上（曾经把源图像素当成世界坐标导致整体偏移）
const draftPts = await page.evaluate(() => (window.__pathlabDraft && window.__pathlabDraft.points) || []);
const expectWorld = [];
for (const p of polyPts) expectWorld.push(await screenToWorld(p));
let maxErr = 0;
if (draftPts.length === expectWorld.length) {
  for (let i = 0; i < draftPts.length; i += 1) {
    maxErr = Math.max(maxErr, Math.hypot(draftPts[i].x - expectWorld[i].x, draftPts[i].y - expectWorld[i].y));
  }
} else {
  maxErr = 9999;
}
const maxErrScreen = maxErr * (await page.evaluate(() => window.__pathlab.state().canvas.zoom));
check(
  '套索预览与点击点一致（无偏移）',
  maxErrScreen < 1.5,
  'screenErr=' + maxErrScreen.toFixed(3) + 'px (world ' + maxErr.toFixed(2) + ')',
);
await page.mouse.click(polyPts[2].x, polyPts[2].y);
await page.mouse.click(polyPts[2].x, polyPts[2].y);
await sleep(500);
st = await st0();
const polyAnn = st.annotations.find((a) => a.type === 'polygon');
check('多边形双击闭合', !!polyAnn, polyAnn ? 'pts=' + polyAnn.geometry.points.length : 'missing');

await pickTool('f');
await page.mouse.move(pt.t.x, pt.t.y);
await page.mouse.down();
for (let i = 0; i <= 28; i++) {
  await page.mouse.move(pt.t.x + i * 5, pt.t.y + Math.sin(i / 3) * 22);
}
await page.mouse.up();
await sleep(450);

await pickTool('t');
const textPos = await P(0.5, 0.92);
await page.mouse.click(textPos.x, textPos.y);
await sleep(450);
const editorVisible = await page.$('.text-edit-overlay');
check('文字编辑框出现', !!editorVisible);
await page.keyboard.type('高倍镜下：细胞核深染，核仁明显');
await sleep(250);
await page.mouse.click(60, 930);
await sleep(550);

st = await st0();
const types = st.annotations.map((a) => a.type).sort();
check('矩形 / 椭圆 / 直线 / 箭头 全部创建', ['arrow', 'ellipse', 'line', 'rect'].every((t) => types.includes(t)), types.join(','));
check('自由轮廓创建', types.includes('freehand'));
const textAnn = st.annotations.find((a) => a.type === 'text');
check('文字内容正确', !!textAnn && textAnn.text === '高倍镜下：细胞核深染，核仁明显', textAnn ? JSON.stringify(textAnn.text) : 'missing');
check('全部标注绑定图片', st.annotations.every((a) => a.parentImageId), 'n=' + st.annotations.length);
await page.screenshot({ path: path.join(OUT, '20-annotations.png') });

// ---- 放大引用
await pickTool('m');
const ma = await P(0.62, 0.14), mb = await P(0.72, 0.26);
await dragFromTo(ma, mb);
st = await st0();
check('放大引用创建', st.magnifiers.length === 1, 'n=' + st.magnifiers.length);
const roiX = st.magnifiers[0].sourceRegion.x;
const destX = st.magnifiers[0].destination.x;

const probeMag = () => page.evaluate(() => {
  const s = window.__pathlab.state();
  const m = s.magnifiers[0];
  const img = s.images.find((i) => i.id === m.sourceImageId);
  const S = img.width / img.crop.width;
  const roiRadiusCanvas = (Math.min(Math.abs(m.sourceRegion.width), Math.abs(m.sourceRegion.height)) / 2) * S;
  return {
    radius: m.destination.radius,
    roiRadiusCanvas,
    ratio: m.destination.radius / roiRadiusCanvas,
    zoom: m.zoom,
    roiCX: m.sourceRegion.x + m.sourceRegion.width / 2,
    roiCY: m.sourceRegion.y + m.sourceRegion.height / 2,
    roiW: m.sourceRegion.width,
    destX: m.destination.x,
    destY: m.destination.y,
  };
});

// 不变式：投射圆直径 = 圈选区在画布上的直径 × 倍率
let mag0 = await probeMag();
check(
  '投射圆直径 = 圈选区直径 × 倍率',
  Math.abs(mag0.ratio - mag0.zoom) < 1e-3,
  'ratio=' + mag0.ratio.toFixed(4) + ' zoom=' + mag0.zoom,
);

// 改倍率
await page.evaluate(() => {
  const m = window.__pathlab.state().magnifiers[0];
  window.__pathlab.useUi.getState().setSelection([{ id: m.id, kind: 'magnifier' }]);
});
await sleep(250);
const plusBtn = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.selection-toolbar button')].find((b) => (b.getAttribute('aria-label') || '') === '提高倍率');
  if (!btn) return null;
  const r = btn.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
if (plusBtn) { await page.mouse.click(plusBtn.x, plusBtn.y); await sleep(300); }
st = await st0();
check('放大倍率可调整', st.magnifiers[0].zoom > 2, 'zoom=' + st.magnifiers[0].zoom);

const mag1 = await probeMag();
check('倍率提高后投射圆等比变大', mag1.radius > mag0.radius + 1, mag0.radius.toFixed(1) + ' -> ' + mag1.radius.toFixed(1));
check('倍率提高后圈选区不变（取景范围不动）', Math.abs(mag1.roiW - mag0.roiW) < 1e-6 && Math.abs(mag1.roiCX - mag0.roiCX) < 1e-6);
check('倍率提高后仍满足不变式', Math.abs(mag1.ratio - mag1.zoom) < 1e-3, 'ratio=' + mag1.ratio.toFixed(4) + ' zoom=' + mag1.zoom);

// 拖投射圆边缘 = 改取景范围（ROI 跟着变，倍率不变）
await page.evaluate(() => window.__pathlab.viewCommands.fit());
await sleep(500);
const edgeIn = await worldToScreen({ x: mag1.destX + mag1.radius, y: mag1.destY });
await dragFromTo(edgeIn, { x: edgeIn.x - 60, y: edgeIn.y });
const mag2 = await probeMag();
check('拖投射圆向内缩小取景范围', mag2.roiW < mag1.roiW - 1, mag1.roiW.toFixed(1) + ' -> ' + mag2.roiW.toFixed(1));
check('改取景范围时倍率不变', Math.abs(mag2.zoom - mag1.zoom) < 1e-6, 'zoom=' + mag2.zoom);
check('改取景范围后仍满足不变式', Math.abs(mag2.ratio - mag2.zoom) < 1e-3, 'ratio=' + mag2.ratio.toFixed(4) + ' zoom=' + mag2.zoom);

const edgeOut = await worldToScreen({ x: mag2.destX + mag2.radius, y: mag2.destY });
await dragFromTo(edgeOut, { x: edgeOut.x + 40, y: edgeOut.y });
const mag3 = await probeMag();
check('拖投射圆向外扩大取景范围', mag3.roiW > mag2.roiW + 1, mag2.roiW.toFixed(1) + ' -> ' + mag3.roiW.toFixed(1));

// 圈选区不会越出图片有效像素（防止投射出空白）
const beyond = await worldToScreen({ x: mag3.destX + mag3.radius + 200, y: mag3.destY });
await dragFromTo(beyond, { x: beyond.x + 400, y: beyond.y });
const mag4 = await probeMag();
const inBounds = await page.evaluate(() => {
  const s = window.__pathlab.state();
  const m = s.magnifiers[0];
  const img = s.images.find((i) => i.id === m.sourceImageId);
  const r = m.sourceRegion;
  return (
    r.x >= img.crop.x - 1 &&
    r.y >= img.crop.y - 1 &&
    r.x + r.width <= img.crop.x + img.crop.width + 1 &&
    r.y + r.height <= img.crop.y + img.crop.height + 1
  );
});
check('圈选区被限制在图片有效范围内', inBounds, 'w=' + mag4.roiW.toFixed(1));

// 圈选区颜色可从调色板直接选取
await page.evaluate(() => {
  const m = window.__pathlab.state().magnifiers[0];
  window.__pathlab.useUi.getState().setSelection([{ id: m.id, kind: 'magnifier' }]);
});
await page.evaluate(() => window.__pathlab.useUi.getState().setTool('select'));
await sleep(350);
const roiSwatches = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.selection-toolbar button')].filter((b) => (b.getAttribute('aria-label') || '').startsWith('颜色 '));
  return btns.map((b) => b.getAttribute('aria-label'));
});
const cyanBtn = await page.evaluate(() => {
  const b = [...document.querySelectorAll('.selection-toolbar button')].find((x) => x.getAttribute('aria-label') === '颜色 #0EA5E9');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
if (cyanBtn) { await page.mouse.click(cyanBtn.x, cyanBtn.y); await sleep(300); }
st = await st0();
check('圈选区颜色可用调色板更换', st.magnifiers[0].roiColor === '#0EA5E9', 'roiColor=' + st.magnifiers[0].roiColor + ' swatches=' + roiSwatches.length);

await dumpImgs('before-move');
// ---- 移动图片（在无标注的角落拖动）
await pickTool('v');
const imgAId = (await st0()).images[0].id;
const imgA0x = (await st0()).images[0].x;
const dragFrom = await page.evaluate((id) => {
  const s = window.__pathlab.state();
  const img = s.images.find((i) => i.id === id);
  const v = s.canvas;
  const rect = document.querySelector('.canvas-host').getBoundingClientRect();
  return { x: rect.left + (img.x + img.width * 0.92) * v.zoom + v.panX, y: rect.top + (img.y + img.height * 0.92) * v.zoom + v.panY };
}, imgAId);
const dragTo = { x: dragFrom.x + 70, y: dragFrom.y + 50 };
await dragFromTo(dragFrom, dragTo);
st = await st0();
const imgA2 = st.images.find((i) => i.id === imgAId);
check('图片可拖动', Math.abs(imgA2.x - imgA0x) > 10, 'dx=' + (imgA2.x - imgA0x).toFixed(1));
check('拖动其他图片不影响放大引用', Math.abs(st.magnifiers[0].destination.x - destX) < 0.01);

// 拖动放大引用的宿主图片，引用应一起移动
const hostB = st.images.find((i) => i.id === imgB.id);
await page.evaluate((id) => window.__pathlab.useUi.getState().setSelection([{ id, kind: 'image' }]), imgB.id);
await sleep(250);
const bCorner = await page.evaluate((id) => {
  const s = window.__pathlab.state();
  const img = s.images.find((i) => i.id === id);
  const v = s.canvas;
  const rect = document.querySelector('.canvas-host').getBoundingClientRect();
  return { x: rect.left + (img.x + img.width * 0.95) * v.zoom + v.panX, y: rect.top + (img.y + img.height * 0.06) * v.zoom + v.panY };
}, imgB.id);
const destBefore2 = (await st0()).magnifiers[0].destination.x;
const roiBeforeMove = (await st0()).magnifiers[0].sourceRegion.x;
await page.evaluate(() => window.__pathlab.useUi.getState().setSelection([]));
await sleep(250);
await dragFromTo(bCorner, { x: bCorner.x + 50, y: bCorner.y + 34 });
st = await st0();
check('放大引用随宿主图片移动', Math.abs(st.magnifiers[0].destination.x - destBefore2) > 5,
  'delta=' + (st.magnifiers[0].destination.x - destBefore2).toFixed(1));
check('sourceRegion 保持像素绑定', Math.abs(st.magnifiers[0].sourceRegion.x - roiBeforeMove) < 0.001);
void roiX;
void hostB;

await dumpImgs('after-move');
// ---- 图片缩放（拖角）
await page.evaluate(() => {
  const s = window.__pathlab.state();
  window.__pathlab.useUi.getState().setSelection([{ id: s.images[1].id, kind: 'image' }]);
});
await sleep(250);
const corner = await page.evaluate(() => {
  const s = window.__pathlab.state();
  const img = s.images[1];
  const v = s.canvas;
  const rect = document.querySelector('.canvas-host').getBoundingClientRect();
  return { x: rect.left + (img.x + img.width) * v.zoom + v.panX, y: rect.top + (img.y + img.height) * v.zoom + v.panY };
});
const beforeW = (await st0()).images[1].width;
await dragFromTo(corner, { x: corner.x + 60, y: corner.y + 45 });
st = await st0();
check('图片可缩放（保持比例）', st.images[1].width > beforeW + 10, beforeW.toFixed(0) + ' -> ' + st.images[1].width.toFixed(0));
const ar0 = st.images[1].width / st.images[1].height;
check('缩放保持比例', Math.abs(ar0 - bw / bh) < 0.02, 'ratio=' + ar0.toFixed(3) + ' vs ' + (bw / bh).toFixed(3));

await dumpImgs('after-resize');
// ---- 撤销 / 重做
const wAfter = st.images[1].width;
for (let i = 0; i < 4; i++) { await page.keyboard.down('Control'); await page.keyboard.press('KeyZ'); await page.keyboard.up('Control'); await sleep(160); }
st = await st0();
check('撤销可用', st.images[1].width !== wAfter, 'w=' + st.images[1].width.toFixed(0));
for (let i = 0; i < 4; i++) { await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.press('KeyZ'); await page.keyboard.up('Shift'); await page.keyboard.up('Control'); await sleep(160); }
st = await st0();
check('重做可用', Math.abs(st.images[1].width - wAfter) < 0.6, 'w=' + st.images[1].width.toFixed(0));

await dumpImgs('after-undoredo');
// ---- 裁切
await page.evaluate(() => {
  const s = window.__pathlab.state();
  window.__pathlab.useUi.getState().setSelection([{ id: s.images[0].id, kind: 'image' }]);
});
await sleep(250);
const cropBtn = await page.evaluate(() => {
  const b = [...document.querySelectorAll('.selection-toolbar button')].find((x) => x.getAttribute('aria-label') === '裁切图片');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
if (cropBtn) await page.mouse.click(cropBtn.x, cropBtn.y);
else {
  const s = await st0();
  const img = s.images[0];
  const c = await toScreen(img.x + img.width / 2, img.y + img.height / 2);
  await page.mouse.click(c.x, c.y, { clickCount: 2 });
}
await sleep(500);
check('进入裁切模式', (await page.$('.crop-hint')) !== null);
const imgA = (await st0()).images[0];
const nwHandle = await toScreen(imgA.x, imgA.y);
const target = await toScreen(imgA.x + imgA.width * 0.35, imgA.y + imgA.height * 0.3);
await dragFromTo(nwHandle, target);
await page.keyboard.press('Enter');
await sleep(500);
st = await st0();
const cropped = st.images.find((i) => i.id === imgA.id);
check('裁切已应用', cropped.crop.x > 0 && cropped.crop.y > 0 && cropped.crop.width < cropped.originalWidth,
  JSON.stringify(cropped.crop));
await page.screenshot({ path: path.join(OUT, '21-crop.png') });

// ---- 右侧写作区
await page.mouse.click(1420, 200);
await sleep(300);
await page.keyboard.type('低倍镜下：肝小叶结构紊乱，可见炎细胞浸润。');
await sleep(600);
await page.click('.insert-btn');
await sleep(300);
const mi = await page.$$('.menu .menu-item');
if (mi.length) await mi[0].click();
await sleep(600);
const doc = (await st0()).textDocument;
check('结构块插入', JSON.stringify(doc).includes('切片描述'), JSON.stringify(doc).slice(0, 120));
await page.screenshot({ path: path.join(OUT, '22-writing.png') });

await dumpImgs('before-export');
// ---- 导出
async function waitFiles(ext, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const f = fs.readdirSync(DL).filter((x) => x.endsWith(ext) && !x.endsWith('.crdownload'));
    if (f.length) { await sleep(700); return fs.readdirSync(DL); }
    await sleep(300);
  }
  return fs.readdirSync(DL);
}
await page.evaluate(() => window.__pathlab.useUi.getState().openExport('canvas'));
await sleep(400);
await page.evaluate(() => { const b = document.querySelector('.dialog .btn.primary'); if (b) b.click(); });
let all = await waitFiles('.png');
check('导出画布 PNG', all.some((f) => f.endsWith('.png')), JSON.stringify(all));
const png = all.find((f) => f.endsWith('.png'));
if (png) {
  const buf = fs.readFileSync(path.join(DL, png));
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  check('2× 画布尺寸合理', w > 1200 && h > 800, w + 'x' + h);
  check('导出不是空白（文件体积）', buf.length > 400000, buf.length + ' bytes');
}

await page.evaluate(() => window.__pathlab.useUi.getState().openExport('page'));
await sleep(400);
await page.evaluate(() => { const b = document.querySelector('.dialog .btn.primary'); if (b) b.click(); });
all = await waitFiles('.png', 40000);
const pf = all.find((f) => f.includes('整页'));
check('整页图文导出', !!pf, JSON.stringify(all));
if (pf) {
  const buf = fs.readFileSync(path.join(DL, pf));
  check('整页为 A4@2×', buf.readUInt32BE(16) === 1588 && buf.readUInt32BE(20) === 2246, buf.readUInt32BE(16) + 'x' + buf.readUInt32BE(20));
  check('整页不是空白', buf.length > 200000, buf.length + ' bytes');
  fs.copyFileSync(path.join(DL, pf), path.join(OUT, 'export-page.png'));
}
if (png) fs.copyFileSync(path.join(DL, png), path.join(OUT, 'export-canvas.png'));

// ---- 保存 / 打开 .pathlab
const before = await st0();
await page.evaluate(() => window.__pathlab.saveProjectToFile());
await sleep(2500);
const plab = fs.readdirSync(DL).find((f) => f.endsWith('.pathlab'));
check('保存 .pathlab', !!plab);
await page.evaluate(() => window.__pathlab.startNewProject());
await sleep(500);
check('新建工程清空', (await st0()).images.length === 0);
if (plab) {
  const b64 = fs.readFileSync(path.join(DL, plab)).toString('base64');
  await page.evaluate(async (d) => {
    const bin = atob(d); const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    await window.__pathlab.openProjectFromFile(new Blob([arr]));
  }, b64);
  await sleep(3000);
  st = await st0();
  check('打开工程恢复图片', st.images.length === before.images.length);
  check('打开工程恢复标注', st.annotations.length === before.annotations.length, st.annotations.length + '/' + before.annotations.length);
  check('打开工程恢复放大引用', st.magnifiers.length === before.magnifiers.length);
  check('打开工程恢复裁切', JSON.stringify(st.images.map((i) => i.crop)) === JSON.stringify(before.images.map((i) => i.crop)));
  check('打开工程恢复文字文档', JSON.stringify(st.textDocument) === JSON.stringify(before.textDocument));
  await page.screenshot({ path: path.join(OUT, '23-reopened.png') });
}

// ---- 自动保存恢复
await sleep(1600);
await page.reload({ waitUntil: 'networkidle0' });
await sleep(3200);
st = await st0();
check('刷新后自动恢复草稿', st.images.length > 0 && st.annotations.length > 0, 'images=' + st.images.length);
await page.screenshot({ path: path.join(OUT, '24-restored.png') });

// ---- 复制 / 删除
await page.evaluate(() => {
  const s = window.__pathlab.state();
  const a = s.annotations[0];
  window.__pathlab.useUi.getState().setSelection([{ id: a.id, kind: 'annotation' }]);
});
await sleep(200);
const n0 = (await st0()).annotations.length;
await page.keyboard.down('Control'); await page.keyboard.press('KeyD'); await page.keyboard.up('Control');
await sleep(400);
check('复制并偏移', (await st0()).annotations.length === n0 + 1);
await page.keyboard.press('Delete');
await sleep(400);
check('删除选中', (await st0()).annotations.length === n0);

// ---- 全部标注隐藏
await page.evaluate(() => window.__pathlab.useUi.getState().setAnnotationsVisible(false));
await sleep(300);
await page.screenshot({ path: path.join(OUT, '25-hidden-annotations.png') });
await page.evaluate(() => window.__pathlab.useUi.getState().setAnnotationsVisible(true));

check('无运行期错误', errors.length === 0, errors.slice(0, 4).join(' | '));
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ results, errors }, null, 2));
console.log('\n==== ' + results.filter((r) => !r.ok).length + ' failures / ' + results.length + ' checks ====');
await browser.close();