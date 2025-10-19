#!/bin/bash

# Tauri Development Launcher
# Starts Backend then Vite for Tauri

set -e

# Colors
BLUE='\033[0;34m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# Check if Backend is running
check_backend() {
  curl -s http://127.0.0.1:4096 > /dev/null 2>&1
  return $?
}

# Start OpenCode Backend Server
start_backend() {
  export OPENCODE_PORT=4096
  echo -e "${BLUE}[BACKEND]${NC} Starting OpenCode backend server on 127.0.0.1:4096..."
  if command -v opencode &> /dev/null; then
    opencode serve -p 4096 -h 127.0.0.1 &
    BACKEND_PID=$!
    echo -e "${BLUE}[BACKEND]${NC} Started (PID: $BACKEND_PID)"
    sleep 3
  else
    echo -e "${GREEN}[BACKEND]${NC} opencode CLI not found - Tauri will run without backend"
  fi
}

# Cleanup on exit
cleanup() {
  [ ! -z "$BACKEND_PID" ] && kill $BACKEND_PID 2>/dev/null && echo -e "${BLUE}[BACKEND]${NC} Stopped"
  exit 0
}

trap cleanup INT TERM

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  OpenCode Tauri Development${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Start backend server if not already running
if check_backend; then
  echo -e "${BLUE}[BACKEND]${NC} Already running ✓"
else
  start_backend
fi

echo -e "${GREEN}[VITE]${NC} Starting Vite dev server..."
echo ""

# Start Vite (Tauri will handle this)
exec bun dev
