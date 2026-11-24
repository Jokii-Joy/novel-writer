// 「摸鱼模式」— a tiny native document strip that sits over whatever else is
// on screen, so the writer can keep typing while pretending to work in Word.
//
// It is deliberately a *host* feature: the plugin host already runs inside the
// Electron main process (see clipboard.js), and only the main process can create
// a frameless, always-on-top window. In a plain `dsh web` Node process
// `require('electron')` returns the binary path instead of the API, so `open()`
// reports `electron-unavailable` and the client falls back with a message.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAX_TEXT = 2 * 1024 * 1024;
const WINDOW_HEIGHT = 188;
const WINDOW_WIDTH = 900;
const HOTKEY = 'Alt+`';

let electronApi;
let electronChecked = false;
function electron() {
  if (electronChecked) return electronApi;
  electronChecked = true;
  try {
    const api = createRequire(import.meta.url)('electron');
    if (api && api.BrowserWindow && api.ipcMain) electronApi = api;
  } catch (err) {
    electronApi = null;
  }
  return electronApi;
}

// --- Windows fallback -------------------------------------------------------
// The packaged DSH desktop app runs this module inside a Node-mode child of
// Electron (ELECTRON_RUN_AS_NODE=1), so `require('electron')` is unavailable
// and no BrowserWindow can be created. On Windows we shell out to a tiny WPF
// strip instead: PowerShell 5.1 ships with every supported Windows build, so
// the writer still gets an always-on-top document window without installing
// anything else.

const POWERSHELL = process.platform === 'win32'
  ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  : '';

let psChild = null;

function powershellAvailable() {
  try {
    return !!(POWERSHELL && fs.existsSync(POWERSHELL) && fs.existsSync(path.join(HERE, 'moyu.ps1')));
  } catch (err) {
    return false;
  }
}

function stopPowershell() {
  if (!psChild) return;
  const child = psChild;
  psChild = null;
  try {
    child.kill();
  } catch (err) {
    /* the strip may already be gone */
  }
}

function commitPowershell(outFile, own) {
  let text = null;
  try {
    text = fs.readFileSync(outFile, 'utf8');
  } catch (err) {
    text = null;
  }
  if (session !== own) return; // a newer window owns the session now
  commitSession(text);
}

function openPowershell(payload) {
  stopPowershell();
  let dir;
  let inFile;
  let outFile;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-moyu-'));
    inFile = path.join(dir, 'in.txt');
    outFile = path.join(dir, 'out.txt');
    fs.writeFileSync(inFile, textOf(payload.text), 'utf8');
    fs.writeFileSync(outFile, textOf(payload.text), 'utf8');
  } catch (err) {
    return { ok: false, reason: 'powershell-failed' };
  }

  const own = makeSession(payload);
  session = own;

  let child;
  try {
    child = spawn(POWERSHELL, [
      '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass',
      '-File', path.join(HERE, 'moyu.ps1'),
      '-In', inFile, '-Out', outFile,
      '-Title', titleOf(payload.title) || '文档1 - Word',
    ], { windowsHide: true, stdio: 'ignore' });
  } catch (err) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (cleanupErr) { /* ignore */ }
    return { ok: false, reason: 'powershell-failed' };
  }

  psChild = child;
  child.on('error', () => {
    if (psChild === child) psChild = null;
    // The strip never started: close the session so the client stops waiting.
    commitPowershell(outFile, own);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) { /* ignore */ }
  });
  child.on('exit', () => {
    if (psChild === child) psChild = null;
    commitPowershell(outFile, own);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) { /* ignore */ }
  });
  return { ok: true, powershell: true };
}

let win = null;
let session = null;
let shortcutOn = false;
let ipcInstalled = false;
let quittingHook = false;

function textOf(value) {
  return String(value == null ? '' : value).slice(0, MAX_TEXT);
}

function titleOf(value) {
  return String(value == null ? '' : value).slice(0, 160);
}

function makeSession(payload) {
  return {
    text: textOf(payload.text),
    title: titleOf(payload.title),
    chapterId: payload.chapterId == null ? null : String(payload.chapterId),
    novelId: payload.novelId == null ? null : String(payload.novelId),
    revision: 1,
    at: Date.now(),
    closed: false,
    open: true,
  };
}

function commitSession(text) {
  if (!session) return;
  if (text != null) session.text = textOf(text);
  session.revision += 1;
  session.at = Date.now();
  session.closed = true;
  session.open = false;
}

function unregisterShortcut() {
  if (!shortcutOn) return;
  shortcutOn = false;
  try {
    electron().globalShortcut.unregister(HOTKEY);
  } catch (err) {
    /* the shortcut may already be gone */
  }
}

function hideAndCommit(text) {
  if (!win) return;
  commitSession(text);
  unregisterShortcut();
  const current = win;
  win = null;
  try {
    if (!current.isDestroyed()) current.destroy();
  } catch (err) {
    /* already gone */
  }
}

function trusted(event) {
  return !!(win && event && event.sender === win.webContents);
}

function installIpc() {
  const api = electron();
  if (!api || ipcInstalled) return;
  const { ipcMain } = api;
  try {
    ipcMain.removeHandler('nw-moyu:init');
    ipcMain.removeAllListeners('nw-moyu:draft');
    ipcMain.removeAllListeners('nw-moyu:hide');
  } catch (err) {
    /* no previous handlers */
  }
  ipcMain.handle('nw-moyu:init', (event) => {
    if (!trusted(event) || !session) return { text: '', title: '' };
    return { text: session.text, title: session.title };
  });
  ipcMain.on('nw-moyu:draft', (event, text) => {
    if (!trusted(event) || !session) return;
    session.text = textOf(text);
  });
  ipcMain.on('nw-moyu:hide', (event, text) => {
    if (!trusted(event)) return;
    hideAndCommit(text);
  });
  ipcInstalled = true;
}

function installQuitHook() {
  if (quittingHook) return;
  const api = electron();
  if (!api || !api.app) return;
  quittingHook = true;
  try {
    api.app.on('before-quit', () => hideAndCommit());
  } catch (err) {
    /* nothing to do in a non-Electron host */
  }
}

/** True when the current process can actually create a native window. */
export function available() {
  const api = electron();
  return !!(api && api.BrowserWindow) || powershellAvailable();
}

/** Open or focus the document strip. Returns `{ok, reason?, reused?}`. */
export function open(payload = {}) {
  const api = electron();
  if (!api) {
    if (!powershellAvailable()) return { ok: false, reason: 'electron-unavailable' };
    return openPowershell(payload);
  }

  // A second open always starts from the caller's current chapter. The client
  // refuses to call open while its own session is armed, so a call here means
  // the window was left behind (reload, chapter switch, or a previous open
  // failed halfway). Retire the old session so it cannot be written back over
  // the chapter the caller is looking at now.
  if (win && !win.isDestroyed()) hideAndCommit();

  installIpc();
  installQuitHook();
  session = makeSession(payload);

  const { BrowserWindow, screen } = api;
  if (typeof BrowserWindow !== 'function') {
    return { ok: false, reason: 'electron-unavailable' };
  }

  let workArea;
  try {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    workArea = display.workArea;
  } catch (err) {
    workArea = { x: 0, y: 0, width: 1440, height: 900 };
  }
  const width = Math.max(560, Math.min(WINDOW_WIDTH, workArea.width - 80));
  const height = Math.min(WINDOW_HEIGHT, Math.max(120, workArea.height - 80));
  const x = Math.round(workArea.x + (workArea.width - width) / 2);
  const y = Math.round(workArea.y + workArea.height - height - 28);

  win = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    transparent: false,
    backgroundColor: '#ffffff',
    hasShadow: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    title: '文档1 - Word',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(HERE, 'moyu-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  try {
    win.setMenu(null);
    win.setAlwaysOnTop(true, 'floating');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch (err) {
    /* older Electron builds may not support one of these */
  }

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile(path.join(HERE, 'moyu.html')).catch(() => {});
  win.once('ready-to-show', () => {
    if (!win) return;
    try {
      win.show();
      win.focus();
    } catch (err) {
      /* window vanished while loading */
    }
  });
  win.on('closed', () => {
    if (!win) return; // hideAndCommit already detached it
    win = null;
    commitSession();
    unregisterShortcut();
  });

  try {
    shortcutOn = api.globalShortcut.register(HOTKEY, () => hideAndCommit());
  } catch (err) {
    shortcutOn = false;
  }

  return { ok: true, bounds: { x, y, width, height } };
}

/** Latest committed draft, if any. The client passes the revision it has. */
export function poll(payload = {}) {
  if (!session) return { session: false };
  return {
    session: true,
    revision: session.revision,
    text: session.text,
    at: session.at,
    closed: session.closed,
    open: !!((win && !win.isDestroyed()) || psChild),
    chapterId: session.chapterId,
    novelId: session.novelId,
    title: session.title,
  };
}

/** Hide and commit from the client side (plugin teardown, explicit close). */
export function close() {
  if (win) hideAndCommit();
  if (psChild) stopPowershell();
  return { ok: true };
}

/** Release everything the module owns. Called on plugin disposal. */
export function dispose() {
  hideAndCommit();
  stopPowershell();
  unregisterShortcut();
}
