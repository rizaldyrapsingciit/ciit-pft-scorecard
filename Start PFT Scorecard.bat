@echo off
title CIIT PFT Scorecard System
cd /d "%~dp0"

echo ============================================================
echo   CIIT PFT Scorecard System
echo ============================================================
echo.
echo Starting the app... a browser window will open shortly.
echo.
echo IMPORTANT: Keep this black window OPEN while using the app.
echo Close this window when you are done to stop the app.
echo.

REM Open the browser after a short delay
start "" cmd /c "timeout /t 2 >nul & start http://localhost:8000"

REM Try Python launcher first, then plain python
py -m http.server 8000 2>nul || python -m http.server 8000

echo.
echo Could not start automatically. Please make sure Python is installed
echo from https://www.python.org/downloads/ (tick "Add Python to PATH").
pause
