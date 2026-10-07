import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DL = path.resolve('verify-prod');
fs.rmSync(DL, { recursive: true, force: true });
fs.mkdirSync(DL, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu'], defaultViewport: { width: 1500, height: 950 } });
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
const cdp = await page.createCDPSession();
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL, eventsEnabled: true });
await page.goto('http://localhost:5299/', { waitUntil: 'networkidle0' });
await sleep(1200);
const checks = [];
checks.push(['空状态', (await page.$('.empty-guide')) !== null]);
checks.push(['dev 调试桥未泄漏到生产', await page.evaluate(() => typeof window.__pathlab === 'undefined')]);
// 用真实拖放事件导入（生产版没有调试桥）
const dataTransferOk = await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 1200; c.height = 900;
  const ctx = c.getContext('2d'); ctx.fillStyle = '#f2dbe6'; ctx.fillRect(0,0,1200,900);
  for (let i=0;i<600;i++){ctx.beginPath();ctx.arc(Math.random()*1200,Math.random()*900,10,0,7);ctx.fillStyle='rgba(150,86,132,0.42)';ctx.fill();}
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const file = new File([blob], 'x.png', { type: 'image/png' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const host = document.querySelector('.canvas-host');
  host.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
  host.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
  return true;
});
void dataTransferOk;
await sleep(2600);
checks.push(['拖放导入显示图片', (await page.evaluate(() => document.querySelectorAll('.canvas-host canvas').length)) > 0]);
await page.screenshot({ path: 'verify-prod/prod-import.png' });
// 画一个矩形 + 放大引用
await page.keyboard.press('r'); await sleep(200);
await page.mouse.move(500, 400); await page.mouse.down(); await page.mouse.move(700, 520, { steps: 10 }); await page.mouse.up();
await sleep(400);
await page.keyboard.press('m'); await sleep(200);
await page.mouse.move(560, 300); await page.mouse.down(); await page.mouse.move(640, 380, { steps: 8 }); await page.mouse.up();
await sleep(700);
await page.screenshot({ path: 'verify-prod/prod-annotated.png' });
// 导出
await page.keyboard.down('Control'); await page.keyboard.press('KeyE'); await page.keyboard.up('Control');
await sleep(600);
const btn = await page.$('.dialog .btn.primary');
if (btn) await btn.click();
await sleep(12000);
const files = fs.readdirSync(DL).filter((f) => f.endsWith('.png'));
checks.push(['生产构建可导出 PNG', files.some((f) => f.includes('画布')), JSON.stringify(files)]);
checks.push(['无运行期错误', errors.length === 0, errors.slice(0,3).join(' | ')]);
for (const [n, ok, d] of checks) console.log((ok ? 'PASS' : 'FAIL') + ' :: ' + n + (d ? ' :: ' + d : ''));
console.log('failures: ' + checks.filter((c) => !c[1]).length + '/' + checks.length);
await browser.close();
