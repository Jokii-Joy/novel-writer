// OS clipboard writer for the paste panel.
//
// Why this exists: in the Harness WebView, `navigator.clipboard.writeText` can
// reject (permission denied) and the old `textarea + execCommand('copy')`
// fallback can return false when the document is not focused. Copying a whole
// chapter would then fail with no way out. The host, however, already has access
// to the OS clipboard, so the client can ask it directly.
//
// Order of attempts:
//   1. Electron's clipboard module — exact, synchronous, no subprocess.
//   2. Windows: PowerShell reading a UTF-8 temp file (clip.exe mangles non-ASCII
//      text because it decodes stdin with the OEM code page), then clip.exe.
//   3. macOS: pbcopy. Linux: wl-copy / xclip / xsel.
//
// The module is deliberately tiny and has no state: every call is one write.
import { spawn } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const WRITE_TIMEOUT_MS = 12000;
const MAX_WRITE_CHARS = 8 * 1024 * 1024;

// `require('electron')` resolves to the API object in the Electron main
// process and to a binary path in plain Node, so the feature test is the
// `clipboard` object itself. When the plugin is hosted outside Electron this
// stays null and the subprocess path takes over.
let electronClipboard = null;
try {
  const electron = createRequire(import.meta.url)('electron');
  if (electron && electron.clipboard && typeof electron.clipboard.writeText === 'function') {
    electronClipboard = electron.clipboard;
  }
} catch (err) {
  electronClipboard = null;
}

function feed(command, args, value) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = 0;
    const done = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };
    let child;
    try {
      child = spawn(command, args, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    } catch (err) {
      resolve({ ok: false, error: err && err.message ? err.message : String(err) });
      return;
    }
    timer = setTimeout(() => {
      try {
        child.kill();
      } catch (err) {
        /* already gone */
      }
      done({ ok: false, error: 'timeout' });
    }, WRITE_TIMEOUT_MS);
    if (typeof timer.unref === 'function') timer.unref();
    let stderr = '';
    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        if (stderr.length < 4000) stderr += String(chunk);
      });
    }
    child.on('error', (err) => done({ ok: false, error: err && err.message ? err.message : String(err) }));
    child.on('close', (code) => {
      if (code === 0) done({ ok: true });
      else done({ ok: false, error: stderr.trim() || 'exit ' + String(code) });
    });
    if (child.stdin) {
      // EPIPE when the command exits before reading everything (e.g. `clip` on a
      // remote session); the close handler reports the real failure.
      child.stdin.on('error', () => {});
      child.stdin.end(value);
    }
  });
}

function quotePowerShell(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

async function writeWindows(value) {
  // PowerShell's `$input | Set-Clipboard` decodes stdin with the OEM code page,
  // so Chinese prose arrives as mojibake. A UTF-8 temp file sidesteps both the
  // code page and the command-line length limit.
  let file = '';
  try {
    file = path.join(os.tmpdir(), `nw-clipboard-${process.pid}-${Date.now().toString(36)}.txt`);
    await fsp.writeFile(file, value, 'utf8');
    const script =
      "$ErrorActionPreference='Stop'; " +
      `Set-Clipboard -Value ([IO.File]::ReadAllText(${quotePowerShell(file)}, [Text.Encoding]::UTF8))`;
    const result = await feed('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], '');
    if (result.ok) return { ok: true, via: 'powershell' };
  } catch (err) {
    /* fall through to clip.exe */
  } finally {
    if (file) {
      fsp.unlink(file).catch(() => {});
    }
  }
  return feed('clip.exe', [], value);
}

function attemptsForPlatform() {
  if (process.platform === 'darwin') return [['pbcopy', []]];
  return [
    ['wl-copy', []],
    ['xclip', ['-selection', 'clipboard']],
    ['xsel', ['--clipboard', '--input']],
  ];
}

/**
 * Put `text` on the OS clipboard.
 *
 * Resolves `{ok:true, via}` on success and `{ok:false, error}` when every
 * channel failed; never rejects, because the caller turns the result into a
 * toast and a manual-copy hint.
 */
export async function writeClipboard(text) {
  const value = String(text == null ? '' : text);
  if (!value) return { ok: true, empty: true };
  if (value.length > MAX_WRITE_CHARS) {
    return { ok: false, error: 'text-too-large', chars: value.length };
  }
  if (electronClipboard) {
    try {
      electronClipboard.writeText(value);
      return { ok: true, via: 'electron' };
    } catch (err) {
      /* fall through to the native pipe */
    }
  }
  if (process.platform === 'win32') {
    const windows = await writeWindows(value);
    if (windows.ok) return windows;
    return { ok: false, error: windows.error || 'clipboard-unavailable' };
  }
  let last = null;
  for (const [command, args] of attemptsForPlatform()) {
    const result = await feed(command, args, value);
    if (result.ok) return { ok: true, via: command };
    last = result;
  }
  return { ok: false, error: last && last.error ? last.error : 'clipboard-unavailable' };
}

export const CLIPBOARD_MAX_CHARS = MAX_WRITE_CHARS;
