@echo off
title Writingway 2.0
color 0A

echo.
echo ================================
echo   Starting Writingway 2.0...
echo ================================
echo.

REM Check if llama.cpp server exists
if not exist "llama-server.exe" (
    echo [!] llama-server.exe not found!
    echo.
    echo Please download llama.cpp for Windows:
    echo 1. Go to: https://github.com/ggerganov/llama.cpp/releases
    echo 2. Download: llama-XXX-bin-win-cuda-cu12.2.0-x64.zip
    echo    ^(or the non-CUDA version if you don't have NVIDIA GPU^)
    echo 3. Extract llama-server.exe to this folder
    echo.
    echo Expected location: %CD%\llama-server.exe
    echo.
    pause
    exit /b 1
)

REM Check if model exists
if not exist "models\Qwen3-4B-Instruct-2507-IQ4_XS.gguf" (
    echo [!] Model file not found!
    echo.
    echo Expected location: %CD%\models\Qwen3-4B-Instruct-2507-IQ4_XS.gguf
    echo.
    pause
    exit /b 1
)

echo [OK] llama-server.exe found
echo [OK] Model file found
echo.

REM Check if Python is installed
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Python not found!
    echo.
    echo Please install Python from: https://www.python.org/downloads/
    echo Make sure to check "Add Python to PATH" during install
    echo.
    pause
    exit /b 1
)

echo [OK] Python found
echo.
echo ================================
echo   Starting AI Model Server...
echo ================================
echo.

REM Start llama.cpp server in background (keep window open with /k)
start "Writingway AI Server" cmd /k "llama-server.exe -m models\Qwen3-4B-Instruct-2507-IQ4_XS.gguf -c 4096 -ngl 999 --port 8080 --host 127.0.0.1"

echo [*] AI server starting on port 8080...
echo [*] Waiting for AI server to initialize...

REM Wait for llama server to be ready (check every second, max 30 seconds)
set /a counter=0
:wait_for_llama
timeout /t 1 /nobreak >nul
set /a counter+=1

REM Try to connect to the server
curl -s http://localhost:8080/health >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] AI server is ready!
    goto start_web
)

if %counter% lss 30 (
    echo     Still waiting... ^(%counter%/30^)
    goto wait_for_llama
)

echo [!] AI server took too long to start
echo [*] Continuing anyway - you can reload the page once server is ready
echo.

:start_web
echo.
echo ================================
echo   Starting Web Server...
echo ================================
echo.

REM Start Python HTTP server and open browser
echo [*] Starting web server on port 8000...
echo [*] Opening Writingway in 3 seconds...
echo.
echo ================================
echo   Writingway is starting!
echo ================================
echo.
echo PLEASE NOTE:
echo  * The browser window will appear in ~3 seconds
echo  * The page will show a loading screen while AI initializes
echo  * First startup may take 2-3 minutes for AI to load
echo  * Keep this window open while using Writingway
echo.
echo Web UI: http://localhost:8000/main.html
echo AI API: http://localhost:8080
echo.

REM Wait 3 seconds before opening browser (gives servers time to stabilize)
timeout /t 3 /nobreak >nul

echo [*] Opening browser now...
echo.
echo Close this window to stop both servers.
echo Press Ctrl+C to stop manually.
echo ================================
echo.

REM Open browser
start "" http://localhost:8000/main.html

REM Start Python web server (blocks here)
python -m http.server 8000

REM Cleanup when Python server stops
echo.
echo [*] Shutting down servers...
taskkill /FI "WindowTitle eq Writingway AI Server*" /T /F >nul 2>&1
echo [*] All servers stopped.
pause