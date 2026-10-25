# setup-android.ps1 — one-time download of the Android toolchain used by tools/build-apk.mjs
#
# Everything lands under .tools/android/ so the repo stays self-contained and a
# `git clean` never has to think about it (.tools/ is gitignored).
#
# Sizes: JDK ~180 MB, build-tools ~60 MB, platform-34 ~65 MB. Re-running is cheap:
# each step is skipped when the marker file already exists.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# .tools/ sits beside tools/, not inside it: build-apk.mjs and the git ignore rule
# both assume `.tools/android`, so anchor on the repo root here.
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$android = Join-Path $root '.tools\android'
$sdk = Join-Path $android 'sdk'
$jdkDir = Join-Path $android 'jdk'
$cache = Join-Path $android 'cache'
New-Item -ItemType Directory -Force -Path $android, $sdk, $cache | Out-Null

function Get-File($url, $dest) {
    if (Test-Path $dest) { return }
    $name = Split-Path -Leaf $dest
    Write-Host "  downloading $name ..."
    try {
        Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing -TimeoutSec 900
    } catch {
        Remove-Item -Force $dest -ErrorAction SilentlyContinue
        throw "download failed: $url`n$($_.Exception.Message)"
    }
    Write-Host ("  got {0} ({1:N1} MB)" -f $name, ((Get-Item $dest).Length / 1MB))
}

# ------------------------------------------------------------------ 1. JDK 17
# Adoptium's own `api.adoptium.net` endpoint answers with a 302 into
# github.com/.../releases, and github.com is unreachable from this network (the
# connection is reset before the TLS handshake — see tools/publish-github.mjs for
# the same wall). The Tsinghua mirror serves the identical Temurin build over
# plain HTTPS, so it is tried first with Adoptium as the fallback for networks
# where the mirror is the blocked one.
if (-not (Test-Path (Join-Path $jdkDir 'bin\javac.exe'))) {
    Write-Host 'JDK 17 (Temurin)'
    $zip = Join-Path $cache 'jdk17.zip'
    if (-not (Test-Path $zip)) {
        $sources = @(
            'https://mirrors.tuna.tsinghua.edu.cn/Adoptium/17/jdk/x64/windows/OpenJDK17U-jdk_x64_windows_hotspot_17.0.20.1_1.zip',
            'https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse'
        )
        $got = $false
        foreach ($url in $sources) {
            try {
                Get-File $url $zip
                $got = $true
                break
            } catch {
                Write-Host "  source failed: $url"
            }
        }
        if (-not $got) { throw 'no JDK source reachable' }
    } else {
        Write-Host '  using cached jdk17.zip'
    }
    $tmp = Join-Path $cache 'jdk-unzip'
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
    if (Test-Path $jdkDir) { Remove-Item -Recurse -Force $jdkDir }
    Move-Item $inner.FullName $jdkDir
    Remove-Item -Recurse -Force $tmp
}

# --------------------------------------------------------- 2. build-tools 34
$bt = Join-Path $sdk 'build-tools\34.0.0'
if (-not (Test-Path (Join-Path $bt 'aapt2.exe'))) {
    Write-Host 'Android build-tools 34.0.0'
    $zip = Join-Path $cache 'build-tools-34.zip'
    Get-File 'https://dl.google.com/android/repository/build-tools_r34-windows.zip' $zip
    $tmp = Join-Path $cache 'bt-unzip'
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    # The zip's top folder is version-named (android-14 / android-U), not "34.0.0".
    $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $bt) | Out-Null
    if (Test-Path $bt) { Remove-Item -Recurse -Force $bt }
    Move-Item $inner.FullName $bt
    Remove-Item -Recurse -Force $tmp
}

# ------------------------------------------------------------ 3. platform 34
$plat = Join-Path $sdk 'platforms\android-34'
if (-not (Test-Path (Join-Path $plat 'android.jar'))) {
    Write-Host 'Android platform 34'
    $zip = Join-Path $cache 'platform-34.zip'
    Get-File 'https://dl.google.com/android/repository/android-14_r04.zip' $zip
    $tmp = Join-Path $cache 'plat-unzip'
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $plat) | Out-Null
    if (Test-Path $plat) { Remove-Item -Recurse -Force $plat }
    Move-Item $inner.FullName $plat
    Remove-Item -Recurse -Force $tmp
}

# ----------------------------------------------------------------- 4. verify
$checks = @(
    @{ Name = 'javac';      Path = Join-Path $jdkDir 'bin\javac.exe' },
    @{ Name = 'aapt2';      Path = Join-Path $bt 'aapt2.exe' },
    @{ Name = 'd8';         Path = Join-Path $bt 'd8.bat' },
    @{ Name = 'apksigner';  Path = Join-Path $bt 'apksigner.bat' },
    @{ Name = 'zipalign';   Path = Join-Path $bt 'zipalign.exe' },
    @{ Name = 'android.jar';Path = Join-Path $plat 'android.jar' }
)
$missing = 0
foreach ($c in $checks) {
    $ok = Test-Path $c.Path
    if (-not $ok) { $missing++ }
    Write-Host ("  {0,-12} {1}" -f $c.Name, $(if ($ok) { 'ok' } else { 'MISSING' }))
}
if ($missing -gt 0) { throw "$missing component(s) missing" }

& (Join-Path $jdkDir 'bin\java.exe') -version 2>&1 | ForEach-Object { Write-Host "  $_" }
Write-Host ''
Write-Host 'Android toolchain ready. Next: node tools/build-apk.mjs'
