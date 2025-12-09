#!/bin/bash

# Writingway 2.0 Startup Script for Mac/Linux
# This script starts the local AI server and web server

echo ""
echo "================================"
echo "  Starting Writingway 2.0..."
echo "================================"
echo ""

# Check if llama-server exists (in llama subfolder)
if [ ! -f "./llama/llama-server" ]; then
    echo "[!] llama-server not found!"
    echo ""
    echo "Please download llama.cpp for your system:"
    echo "1. Go to: https://github.com/ggerganov/llama.cpp/releases"
    echo "2. For Mac: Download llama-XXX-bin-macos-arm64.zip (Apple Silicon)"
    echo "            or llama-XXX-bin-macos-x64.zip (Intel Mac)"
    echo "   For Linux: Download llama-XXX-bin-ubuntu-x64.zip"
    echo "3. Create a 'llama' folder and extract all files there"
    echo ""
    echo "Expected location: $(pwd)/llama/llama-server"
    echo ""
    read -p "Press Enter to exit..."
    exit 1
fi

# Make llama-server executable
chmod +x ./llama/llama-server

# Check if models folder exists
if [ ! -d "models" ]; then
    mkdir models
fi

# Check for any .gguf model files
MODEL_FOUND=0
MODEL_PATH=""

for file in models/*.gguf; do
    if [ -f "$file" ]; then
        MODEL_FOUND=1
        MODEL_PATH="$file"
        break
    fi
done

if [ $MODEL_FOUND -eq 0 ]; then
    echo "[!] No model files found in models/ folder"
    echo ""
    echo "You can either:"
    echo "1. Download a model and place it in the models/ folder"
    echo "2. Start anyway and configure API mode (Claude, OpenRouter, etc.)"
    echo ""
    echo "Recommended models:"
    echo "  - Qwen2.5-3B-Instruct (2.5GB, fast)"
    echo "  - Qwen2.5-7B-Instruct (5GB, better quality)"
    echo "  - Download from: https://huggingface.co/models?search=gguf"
    echo ""
    read -p "Start without local model? [y/N]: " choice
    if [[ ! $choice =~ ^[Yy]$ ]]; then
        exit 1
    fi
    echo ""
    echo "[*] Starting without local AI - you can use API mode"
    SKIP_MODEL=1
else
    echo "[OK] llama-server found"
    echo "[OK] Model file found: $MODEL_PATH"
    echo ""
    SKIP_MODEL=0
fi

# Check if Python 3 is installed
if ! command -v python3 &> /dev/null; then
    echo "[!] Python 3 not found!"
    echo ""
    echo "Please install Python 3:"
    echo "  Mac: brew install python3"
    echo "  Linux: sudo apt install python3"
    echo ""
    read -p "Press Enter to exit..."
    exit 1
fi

echo "[OK] Python 3 found"
echo ""

# Start AI server if we have a model
if [ $SKIP_MODEL -eq 0 ]; then
    echo "================================"
    echo "   Starting AI Model Server..."
    echo "================================"
    echo ""
    echo "[*] Using model: $MODEL_PATH"
    echo ""
    
    # Start llama-server in background
    # For Mac: Use Metal GPU acceleration (-ngl 999)
    # For Linux: Use CUDA if available, otherwise CPU
    # Using -c 0 to automatically use the model's maximum context size
    ./llama/llama-server -m "$MODEL_PATH" -c 0 -ngl 999 --port 8080 --host 127.0.0.1 > llama-server.log 2>&1 &
    LLAMA_PID=$!
    
    echo "[*] AI server starting on port 8080 (PID: $LLAMA_PID)..."
    echo "[*] Waiting for AI server to initialize..."
    
    # Wait for llama-server to be ready (max 30 seconds)
    counter=0
    while [ $counter -lt 30 ]; do
        sleep 1
        counter=$((counter + 1))
        
        # Try to connect to the server
        if curl -s http://localhost:8080/health > /dev/null 2>&1; then
            echo "[OK] AI server is ready!"
            break
        fi
        
        if [ $counter -lt 30 ]; then
            echo "    Still waiting... ($counter/30)"
        fi
    done
    
    if [ $counter -eq 30 ]; then
        echo "[!] AI server took too long to start"
        echo "[*] Check llama-server.log for errors"
        echo "[*] Continuing anyway - you can reload the page once server is ready"
    fi
    echo ""
fi

echo ""
echo "================================"
echo "   Starting Web Server..."
echo "================================"
echo ""

echo "[*] Starting web server on port 8000..."
echo "[*] Opening Writingway in 3 seconds..."
echo ""
echo "================================"
echo "   Writingway is starting!"
echo "================================"
echo ""
echo "PLEASE NOTE:"
echo "  * The browser window will appear in ~3 seconds"
echo "  * The page will show a loading screen while AI initializes"
echo "  * First startup may take 2-3 minutes for AI to load"
echo "  * Keep this terminal open while using Writingway"
echo ""
echo "Web UI: http://localhost:8000/main.html"
echo "AI API: http://localhost:8080"
echo ""

# Wait 3 seconds before opening browser
sleep 3

echo "[*] Opening browser now..."
echo ""
echo "Press Ctrl+C to stop all servers."
echo "================================"
echo ""

# Open browser (works on Mac and most Linux)
if command -v open &> /dev/null; then
    # macOS
    open "http://localhost:8000/main.html"
elif command -v xdg-open &> /dev/null; then
    # Linux
    xdg-open "http://localhost:8000/main.html" &
fi

# Start Python web server (this blocks)
python3 -m http.server 8000

# Cleanup when Python server stops
echo ""
echo "[*] Shutting down servers..."
if [ ! -z "$LLAMA_PID" ]; then
    kill $LLAMA_PID 2>/dev/null
fi
echo "[*] All servers stopped."
