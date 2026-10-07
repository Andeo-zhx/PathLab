import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu'],
  defaultViewport: { width: 1600, height: 1000 },
});
const page = await browser.newPage();
const errors = [];
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} :: ${name}${detail ? ` :: ${detail}` : ''}`);
};
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
page.on('pageerror', (error) => errors.push(error.message));
await page.evaluateOnNewDocument(() => {
  const calls = [];
  Object.defineProperty(window, '__translationCalls', { value: calls });
  Object.defineProperty(window, 'pathlabTranslation', {
    configurable: true,
    value: {
      invoke: async (request) => {
        calls.push({ ...request });
        if (request.op === 'status') return { ok: true, keyConfigured: true };
        if (request.op === 'cancel' || request.op === 'save-key' || request.op === 'delete-key') return { ok: true };
        return {
          ok: true,
          text: request.provider === 'deepseek' ? 'DeepSeek result' : 'Local result',
        };
      },
      onProgress: () => () => {},
    },
  });
});

await page.goto('http://localhost:5199/', { waitUntil: 'networkidle0', timeout: 60000 });
await page.evaluate(() => new Promise((resolve) => {
  const request = indexedDB.deleteDatabase('pathlab');
  request.onsuccess = request.onerror = request.onblocked = () => resolve();
}));
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__pathlab?.useProject);

const original = '病理观察：肝细胞核呈深染';
await page.evaluate((text) => {
  const annotation = {
    id: 'translation-test',
    type: 'text',
    parentImageId: null,
    geometry: { position: { x: 130, y: 150 } },
    stroke: '#E23B3B',
    strokeWidth: 3,
    dash: [],
    fill: null,
    text,
    textStyle: { fontSize: 24, fontWeight: 600, fontStyle: 'normal', align: 'left', color: '#E23B3B', background: null, outline: null },
    zIndex: 1,
    visible: true,
    locked: false,
  };
  window.__pathlab.useProject.getState().apply((draft) => draft.annotations.push(annotation));
  window.__pathlab.useUi.getState().setTool('select');
  window.__pathlab.useUi.getState().setSelection([{ id: annotation.id, kind: 'annotation' }]);
}, original);

await page.waitForSelector('[aria-label="翻译标注"]', { timeout: 10000 });
check('未锁定文字标注显示翻译入口', true);
await page.click('[aria-label="翻译标注"]');
await page.waitForFunction(() => document.querySelector('.translation-result')?.value === 'Local result');
const localCalls = await page.evaluate(() => window.__translationCalls.filter((request) => request.op === 'translate'));
check('打开预览默认只调用本地引擎', localCalls.length === 1 && localCalls[0].provider === 'argos', JSON.stringify(localCalls.map((c) => c.provider)));
check('中文方向自动识别为英译', (await page.$eval('.translation-dialog .dh-sub', (el) => el.textContent || '')).includes('中文 → English'));

await page.click('.translation-cloud-button');
await page.waitForFunction(() => document.querySelector('.translation-result')?.value === 'DeepSeek result');
const providers = await page.evaluate(() => window.__translationCalls.filter((request) => request.op === 'translate').map((request) => request.provider));
check('手动点击后才调用 DeepSeek', providers.join(',') === 'argos,deepseek', providers.join(','));

await page.$eval('.translation-result', (el) => {
  const input = el;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(input, '人工修订后的英文译文');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.click('.translation-dialog .dialog-foot .btn.primary');
await page.waitForFunction(() => !document.querySelector('.translation-dialog'));
let result = await page.evaluate(() => {
  const state = window.__pathlab.useProject.getState();
  const annotation = state.project.annotations.find((item) => item.id === 'translation-test');
  return {
    text: annotation?.text,
    geometry: annotation?.geometry,
    stroke: annotation?.stroke,
    textStyle: annotation?.textStyle,
    past: state.past.length,
  };
});
check('确认后译文追加到原文下一行', result.text === `${original}\n人工修订后的英文译文`, JSON.stringify(result.text));
check('写回保留位置与样式', result.geometry.position.x === 130 && result.geometry.position.y === 150 && result.stroke === '#E23B3B' && result.textStyle.fontSize === 24);
check('双语追加成为单次可撤销编辑', result.past === 1, `history=${result.past}`);

await page.evaluate(() => window.__pathlab.useProject.getState().undo());
result = await page.evaluate(() => window.__pathlab.state().annotations.find((item) => item.id === 'translation-test')?.text);
check('撤销恢复完整原文', result === original, String(result));

await page.evaluate(() => {
  window.__pathlab.useProject.getState().apply((draft) => { draft.annotations[0].locked = true; });
  window.__pathlab.useUi.getState().setSelection([{ id: 'translation-test', kind: 'annotation' }]);
});
await page.waitForSelector('[aria-label="翻译标注"]');
check('锁定文字标注禁用翻译入口', await page.$eval('[aria-label="翻译标注"]', (el) => el.disabled));
check('无页面运行期错误', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
const failures = checks.filter((result) => !result.ok);
console.log(`\n==== ${failures.length} failures / ${checks.length} checks ====`);
if (failures.length) process.exitCode = 1;
