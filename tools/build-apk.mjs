#!/usr/bin/env node
/*
 * build-apk.mjs — assembles the 精神空间 phone app without Gradle.
 *
 * Why no Gradle: the app is framework-only (no AndroidX, no Kotlin), so the
 * entire pipeline is five commands — aapt2 compile, aapt2 link, javac, d8,
 * apksigner. A Gradle build would download ~200 MB and turn every network hiccup
 * into an obscure dependency error, for a project whose whole dependency list is
 * "android.jar".
 *
 * Usage: node tools/build-apk.mjs [--debug]
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const android = path.join(root, '.tools', 'android');
const sdk = path.join(android, 'sdk');
const jdk = path.join(android, 'jdk');
const build = path.join(android, 'build');

const aapt2 = path.join(sdk, 'build-tools', '34.0.0', 'aapt2.exe');
const androidJar = path.join(sdk, 'platforms', 'android-34', 'android.jar');
// d8 and apksigner ship as .bat launchers, and execFileSync cannot run a batch
// file without a shell (it fails with a bare "step failed: d8.bat"). Both are
// plain jars, so invoke them through java directly — no cmd.exe in the middle,
// no quoting surprises with the non-ASCII project path.
const java = path.join(jdk, 'bin', 'java.exe');
const d8Jar = path.join(sdk, 'build-tools', '34.0.0', 'lib', 'd8.jar');
const apksignerJar = path.join(sdk, 'build-tools', '34.0.0', 'lib', 'apksigner.jar');
const zipalign = path.join(sdk, 'build-tools', '34.0.0', 'zipalign.exe');
const javac = path.join(jdk, 'bin', 'javac.exe');
const keytool = path.join(jdk, 'bin', 'keytool.exe');

const appDir = path.join(root, 'app');
const resDir = path.join(appDir, 'res');
const manifest = path.join(appDir, 'AndroidManifest.xml');
const javaSrc = path.join(appDir, 'src');
const outApk = path.join(root, 'dist', '精神空间.apk');

function run(file, args, options = {}) {
  const started = Date.now();
  const shown = path.basename(file) + ' ' + args.filter((a) => !a.startsWith('-')).slice(0, 2).map((a) => path.basename(a)).join(' ');
  try {
    const stdout = execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, ...options });
    console.log(`  ok  ${shown} (${Date.now() - started}ms)`);
    return stdout;
  } catch (error) {
    console.error(`  !!  ${shown}`);
    console.error(String(error.stdout || ''));
    console.error(String(error.stderr || ''));
    throw new Error(`step failed: ${shown}`);
  }
}

// ---------------------------------------------------------------- prerequisites
for (const [label, file] of [
  ['aapt2', aapt2],
  ['android.jar', androidJar],
  ['java', java],
  ['d8.jar', d8Jar],
  ['apksigner.jar', apksignerJar],
  ['javac', javac],
]) {
  if (!fs.existsSync(file)) {
    console.error(`missing ${label}: ${file}\nrun: pwsh -File .tools/setup-android.ps1`);
    process.exit(1);
  }
}

await fsp.rm(build, { recursive: true, force: true });
await fsp.mkdir(path.join(build, 'res'), { recursive: true });
await fsp.mkdir(path.join(build, 'classes'), { recursive: true });
await fsp.mkdir(path.join(build, 'dex'), { recursive: true });
await fsp.mkdir(path.dirname(outApk), { recursive: true });

// ------------------------------------------------------------ 1. resources
console.log('resources');
const compiled = path.join(build, 'res.zip');
const resFiles = [];
const walk = async (dir) => {
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full);
    else resFiles.push(full);
  }
};
if (fs.existsSync(resDir)) await walk(resDir);
if (resFiles.length) {
  // aapt2 compile wants one file per invocation when passing a list via -o dir;
  // passing every file at once produces a single .zip which `link` accepts.
  run(aapt2, ['compile', '-o', compiled, ...resFiles]);
}

// ----------------------------------------------------------------- 2. link
console.log('link');
const unsigned = path.join(build, 'app-unsigned.apk');
const genDir = path.join(build, 'gen');
await fsp.mkdir(genDir, { recursive: true });
const linkArgs = [
  'link',
  '-o', unsigned,
  '-I', androidJar,
  '--manifest', manifest,
  '--java', genDir,
  '--min-sdk-version', '24',
  '--target-sdk-version', '34',
  '--version-code', '1',
  '--version-name', '1.0.0',
];
if (resFiles.length) linkArgs.push('--auto-add-overlay', '-R', compiled);
run(aapt2, linkArgs);

// ----------------------------------------------------------------- 3. javac
console.log('javac');
const javaFiles = [];
const walkJava = async (dir) => {
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walkJava(full);
    else if (entry.name.endsWith('.java')) javaFiles.push(full);
  }
};
await walkJava(javaSrc);
const genFiles = [];
const walkGen = async (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walkGen(full);
    else if (entry.name.endsWith('.java')) genFiles.push(full);
  }
};
await walkGen(genDir);

// ZXing is a normal jar on the classpath; d8 takes it as a library below.
const zxing = path.join(android, 'zxing-core-3.5.3.jar');
const classpath = [androidJar, zxing].filter((p) => fs.existsSync(p)).join(path.delimiter);
run(javac, [
  '-encoding', 'UTF-8',
  '-source', '17',
  '-target', '17',
  '-classpath', classpath,
  '-d', path.join(build, 'classes'),
  ...javaFiles,
  ...genFiles,
]);

// -------------------------------------------------------------------- 4. d8
console.log('d8');
const classFiles = [];
const walkClass = async (dir) => {
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walkClass(full);
    else if (entry.name.endsWith('.class')) classFiles.push(full);
  }
};
await walkClass(path.join(build, 'classes'));
const d8Args = [
  '-Xmx1024M',
  '-cp', d8Jar,
  'com.android.tools.r8.D8',
  '--release',
  '--min-api', '24',
  '--lib', androidJar,
  '--output', path.join(build, 'dex'),
  ...classFiles,
];
// ZXing has to be *program* input, not a --lib: a library is only used to
// resolve references, its classes never enter the dex, and the scanner would
// die with NoClassDefFoundError on the first frame. Only the core decoder is
// pulled in (d8 keeps what is actually reachable from our code).
if (fs.existsSync(zxing)) d8Args.push(zxing);
run(java, d8Args);

// Merge dex into the apk (aapt2 link produced a resource-only apk).
const dexFiles = (await fsp.readdir(path.join(build, 'dex'))).filter((n) => n.endsWith('.dex'));
const withDex = path.join(build, 'app-with-dex.apk');
await fsp.copyFile(unsigned, withDex);
{
  const { ZipArchive } = await import('./zip-append.mjs');
  await ZipArchive.append(withDex, path.join(build, 'dex'), dexFiles);
}

// ------------------------------------------------------------- 5. zipalign
console.log('zipalign');
const aligned = path.join(build, 'app-aligned.apk');
run(zipalign, ['-p', '-f', '4', withDex, aligned]);

// ------------------------------------------------------------- 6. signing
console.log('sign');
const keystore = path.join(android, 'debug.keystore');
if (!fs.existsSync(keystore)) {
  // A stable debug key: reinstalls keep their data, which matters while testing
  // the sync pairing (a new signature would force an uninstall, and an uninstall
  // wipes the paired peer record).
  run(keytool, [
    '-genkeypair', '-v',
    '-keystore', keystore,
    '-storepass', 'android',
    '-keypass', 'android',
    '-alias', 'novelwriter',
    '-keyalg', 'RSA',
    '-keysize', '2048',
    '-validity', '10000',
    '-dname', 'CN=Novel Writer, OU=local, O=local, L=local, S=local, C=CN',
  ]);
}
run(java, [
  '-Xmx1024M',
  '-cp', apksignerJar,
  'com.android.apksigner.ApkSignerTool',
  'sign',
  '--ks', keystore,
  '--ks-pass', 'pass:android',
  '--key-pass', 'pass:android',
  '--ks-key-alias', 'novelwriter',
  '--out', outApk,
  aligned,
]);

const size = fs.statSync(outApk).size;
console.log(`\napk: ${outApk}`);
console.log(`size: ${(size / 1024 / 1024).toFixed(2)} MB`);
