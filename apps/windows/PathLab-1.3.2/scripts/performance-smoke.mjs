import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const chrome = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const root = process.cwd();
const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const outputDir = path.join(root, 'performance-runs', runId);
const downloadsDir = path.join(outputDir, 'downloads');
fs.mkdirSync(downloadsDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1600,1000'],
  defaultViewport: { width: 1600, height: 1000 },
});
const page = await browser.newPage();
const cdp = await page.createCDPSession();
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadsDir, eventsEnabled: true });
await cdp.send('Performance.enable');
const runtimeErrors = [];
page.on('pageerror', (error) => runtimeErrors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') runtimeErrors.push(message.text()); });

const check = (name, passed, details = '') => ({ name, passed, details });
const checks = [];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const readMetrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));

await page.goto('http://localhost:5199/', { waitUntil: 'networkidle0', timeout: 60000 });
await page.evaluate(() => new Promise((resolve) => {
  const request = indexedDB.deleteDatabase('pathlab');
  request.onsuccess = request.onerror = request.onblocked = () => resolve();
}));
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__pathlab?.useProject);

const metricsBefore = await readMetrics();
const imageImport = await page.evaluate(async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 5000;
  canvas.height = 3500;
  const context = canvas.getContext('2d');
  context.fillStyle = '#2AA198';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'rgba(255,255,255,.32)';
  for (let y = 90; y < 1500; y += 140) {
    for (let x = 90; x < canvas.width; x += 140) {
      context.beginPath();
      context.arc(x, y, 28 + ((x * 7 + y * 11) % 36), 0, Math.PI * 2);
      context.fill();
    }
  }
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  const file = new File([blob], 'PathLab-performance-5000x3500.png', { type: 'image/png' });
  const started = performance.now();
  await window.__pathlab.importFiles([file]);
  return { importMs: performance.now() - started, encodedBytes: blob.size };
});
await page.waitForFunction(() => window.__pathlab.state().images.length === 1, { timeout: 30000 });
await wait(800);
const imageMeta = await page.evaluate(() => {
  const image = window.__pathlab.state().images[0];
  return {
    id: image.id,
    width: image.originalWidth,
    height: image.originalHeight,
    displayWidth: image.width,
    displayHeight: image.height,
  };
});
checks.push(check(
  '18 MP image imported without losing source dimensions',
  imageMeta.width === 5000 && imageMeta.height === 3500,
  JSON.stringify({ ...imageMeta, ...imageImport }),
));

const crop = { x: 3000, y: 2000, width: 1800, height: 1200 };
await page.evaluate(({ imageId, cropRect }) => {
  window.__pathlab.useUi.getState().setSelection([{ id: imageId, kind: 'image' }]);
  window.__pathlab.useUi.getState().setCrop(imageId, cropRect);
}, { imageId: imageMeta.id, cropRect: crop });
await page.keyboard.press('Enter');
await page.waitForFunction((expected) => {
  const image = window.__pathlab.state().images[0];
  return image.crop.x === expected.x && image.crop.y === expected.y && image.crop.width === expected.width;
}, { timeout: 10000 }, crop);
await wait(500);
const cropSample = await page.evaluate(() => {
  const project = window.__pathlab.state();
  const image = project.images[0];
  const host = document.querySelector('.canvas-host');
  const hostRect = host.getBoundingClientRect();
  const screenX = hostRect.left + (image.x + image.width / 2) * project.canvas.zoom + project.canvas.panX;
  const screenY = hostRect.top + (image.y + image.height / 2) * project.canvas.zoom + project.canvas.panY;
  return [...document.querySelectorAll('.konvajs-content canvas')].map((canvas) => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(canvas.width - 1, Math.round((screenX - rect.left) * canvas.width / rect.width)));
    const y = Math.max(0, Math.min(canvas.height - 1, Math.round((screenY - rect.top) * canvas.height / rect.height)));
    const pixel = canvas.getContext('2d')?.getImageData(x, y, 1, 1).data;
    return pixel ? [...pixel] : [];
  });
});
const cropPixelMatches = cropSample.some(([r, g, b, a]) => a > 220 && Math.abs(r - 42) < 8 && Math.abs(g - 161) < 8 && Math.abs(b - 152) < 8);
checks.push(check('high-resolution crop renders the correct source pixels after display downsampling', cropPixelMatches, JSON.stringify(cropSample)));

await page.evaluate(() => window.__pathlab.useUi.getState().setTool('hand'));
const hostRect = await page.$eval('.canvas-host', (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});
const start = { x: hostRect.x + hostRect.width * 0.36, y: hostRect.y + hostRect.height * 0.5 };
const framesPromise = page.evaluate(async () => {
  const intervals = [];
  let previous = 0;
  const stopAt = performance.now() + 1300;
  await new Promise((resolve) => {
    const frame = (now) => {
      if (previous) intervals.push(now - previous);
      previous = now;
      if (now < stopAt) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
  intervals.sort((a, b) => a - b);
  return {
    frames: intervals.length,
    averageFps: intervals.length / (1300 / 1000),
    medianMs: intervals[Math.floor(intervals.length * 0.5)] ?? 0,
    p95Ms: intervals[Math.floor(intervals.length * 0.95)] ?? 0,
    maxMs: intervals.at(-1) ?? 0,
  };
});
await page.mouse.move(start.x, start.y);
await page.mouse.down();
for (let i = 1; i <= 55; i += 1) {
  await page.mouse.move(start.x + i * 4, start.y + i * 1.5);
  await wait(16);
}
await page.mouse.up();
const dragFrames = await framesPromise;
checks.push(check('canvas pan stress run completed with measurable animation frames', dragFrames.frames >= 30, JSON.stringify(dragFrames)));

await page.evaluate(() => window.__pathlab.useUi.getState().openExport('page'));
await page.waitForSelector('.export-dialog-layout');
const exportStarted = Date.now();
await page.click('.export-dialog-layout .dialog-foot .btn.primary');
let exportPath = '';
for (let i = 0; i < 180; i += 1) {
  const found = fs.readdirSync(downloadsDir).find((name) => name.includes('整页图文@8x') && !name.endsWith('.crdownload'));
  if (found) { exportPath = path.join(downloadsDir, found); break; }
  await wait(500);
}
let exportResult = null;
if (exportPath) {
  const buffer = fs.readFileSync(exportPath);
  exportResult = {
    ms: Date.now() - exportStarted,
    bytes: buffer.length,
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    name: path.basename(exportPath),
  };
}
checks.push(check('A4 8× high-resolution export completed', Boolean(exportResult) && exportResult.width > 6000 && exportResult.height > 8500, JSON.stringify(exportResult)));

const metricsAfter = await readMetrics();
const report = {
  runtime: { browser: 'Chrome headless', viewport: '1600x1000', devicePixelRatio: await page.evaluate(() => devicePixelRatio) },
  imageImport: { ...imageMeta, ...imageImport },
  highResolutionCrop: { selectedCrop: crop, sampledLayerPixels: cropSample, passed: cropPixelMatches },
  canvasPan: dragFrames,
  a4Export: exportResult,
  memory: {
    jsHeapUsedMBBefore: Math.round((metricsBefore.JSHeapUsedSize ?? 0) / 1024 / 1024 * 10) / 10,
    jsHeapUsedMBAfter: Math.round((metricsAfter.JSHeapUsedSize ?? 0) / 1024 / 1024 * 10) / 10,
    totalFramesAfter: metricsAfter.Frames ?? null,
  },
  runtimeErrors,
  checks,
};
fs.writeFileSync(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
if (checks.some((item) => !item.passed) || runtimeErrors.length) process.exitCode = 1;
