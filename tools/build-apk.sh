#!/usr/bin/env bash
# Same five steps as tools/build-apk.mjs, in bash, for the DSH sandbox: Node's
# piped-stdio spawn of a .exe fails with EPERM there, while a bash pipeline runs
# fine. Behaviour is identical — aapt2 compile, aapt2 link, javac, d8, zip/align,
# apksigner — and so is the output path.
#
#   bash tools/build-apk.sh
#
# Every path handed to the Android tools is *relative to the repo root*. That is
# not a style choice: this project lives under a non-ASCII directory (编码区), and
# aapt2.exe cannot open an absolute path containing those characters — it reports
# "failed to open directory" for a directory that plainly exists.
set -euo pipefail

cd "$(dirname "$0")/.."

ANDROID_JAR=.tools/android/sdk/platforms/android-34/android.jar
AAPT2=.tools/android/sdk/build-tools/34.0.0/aapt2.exe
JAVA=.tools/android/jdk/bin/java.exe
JAVAC=.tools/android/jdk/bin/javac.exe
ZIPALIGN=.tools/android/sdk/build-tools/34.0.0/zipalign.exe
BT=.tools/android/sdk/build-tools/34.0.0
ZXING=.tools/android/zxing-core-3.5.3.jar
B=.tools/android/build

[ -f "$ANDROID_JAR" ] || { echo "missing $ANDROID_JAR" >&2; exit 1; }

rm -rf "$B"
mkdir -p "$B/res" "$B/classes" "$B/dex" "$B/gen" dist

echo "== 1. resources"
"$AAPT2" compile --dir app/res -o "$B/res.zip"

echo "== 2. link"
"$AAPT2" link \
  -o "$B/app-unsigned.apk" \
  -I "$ANDROID_JAR" \
  --manifest app/AndroidManifest.xml \
  --java "$B/gen" \
  --min-sdk-version 24 --target-sdk-version 34 \
  --version-code 1 --version-name 1.0.0 \
  --auto-add-overlay -R "$B/res.zip"

echo "== 3. javac"
{ find app/src -name '*.java'; find "$B/gen" -name '*.java' 2>/dev/null || true; } > "$B/sources.txt"
"$JAVAC" -encoding UTF-8 -source 17 -target 17 \
  -classpath "$ANDROID_JAR;$ZXING" \
  -d "$B/classes" "@$B/sources.txt"

echo "== 4. d8"
find "$B/classes" -name '*.class' > "$B/classes.txt"
"$JAVA" -Xmx1024M -cp "$BT/lib/d8.jar" com.android.tools.r8.D8 \
  --release --min-api 24 --lib "$ANDROID_JAR" \
  --output "$B/dex" "@$B/classes.txt" "$ZXING"

echo "== 5. merge dex / zipalign / sign"
node --input-type=module -e '
  import fs from "node:fs";
  import path from "node:path";
  import { ZipArchive } from "./tools/zip-append.mjs";
  const build = path.join(".tools", "android", "build");
  const out = path.join(build, "app-with-dex.apk");
  fs.copyFileSync(path.join(build, "app-unsigned.apk"), out);
  const dex = fs.readdirSync(path.join(build, "dex")).filter((n) => n.endsWith(".dex"));
  await ZipArchive.append(out, path.join(build, "dex"), dex);
  console.log("   dex merged: " + dex.join(", "));
'
"$ZIPALIGN" -p -f 4 "$B/app-with-dex.apk" "$B/app-aligned.apk"
"$JAVA" -Xmx1024M -cp "$BT/lib/apksigner.jar" com.android.apksigner.ApkSignerTool sign \
  --ks .tools/android/debug.keystore \
  --ks-pass pass:android --key-pass pass:android --ks-key-alias novelwriter \
  --out "dist/精神空间.apk" "$B/app-aligned.apk"

echo
echo "apk: dist/精神空间.apk ($(stat -c %s dist/精神空间.apk) bytes)"
