@echo off
setlocal enabledelayedexpansion
title Writingway 2.0
color 0A

echo.
echo ================================
echo   Starting Writingway 2.0...
echo ================================
echo.

REM ========================================
REM  SECTION 1: Apply Staged Update
REM ========================================
if not exist ".update\ready.json" goto update_done

echo [*] Staged update detected! Applying update...
echo.

REM Check if zip exists
if not exist ".update\latest.zip" (
    echo [!] Update zip not found. Cleaning up...
    del /q ".update\ready.json" 2>nul
    goto update_done
)

REM Create extract directory
if exist ".update\extract" rmdir /s /q ".update\extract"
mkdir ".update\extract"

REM Unzip using PowerShell Expand-Archive
echo [*] Extracting update...
powershell -NoProfile -Command "Expand-Archive -Path '.update\latest.zip' -DestinationPath '.update\extract' -Force"
if %errorlevel% neq 0 (
    echo [!] Failed to extract update. Cleaning up...
    del /q ".update\ready.json" 2>nul
    del /q ".update\latest.zip" 2>nul
    rmdir /s /q ".update\extract" 2>nul
    goto update_done
)

REM Detect the root folder inside the extracted zip
REM GitHub archives create a folder like "Writingway2-main"
set "EXTRACTED_ROOT="
for /d %%d in (".update\extract\*") do (
    set "EXTRACTED_ROOT=%%d"
    goto found_root
)

:found_root
if "!EXTRACTED_ROOT!"=="" (
    echo [!] Could not find extracted folder. Cleaning up...
    del /q ".update\ready.json" 2>nul
    del /q ".update\latest.zip" 2>nul
    rmdir /s /q ".update\extract" 2>nul
    goto update_done
)

echo [*] Found update root: !EXTRACTED_ROOT!
echo [*] Copying files with exclusions...

REM Copy files using robocopy with exclusions
REM Exclude: .update, .git, projects, backups, models, llama, node_modules, .vscode, .idea, .continue, .claude
REM Also exclude start.bat for safety (user can manually update if needed)
robocopy "!EXTRACTED_ROOT!" "." /E /XD ".update" ".git" "projects" "backups" "models" "llama" "node_modules" ".vscode" ".idea" ".continue" ".claude" /XF "start.bat" /NFL /NDL /NJH /NJS /NC /NS /NP

REM Robocopy returns various codes (0-7 are success, 8+ are errors)
if %errorlevel% geq 8 (
    echo [!] Warning: Some files may not have copied correctly.
) else (
    echo [OK] Update applied successfully!
)

REM Cleanup update files
echo [*] Cleaning up update files...
del /q ".update\ready.json" 2>nul
del /q ".update\latest.zip" 2>nul
rmdir /s /q ".update\extract" 2>nul

echo.
echo ================================
echo   Update Complete!
echo ================================
echo.

:update_done

REM ========================================
REM  SECTION 2: Check llama.cpp server
REM ========================================
if not exist "llama\llama-server.exe" (
    echo [!] llama-server.exe not found!
    echo.
    echo Please download llama.cpp for Windows:
    echo 1. Go to: https://github.com/ggerganov/llama.cpp/releases
    echo 2. Download: llama-XXX-bin-win-cuda-cu12.2.0-x64.zip
    echo    ^(or the non-CUDA version if you don't have NVIDIA GPU^)
    echo 3. Create a "llama" folder and extract all files there
    echo.
    echo Expected location: %CD%\llama\llama-server.exe
    echo.
    pause
    exit /b 1
)

REM ========================================
REM  SECTION 3: Check Python
REM ========================================
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

REM ========================================
REM  SECTION 4: Check for model files
REM ========================================
if not exist "models" mkdir models

REM Check for any .gguf model files - try to find first one
set "MODEL_FOUND=0"
set "MODEL_PATH="
for /f "delims=" %%f in ('dir /b models\*.gguf 2^>nul') do (
    set "MODEL_FOUND=1"
    set "MODEL_PATH=models\%%f"
    goto model_check_done
)

:model_check_done
if "!MODEL_FOUND!"=="1" (
    echo [OK] Model file found: !MODEL_PATH!
    echo [OK] llama-server.exe found
    goto start_ai_server
)

echo [*] No .gguf files found in models folder
echo [!] No model files found in models\ folder
echo.
echo You can either:
echo 1. Download a model and place it in the models\ folder
echo 2. Start anyway and configure API mode ^(Claude, OpenRouter, etc.^)
echo.
echo Recommended models:
echo  - Qwen2.5-3B-Instruct (2.5GB, fast)
echo  - Qwen2.5-7B-Instruct (5GB, better quality)
echo  - Download from: https://huggingface.co/models?search=gguf
echo.
choice /C YN /M "Start without local model"
if errorlevel 2 exit /b 1
echo.
echo [*] Starting without local AI - you can use API mode
goto start_web

:start_ai_server
echo.
echo ================================
echo   Starting AI Model Server...
echo ================================
echo.

echo [*] Using model: !MODEL_PATH!
echo.

REM Start llama.cpp server in background (keep window open with /k)
REM Using -c 0 to automatically use the model's maximum context size
start "Writingway AI Server" cmd /k "llama\llama-server.exe -m "!MODEL_PATH!" -c 0 -ngl 999 --port 8080 --host 127.0.0.1"

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
echo   Starting Updater Service...
echo ================================
echo.

REM Start the updater server in background (minimized)
start /min "Writingway Updater" cmd /c "python tools\updater-server.py"
echo [OK] Updater service started on port 8001
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
echo Updater: http://localhost:8001
echo.

REM Wait 3 seconds before opening browser (gives servers time to stabilize)
timeout /t 3 /nobreak >nul

echo [*] Opening browser now...
echo.
echo Close this window to stop all servers.
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
taskkill /FI "WindowTitle eq Writingway Updater*" /T /F >nul 2>&1
echo [*] All servers stopped.
pause
