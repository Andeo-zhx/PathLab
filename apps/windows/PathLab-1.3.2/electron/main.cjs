const { app, BrowserWindow, ipcMain, net, protocol, safeStorage } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const APP_SCHEME = 'pathlab';
const APP_HOST = 'app';
const TRANSLATION_CHANNEL = 'pathlab:translation';
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-flash';
const MAX_TRANSLATION_CHARS = 12000;
const STARTUP_SPLASH_MIN_MS = 720;
const SYSTEM_PROMPT =
  'Translate into {target language}. Preserve meaning, pathology and medical terminology, abbreviations, Latin species names, numbers, and line breaks. Return only the translation, without explanations, alternatives, or Markdown.';
const translationTasks = new Map();
let splashWindow = null;
let startupStartedAt = 0;
let startupRevealScheduled = false;

// Keep 1.3.2 Chromium data, drafts, and credentials separate from other releases.
const startupTestUserData = process.env.PATHLAB_STARTUP_SMOKE_TEST === '1'
  ? process.env.PATHLAB_TEST_USER_DATA
  : null;
if (startupTestUserData) {
  fs.mkdirSync(startupTestUserData, { recursive: true });
  app.setPath('userData', path.resolve(startupTestUserData));
} else {
  app.setPath('userData', path.join(app.getPath('appData'), 'PathLab-1.3.2'));
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

function localAssetPath(requestUrl, distRoot) {
  const url = new URL(requestUrl);
  if (url.hostname !== APP_HOST) return null;

  const relativeRequest = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  const resolved = path.resolve(distRoot, relativeRequest);
  const relativeResolved = path.relative(distRoot, resolved);
  if (relativeResolved.startsWith('..') || path.isAbsolute(relativeResolved)) return null;
  return resolved;
}

async function serveAppAsset(request, distRoot) {
  const filePath = localAssetPath(request.url, distRoot);
  if (!filePath) return new Response('Not found', { status: 404 });

  try {
    return await net.fetch(pathToFileURL(filePath).toString());
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

function isInternalAppUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === `${APP_SCHEME}:` && url.hostname === APP_HOST;
  } catch {
    return false;
  }
}

function ensureInternalSender(event) {
  if (!isInternalAppUrl(event.senderFrame?.url ?? '')) {
    throw new Error('拒绝来自非 PathLab 页面调用翻译服务。');
  }
}

function keyFilePath() {
  return path.join(app.getPath('userData'), 'translation', 'deepseek-key.bin');
}

async function requireSafeStorage() {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new Error('系统加密服务暂不可用，无法安全保存 DeepSeek API Key。');
  }
}

async function storeDeepSeekKey(value) {
  const key = typeof value === 'string' ? value.trim() : '';
  if (key.length < 12 || key.length > 512) throw new Error('API Key 格式无效。');
  await requireSafeStorage();
  const filepath = keyFilePath();
  await fsp.mkdir(path.dirname(filepath), { recursive: true });
  const encrypted = await safeStorage.encryptStringAsync(key);
  const temporary = `${filepath}.tmp`;
  await fsp.writeFile(temporary, Buffer.from(encrypted));
  try {
    await fsp.rename(temporary, filepath);
  } catch (error) {
    if (error?.code !== 'EXDEV' && error?.code !== 'EPERM') throw error;
    try {
      await fsp.copyFile(temporary, filepath);
    } finally {
      await fsp.rm(temporary, { force: true });
    }
  }
}

async function readDeepSeekKey() {
  const filepath = keyFilePath();
  if (!fs.existsSync(filepath)) return null;
  await requireSafeStorage();
  const encrypted = await fsp.readFile(filepath);
  const decoded = await safeStorage.decryptStringAsync(encrypted);
  if (decoded.shouldReEncrypt) {
    const replacement = await safeStorage.encryptStringAsync(decoded.result);
    await fsp.writeFile(filepath, Buffer.from(replacement));
  }
  return decoded.result;
}

async function callDeepSeek(text, targetLanguage, task) {
  const key = await readDeepSeekKey();
  if (!key) return { ok: false, code: 'missing-key', message: '请先添加 DeepSeek API Key。' };
  const requestController = new AbortController();
  const onAbort = () => requestController.abort();
  task.controller.signal.addEventListener('abort', onAbort, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    requestController.abort();
  }, 45000);
  try {
    const response = await net.fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT.replace('{target language}', targetLanguage) },
          { role: 'user', content: text },
        ],
        thinking: { type: 'disabled' },
        max_tokens: 2048,
      }),
      signal: requestController.signal,
    });
    const raw = await response.text();
    let payload;
    try { payload = JSON.parse(raw); } catch { payload = null; }
    if (!response.ok) {
      const detail = payload?.error?.message || `HTTP ${response.status}`;
      throw new Error(`DeepSeek 请求失败：${String(detail).slice(0, 300)}`);
    }
    const translated = payload?.choices?.[0]?.message?.content;
    if (typeof translated !== 'string' || !translated.trim()) throw new Error('DeepSeek 没有返回译文。');
    return { ok: true, text: translated.trim() };
  } catch (error) {
    if (timedOut && !task.controller.signal.aborted) throw new Error('DeepSeek 请求超时，请检查网络后重试。');
    if (!task.controller.signal.aborted && error instanceof TypeError) {
      throw new Error('无法连接 DeepSeek，请检查网络或代理设置后重试。');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    task.controller.signal.removeEventListener('abort', onAbort);
  }
}

ipcMain.handle(TRANSLATION_CHANNEL, async (event, request) => {
  ensureInternalSender(event);
  if (!request || typeof request !== 'object' || typeof request.op !== 'string') {
    throw new Error('翻译请求格式无效。');
  }
  if (request.op === 'cancel') {
    const task = translationTasks.get(event.sender.id);
    if (task) task.controller.abort();
    return { ok: true, cancelled: true };
  }
  if (request.op === 'status') {
    return { ok: true, keyConfigured: fs.existsSync(keyFilePath()) };
  }
  if (request.op === 'save-key') {
    await storeDeepSeekKey(request.key);
    return { ok: true };
  }
  if (request.op === 'delete-key') {
    await fsp.rm(keyFilePath(), { force: true });
    return { ok: true };
  }
  if (request.op !== 'translate') throw new Error('不支持的翻译操作。');

  const { text, sourceLanguage, targetLanguage } = request;
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_TRANSLATION_CHARS) {
    throw new Error(`标注文字必须为 1–${MAX_TRANSLATION_CHARS} 个字符。`);
  }
  if (!['zh', 'en'].includes(sourceLanguage) || !['zh', 'en'].includes(targetLanguage) || sourceLanguage === targetLanguage) {
    throw new Error('目前只支持中文与英文互译。');
  }
  if (translationTasks.has(event.sender.id)) throw new Error('当前已有翻译任务正在运行。');

  const task = { controller: new AbortController() };
  translationTasks.set(event.sender.id, task);
  try {
    return await callDeepSeek(text, targetLanguage === 'en' ? 'English' : 'Chinese', task);
  } catch (error) {
    if (task.controller.signal.aborted || error?.name === 'AbortError') return { ok: true, cancelled: true };
    throw error;
  } finally {
    translationTasks.delete(event.sender.id);
  }
});

function closeSplashWindow() {
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
  splashWindow = null;
}

function createSplashWindow() {
  const window = new BrowserWindow({
    width: 440,
    height: 264,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  splashWindow = window;
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    if (splashWindow === window) splashWindow = null;
  });
  void window.loadFile(path.join(__dirname, 'splash.html'));
  return window;
}

function revealMainWindow(window) {
  if (startupRevealScheduled) return;
  startupRevealScheduled = true;
  const remaining = Math.max(0, STARTUP_SPLASH_MIN_MS - (Date.now() - startupStartedAt));

  setTimeout(() => {
    startupRevealScheduled = false;
    if (!window.isDestroyed()) window.show();
    closeSplashWindow();
  }, remaining);
}

function createMainWindow({ useStartupSplash = false } = {}) {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f4f5f7',
    title: 'PathLab 病理实验图文标注工作台',
    icon: path.join(app.getAppPath(), 'dist', 'pathlab.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isInternalAppUrl(url)) event.preventDefault();
  });
  window.once('ready-to-show', () => {
    if (useStartupSplash) revealMainWindow(window);
    else window.show();
  });
  window.webContents.on('did-fail-load', (_event, _code, description, _url, isMainFrame) => {
    if (useStartupSplash && isMainFrame) {
      console.error(`PathLab failed to load: ${description}`);
      revealMainWindow(window);
    }
  });
  void window.loadURL(`${APP_SCHEME}://${APP_HOST}/index.html`).catch((error) => {
    console.error('PathLab startup load failed:', error);
    if (useStartupSplash) revealMainWindow(window);
  });
  return window;
}

app.whenReady().then(async () => {
  startupStartedAt = Date.now();
  createSplashWindow();
  try {
    const distRoot = path.join(app.getAppPath(), 'dist');
    await protocol.handle(APP_SCHEME, (request) => serveAppAsset(request, distRoot));
    createMainWindow({ useStartupSplash: true });
  } catch (error) {
    closeSplashWindow();
    throw error;
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
