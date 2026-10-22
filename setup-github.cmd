@echo off
setlocal EnableExtensions
chcp 65001 >nul
title 精神空间 - 上传到 GitHub

rem ---------------------------------------------------------------------------
rem  One-click publish. Everything it needs is inside .tools\ , so there is no
rem  system-wide install and nothing to configure by hand:
rem    - PortableGit 2.56 (git.exe)
rem    - GitHub CLI 2.103 (gh.exe)  -> handles the browser login and repo create
rem  The only thing it asks for is the GitHub login, which happens in your own
rem  browser. Nothing is stored by this script; gh keeps its token in its own
rem  config directory.
rem ---------------------------------------------------------------------------

set "ROOT=%~dp0"
cd /d "%ROOT%"

set "PATH=%ROOT%.tools\git\cmd;%ROOT%.tools\bin;%PATH%"
set "GH_CONFIG_DIR=%APPDATA%\GitHub CLI"

where git >nul 2>nul || goto :nogit
where gh  >nul 2>nul || goto :nogit

echo.
echo ============================================================
echo   精神空间 - 上传到 GitHub
echo ============================================================
echo.

rem --- 1. login -------------------------------------------------------------
gh auth status >nul 2>nul
if errorlevel 1 (
  echo [1/4] 需要先登录 GitHub。接下来会打开浏览器，按提示输入一次性代码即可。
  echo        ^(只需登录一次，之后会记住^)
  echo.
  gh auth login --hostname github.com --git-protocol https --web
  if errorlevel 1 goto :loginfailed
) else (
  echo [1/4] 已登录 GitHub。
)
echo.

rem --- 2. identity ----------------------------------------------------------
set "GHUSER="
for /f "delims=" %%u in ('gh api user --jq .login 2^>nul') do set "GHUSER=%%u"
if "%GHUSER%"=="" goto :nouser
echo [2/4] 账号：%GHUSER%

git config user.name  >nul 2>nul || git config user.name  "%GHUSER%"
git config user.email >nul 2>nul || git config user.email "%GHUSER%@users.noreply.github.com"

rem --- 3. repo --------------------------------------------------------------
if not exist ".git" (
  git init -b main >nul || goto :gitfailed
  echo [3/4] 已初始化本地仓库。
) else (
  echo [3/4] 本地仓库已存在。
)

git add -A || goto :gitfailed
git commit -m "精神空间 v1.2.0" >nul 2>nul
git branch -M main

set "REPO=novel-writer"
gh repo view "%GHUSER%/%REPO%" >nul 2>nul
if errorlevel 1 (
  gh repo create "%REPO%" --public --source=. --remote=origin --description "精神空间 - DeepSeek Harness 小说写作插件" --push || goto :pushfailed
) else (
  git remote get-url origin >nul 2>nul || git remote add origin "https://github.com/%GHUSER%/%REPO%.git"
  git push -u origin main || goto :pushfailed
)

echo.
echo ============================================================
echo   完成！仓库地址：
echo   https://github.com/%GHUSER%/%REPO%
echo ============================================================
echo.
pause
exit /b 0

:nogit
echo [错误] 找不到 .tools 里的 git / gh。请确认这个文件夹完整。
pause
exit /b 1
:loginfailed
echo [错误] 登录没有完成。
pause
exit /b 1
:nouser
echo [错误] 读不到 GitHub 账号名，请重试。
pause
exit /b 1
:gitfailed
echo [错误] git 操作失败，请把上面的信息发给我。
pause
exit /b 1
:pushfailed
echo [错误] 推送失败。常见原因：仓库名已被占用，或网络不通。
pause
exit /b 1