import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const endpoint = 'http://127.0.0.1:9237';
const userData = path.join(process.env.APPDATA || '', 'PathLab-1.1.0');
const keyFile = path.join(userData, 'translation', 'deepseek-key.bin');
const modelPackages = path.join(userData, 'argos', 'packages');
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} :: ${name}${detail ? ` :: ${detail}` : ''}`);
};

const browser = await puppeteer.connect({ browserURL: endpoint, defaultViewport: { width: 1440, height: 920 } });
try {
  let page = null;
  const waitUntil = Date.now() + 60000;
  while (!page && Date.now() < waitUntil) {
    const pages = await browser.pages();
    page = pages.find((candidate) => candidate.url().startsWith('pathlab://app/')) ?? null;
    if (!page) await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (!page) throw new Error('Packaged PathLab renderer did not appear on the remote-debugging port.');
  page.setDefaultTimeout(180000);
  await page.waitForFunction(() => Boolean(window.pathlabTranslation), { timeout: 30000 });
  check('便携版启动并加载 PathLab IPC bridge', page.url().startsWith('pathlab://app/'), page.url());

  const keyChecks = await page.evaluate(async () => {
    const bridge = window.pathlabTranslation;
    const missing = await bridge.invoke({ op: 'translate', provider: 'deepseek', text: '病理观察', sourceLanguage: 'zh', targetLanguage: 'en' });
    const firstSave = await bridge.invoke({ op: 'save-key', key: 'PathLab-1.1.0-smoke-key-A' });
    const firstStatus = await bridge.invoke({ op: 'status' });
    const secondSave = await bridge.invoke({ op: 'save-key', key: 'PathLab-1.1.0-smoke-key-B' });
    const secondStatus = await bridge.invoke({ op: 'status' });
    return { missing, firstSave, firstStatus, secondSave, secondStatus };
  });
  check('没有 Key 时 DeepSeek 清楚返回缺少密钥状态', keyChecks.missing.code === 'missing-key');
  check('safeStorage 密钥保存与修改可用', keyChecks.firstSave.ok && keyChecks.firstStatus.keyConfigured && keyChecks.secondSave.ok && keyChecks.secondStatus.keyConfigured);
  const encrypted = fs.existsSync(keyFile) ? fs.readFileSync(keyFile) : Buffer.alloc(0);
  const plaintextFound = encrypted.includes(Buffer.from('PathLab-1.1.0-smoke-key-B'));
  check('密钥文件仅位于 1.1.0 userData 且不含明文', encrypted.length > 0 && !plaintextFound, `${keyFile}; bytes=${encrypted.length}; plaintext=${plaintextFound}`);
  const deletion = await page.evaluate(async () => {
    const result = await window.pathlabTranslation.invoke({ op: 'delete-key' });
    const status = await window.pathlabTranslation.invoke({ op: 'status' });
    return { result, status };
  });
  check('safeStorage 密钥删除可用', deletion.result.ok && !deletion.status.keyConfigured && !fs.existsSync(keyFile));

  const modelReadyBefore = fs.existsSync(path.join(modelPackages, 'translate-zh_en-1_9', 'metadata.json'));
  let firstTranslation;
  let downloadCancelled = false;
  let progress = [];
  if (!modelReadyBefore) {
    firstTranslation = await page.evaluate(async () => {
      const bridge = window.pathlabTranslation;
      const phases = new Set();
      let cancelRequest = null;
      let cancelAck = null;
      const off = bridge.onProgress((item) => {
        phases.add(item.phase);
        if (item.phase === 'download' && !cancelRequest) {
          cancelRequest = bridge.invoke({ op: 'cancel' });
          cancelAck = cancelRequest;
        }
      });
      const timeout = window.setTimeout(() => {
        if (!cancelRequest) {
          cancelRequest = bridge.invoke({ op: 'cancel' });
          cancelAck = cancelRequest;
        }
      }, 60000);
      let result;
      let error = '';
      try {
        result = await bridge.invoke({ op: 'translate', provider: 'argos', text: '病理标注：肝细胞核呈深染。', sourceLanguage: 'zh', targetLanguage: 'en' });
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      }
      window.clearTimeout(timeout);
      off();
      if (cancelAck) await cancelAck;
      return { phases: [...phases], result, error, cancelRequested: Boolean(cancelRequest) };
    });
    progress = firstTranslation.phases;
    downloadCancelled = progress.includes('download') && firstTranslation.result?.cancelled === true;
    check('首次下载显示进度并可取消', downloadCancelled, `phases=${progress.join(',')}; error=${firstTranslation.error}`);
    const downloads = path.join(userData, 'argos', 'downloads');
    const partFiles = fs.existsSync(downloads) ? fs.readdirSync(downloads).filter((name) => name.endsWith('.part')) : [];
    check('取消后清理未完成模型临时文件', partFiles.length === 0, partFiles.join(','));
  } else {
    check('首次下载取消场景', false, '该 1.1.0 userData 已有中文模型，首次下载路径不再可重复。');
  }

  const translated = await page.evaluate(async () => {
    const bridge = window.pathlabTranslation;
    const phases = new Set();
    const off = bridge.onProgress((item) => phases.add(item.phase));
    try {
      const result = await bridge.invoke({ op: 'translate', provider: 'argos', text: '病理标注：\n肝细胞核呈深染，血窦轻度扩张。', sourceLanguage: 'zh', targetLanguage: 'en' });
      return { result, phases: [...phases] };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error), phases: [...phases] };
    } finally {
      off();
    }
  });
  const translatedText = translated.result?.text;
  check('便携版从 userData 下载/安装本地模型后可翻译', Boolean(translated.result?.ok && translatedText?.trim()), JSON.stringify(translated));
  check('本地模型翻译保留原标注换行', Boolean(translatedText?.includes('\n')));

  const reverse = await page.evaluate(async () => {
    const bridge = window.pathlabTranslation;
    const phases = new Set();
    const off = bridge.onProgress((item) => phases.add(item.phase));
    try {
      const result = await bridge.invoke({ op: 'translate', provider: 'argos', text: 'Pathology note:\nThe hepatocytes show mild vacuolar degeneration.', sourceLanguage: 'en', targetLanguage: 'zh' });
      return { result, phases: [...phases] };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error), phases: [...phases] };
    } finally {
      off();
    }
  });
  check('便携版按需下载反向模型并可翻译', Boolean(reverse.result?.ok && reverse.result.text?.trim()), JSON.stringify(reverse));
  check('反向翻译保留标注换行', Boolean(reverse.result?.text?.includes('\n')));

  const offline = await page.evaluate(async () => {
    const bridge = window.pathlabTranslation;
    const phases = new Set();
    const off = bridge.onProgress((item) => phases.add(item.phase));
    try {
      const result = await bridge.invoke({ op: 'translate', provider: 'argos', text: 'Pathology note:\nThe hepatocytes show mild vacuolar degeneration.', sourceLanguage: 'en', targetLanguage: 'zh' });
      return { result, phases: [...phases] };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error), phases: [...phases] };
    } finally {
      off();
    }
  });
  check('已装模型的重复请求走离线路径', Boolean(offline.result?.ok && offline.result.text?.trim() && !offline.phases.includes('download') && !offline.phases.includes('index')), JSON.stringify(offline));
  check('目标 userData 目录独立命名为 PathLab-1.1.0', path.basename(userData) === 'PathLab-1.1.0', userData);
} finally {
  await browser.close();
}

const failures = checks.filter((result) => !result.ok);
console.log(`\n==== ${failures.length} failures / ${checks.length} checks ====`);
if (failures.length) process.exitCode = 1;
