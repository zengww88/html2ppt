@echo off
setlocal

cd /d "%~dp0visual-html-ppt-editor"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is required.
  echo Please install the LTS version from https://nodejs.org/
  echo Then double-click this file again.
  echo.
  pause
  exit /b 1
)

if not exist node_modules\.bin (
  echo Installing dependencies. This runs only the first time...
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo.
echo Starting Visual HTML PPT Editor...
echo Please wait for the server to start...
echo.

start "" cmd /c "npm run dev"

:wait_loop
timeout /t 2 /nobreak >nul
curl.exe -s http://127.0.0.1:5173 >nul 2>nul
if errorlevel 1 goto wait_loop

echo Server is ready!
echo Opening browser at http://127.0.0.1:5173
echo Keep this window open while using the editor.
echo.

start "" "http://127.0.0.1:5173"

pause
