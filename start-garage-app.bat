@echo off
REM Garage Management System - Windows Startup Script
REM This script starts the frontend dev server and Electron app

title Garage Management System

echo ========================================
echo  Garage Management System
echo  Starting Application...
echo ========================================
echo.

REM Get the directory where this script is located
cd /d "%~dp0"

echo [1/3] Starting Frontend Dev Server...
echo.

REM Start frontend in a new window (minimized)
start "Garage Frontend" /min cmd /c "cd frontend && npm run dev"

echo [2/3] Waiting for frontend to start...
echo Please wait 10 seconds...
echo.

REM Wait for frontend to be ready
timeout /t 10 /nobreak > nul

echo [3/3] Starting Electron App...
echo.

REM Start Electron (this window stays open to show logs)
npm run electron:dev

REM If Electron closes, this will run
echo.
echo ========================================
echo  App Closed
echo ========================================
pause
