@echo off
REM Hamdan Garage Manager - Run as local website (Windows)
REM Double-click this file or create a shortcut to it.

title Hamdan Garage Manager

cd /d "%~dp0"

echo ========================================
echo  Hamdan Garage Manager (Website)
echo ========================================
echo.
echo Starting server... (first run may build the frontend)
echo.

REM Start server and open browser after a delay
start "" cmd /c "timeout /t 8 /nobreak > nul && start http://localhost:4000"

npm run website

echo.
echo App closed.
pause
