@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title 精神空间 - 上传到 GitHub

rem ===========================================================================
rem  One-click publish for 精神空间 (novel-writer).
rem
rem  Everything it needs lives in .tools\ , so nothing is installed system-wide:
rem    - PortableGit 2.56   (git.exe)
rem    - GitHub CLI 2.103   (gh.exe) -> browser login + repo creation + push
rem
rem  The only manual step is the GitHub login, which happens in your browser.
rem  If the browser login cannot reach GitHub (this machine's connection to
rem  github.com is intermittent), the script falls back to pasting a token.
rem ===========================================================================

set "ROOT=%~dp0"
cd /d "%ROOT%"

set "PATH=%ROOT%.tools\git\cmd;%ROOT%.tools\bin;%PATH%"
set "GH_CONFIG_DIR=%APPDATA%\GitHub CLI"
set "REPO=novel-writer"

where git >nul 2>nul || goto :nogit
where gh  >nul 2>nul || goto :nogit

echo.
echo ============================================================
echo   精神空间 - 上传到 GitHub
echo ============================================================
echo.

rem --- 1. login -------------------------------------------------------------
gh auth status >nul 2>nul
if not errorlevel 1 goto :loggedin

echo [1/4] 需要登录 GitHub（只需一次）。
echo.
echo       方式 A：浏览器登录（推荐）——会显示一个 8 位代码，粘贴到网页即可。
echo       方式 B：粘贴 Personal Access Token（浏览器打不开时用这个）
echo.
choice /c AB /n /m "       选 A 或 B："
if errorlevel 2 goto :tokenlogin

:weblogin
echo.
echo       正在打开浏览器… 如果窗口没弹出，把下面显示的代码手动打开
echo       https://github.com/login/device 粘贴进去。
echo.
gh auth login --hostname github.com --git-protocol https --web
if not errorlevel 1 goto :loggedin

echo.
echo       [提示] 浏览器登录没成功（多半是连不上 github.com）。
echo.
choice /c YN /n /m "       改用 Token 登录？(Y/N) "
if errorlevel 2 goto :loginfailed
goto :tokenlogin

:tokenlogin
echo.
echo       在浏览器打开 https://github.com/settings/tokens
echo       点 Generate new token (classic)，勾选 repo 和 read:user，
echo       生成后把整串 token 粘贴到下面（输入时不显示）。
echo.
set "GHTOKEN="
set /p "GHTOKEN=       粘贴 token 后按回车："
if "!GHTOKEN!"=="" goto :loginfailed
echo !GHTOKEN! | gh auth login --hostname github.com --git-protocol https --with-token
if errorlevel 1 (
  echo.
  echo       [错误] token 无效或网络不通。
  goto :loginfailed
)
set "GHTOKEN="

:loggedin
echo.
echo [1/4] 已登录。

rem --- 2. identity ----------------------------------------------------------
set "GHUSER="
for /f "delims=" %%u in ('gh api user --jq .login 2^>nul') do set "GHUSER=%%u"
if "%GHUSER%"=="" goto :nouser
echo [2/4] 账号：%GHUSER%

git config user.name  >nul 2>nul || git config user.name  "%GHUSER%"
git config user.email >nul 2>nul || git config user.email "%GHUSER%@users.noreply.github.com"

rem --- 3. commit ------------------------------------------------------------
if not exist ".git" (
  git init -b main >nul || goto :gitfailed
  echo [3/4] 已初始化本地仓库。
) else (
  echo [3/4] 本地仓库已存在。
)
git add -A || goto :gitfailed
git commit -m "精神空间 v1.2.0" >nul 2>nul
git branch -M main

rem --- 4. create + push -----------------------------------------------------
echo [4/4] 创建远端仓库并推送…
gh repo view "%GHUSER%/%REPO%" >nul 2>nul
if errorlevel 1 (
  gh repo create "%REPO%" --public --source=. --remote=origin --description "精神空间 - DeepSeek Harness 小说写作插件" --push
  if errorlevel 1 goto :pushfailed
) else (
  git remote get-url origin >nul 2>nul || git remote add origin "https://github.com/%GHUSER%/%REPO%.git"
  git push -u origin main
  if errorlevel 1 goto :pushfailed
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
echo.
echo [错误] 登录没有完成。可以稍后重跑本脚本，或用 GitHub 网页手动上传。
pause
exit /b 1
:nouser
echo [错误] 读不到 GitHub 账号名（网络问题）。请稍后重跑。
pause
exit /b 1
:gitfailed
echo [错误] git 操作失败，请把上面的信息发给我。
pause
exit /b 1
:pushfailed
echo.
echo [错误] 推送失败。常见原因：
echo         - 网络连不上 github.com（稍后重跑即可，本地提交已保存）
echo         - 仓库名 novel-writer 已被别人占用
pause
exit /b 1