import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const endpoint = 'http://127.0.0.1:9237';
const userData = path.join(process.env.APPDATA || '', 'PathLab-1.3.2');
const keyFile = path.join(userData, 'translation', 'deepseek-key.bin');
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} :: ${name}${detail ? ` :: ${detail}` : ''}`);
};

const browser = await puppeteer.connect({ browserURL: endpoint, defaultViewport: { width: 1440, height: 920 } });
try {
  let page = null;
  const deadline = Date.now() + 60000;
  while (!page && Date.now() < deadline) {
    page = (await browser.pages()).find((candidate) => candidate.url().startsWith('pathlab://app/')) ?? null;
    if (!page) await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (!page) throw new Error('Packaged PathLab renderer did not appear on the remote-debugging port.');
  await page.waitForFunction(() => Boolean(window.pathlabTranslation), { timeout: 30000 });
  check('1.3.2 便携版启动并加载 Electron 翻译桥', page.url().startsWith('pathlab://app/'), page.url());

  const statusBefore = await page.evaluate(() => window.pathlabTranslation.invoke({ op: 'status' }));
  check('1.3.2 使用独立 userData 目录', path.basename(userData) === 'PathLab-1.3.2', userData);
  const missing = await page.evaluate(() => window.pathlabTranslation.invoke({
    op: 'translate', text: '病理观察', sourceLanguage: 'zh', targetLanguage: 'en',
  }));
  check('未保存 API Key 时不发起云请求并提示缺少 Key', missing.code === 'missing-key', missing.code || missing.message || '');

  const firstSave = await page.evaluate(() => window.pathlabTranslation.invoke({ op: 'save-key', key: 'PathLab-1.3.2-smoke-key-A' }));
  const firstStatus = await page.evaluate(() => window.pathlabTranslation.invoke({ op: 'status' }));
  const secondSave = await page.evaluate(() => window.pathlabTranslation.invoke({ op: 'save-key', key: 'PathLab-1.3.2-smoke-key-B' }));
  const secondStatus = await page.evaluate(() => window.pathlabTranslation.invoke({ op: 'status' }));
  check('safeStorage 可保存并修改 DeepSeek Key', firstSave.ok && firstStatus.keyConfigured && secondSave.ok && secondStatus.keyConfigured);

  const encrypted = fs.existsSync(keyFile) ? fs.readFileSync(keyFile) : Buffer.alloc(0);
  const plaintextFound = encrypted.includes(Buffer.from('PathLab-1.3.2-smoke-key-B'));
  check('Key 仅写入 1.3.2 配置目录且文件不含明文', encrypted.length > 0 && !plaintextFound, `${keyFile}; bytes=${encrypted.length}; plaintext=${plaintextFound}`);

  const deletion = await page.evaluate(async () => {
    const removed = await window.pathlabTranslation.invoke({ op: 'delete-key' });
    const status = await window.pathlabTranslation.invoke({ op: 'status' });
    return { removed, status };
  });
  check('safeStorage Key 删除成功并恢复未配置状态', deletion.removed.ok && !deletion.status.keyConfigured && !fs.existsSync(keyFile));
  check('测试完成后没有残留临时 Key 文件', !fs.existsSync(`${keyFile}.tmp`), `${keyFile}.tmp`);
  check('初始 Key 状态可读取', statusBefore.ok === true, JSON.stringify(statusBefore));
} finally {
  await browser.disconnect();
}

const failures = checks.filter((result) => !result.ok);
console.log(`\n==== ${failures.length} failures / ${checks.length} checks ====`);
if (failures.length) process.exitCode = 1;
