@echo off
cd /d "%~dp0"

echo AI Foreign Object Dataset Generator
echo ===================================

echo [1/3] Killing old server...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8080.*LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul

echo [2/3] Building frontend...
cd frontend
call npm install --silent 2>nul
call npx vite build
cd ..

echo [3/3] Starting server...
echo.
echo   Server: http://127.0.0.1:8080
echo   Press Ctrl+C to stop
echo.

start "" http://127.0.0.1:8080
cd backend
python main.py
