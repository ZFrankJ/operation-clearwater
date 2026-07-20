@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to run CLEARWATER offline.
  echo Install the current Node.js LTS release, then try again.
  pause
  exit /b 1
)

start "CLEARWATER Local Server" cmd /k "cd /d ""%~dp0"" && node server.mjs"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:4173"

echo OPERATION CLEARWATER opened in your default browser.
echo Close the CLEARWATER Local Server window when you finish playing.
endlocal
