@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title 精神空间 - 上传到 GitHub

rem ===========================================================================
rem  One-click publish. No install, no admin rights.
rem
rem  This machine reaches api.github.com reliably but github.com only
rem  intermittently, so the browser login (which talks to github.com) is
rem  unreliable here. The script therefore prefers a Personal Access Token and
rem  uploads through the REST API, which never touches github.com.
rem ===========================================================================

set "ROOT=%~dp0"
cd /d "%ROOT%"
set "PATH=%ROOT%.tools\git\cmd;%ROOT%.tools\bin;%PATH%"
set "GH_CONFIG_DIR=%APPDATA%\GitHub CLI"
set "REPO=novel-writer"
set "TOKENFILE=%ROOT%.tools\gh-token.txt"

where node >nul 2>nul || goto :nonode
where git  >nul 2>nul || goto :nogit

echo.
echo ============================================================
echo   精神空间 - 上传到 GitHub
echo ============================================================
echo.

rem --- token ---------------------------------------------------------------
if exist "%TOKENFILE%" (
  echo [1/3] 找到已保存的 token，直接使用。
) else (
  echo [1/3] 需要一个 GitHub Token（只存本地 .tools\gh-token.txt）。
  echo.
  echo       打开下面的地址，点 Generate new token ^(classic^)：
  echo         https://github.com/settings/tokens/new?scopes=repo^&description=mindspace
  echo       只勾选 repo 就够了，生成后把整串粘贴到下面。
  echo.
  set "T="
  set /p "T=       粘贴 token 后回车："
  if "!T!"=="" goto :notoken
  > "%TOKENFILE%" echo !T!
  set "T="
  echo       token 已保存。
)

rem --- publish -------------------------------------------------------------
echo.
echo [2/3] 通过 api.github.com 创建仓库并上传文件…
echo.
node "%ROOT%tools\publish-github.mjs"
if errorlevel 1 goto :failed

echo.
echo [3/3] 完成。
pause
exit /b 0

:notoken
echo.
echo [错误] 没有输入 token，已取消。
pause
exit /b 1
:nonode
echo [错误] 找不到 node.exe。请先安装 Node.js（https://nodejs.org），再重新双击本脚本。
pause
exit /b 1
:nogit
echo [错误] 找不到 .tools\git。请确认这个文件夹完整。
pause
exit /b 1
:failed
echo.
echo [错误] 上传没有完成，上面的信息会说明原因。
echo        本地仓库已经提交好，网络恢复后重跑本脚本即可。
pause
exit /b 1
