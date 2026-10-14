@echo off
setlocal
cd /d "%~dp0"
title PIXEL CARD Updater

echo ======================================
echo       PIXEL CARD - UPDATE ^& PLAY
echo ======================================
echo.

where git >nul 2>nul
if errorlevel 1 goto NOGIT

echo [1/2] 最新版を確認しています...
git pull --ff-only origin main
if errorlevel 1 goto PULLFAIL

echo.
echo [2/2] ゲームを起動します...
start "" "%~dp0index.html"
exit /b

:NOGIT
echo Git が見つかりません。
echo Git for Windows を一度インストールしてください。
echo 現在保存されているバージョンで起動します。
echo.
start "" "%~dp0index.html"
pause
exit /b

:PULLFAIL
echo.
echo 更新に失敗しました。
echo ネット接続、GitHubログイン、またはローカル変更を確認してください。
echo 現在保存されているバージョンを起動します。
echo.
start "" "%~dp0index.html"
pause
exit /b
