@echo off
setlocal
cd /d %~dp0
set NODEDIR=%~dp0tools\node-v14.21.3-win-x64
if not exist "%NODEDIR%\node.exe" (
  echo Node 14 not found in %NODEDIR%
  echo Please copy tools\node-v14.21.3-win-x64 or install Node 14.
  pause
  exit /b 1
)
if not exist "frontend\dist\index.html" (
  echo Frontend build missing. Build it on a newer machine and copy the dist folder here.
  pause
  exit /b 1
)
"%NODEDIR%\node.exe" backend\src\server.js
