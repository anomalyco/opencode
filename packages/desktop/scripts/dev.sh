#!/bin/bash

# OpenCode Desktop Development Launcher
# Starts API, Web, and Desktop app

set -e

# Colors
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if Backend is running
check_backend() {
  curl -s http://localhost:12345 > /dev/null 2>&1
  return $?
}

# Start OpenCode Backend Server
start_backend() {
  echo -e "${BLUE}[BACKEND]${NC} Starting OpenCode backend server..."
  if command -v opencode &> /dev/null; then
    opencode serve &
    BACKEND_PID=$!
    echo -e "${BLUE}[BACKEND]${NC} Started (PID: $BACKEND_PID)"
  else
    echo -e "${RED}[BACKEND]${NC} opencode CLI not found. Install with: npm install -g @opencode-ai/cli"
    exit 1
  fi
}

# Start Web Frontend
start_web() {
  echo -e "${GREEN}[WEB]${NC} Starting web frontend..."
  # Web frontend is served by the desktop app's Vite dev server
  # This will be available at the desktop app's URL
  echo -e "${GREEN}[WEB]${NC} Web frontend will be served by desktop app"
}

# Start Desktop
start_desktop() {
  echo -e "${YELLOW}[DESKTOP]${NC} Starting desktop app..."
  npm run dev &
  DESKTOP_PID=$!
  echo -e "${YELLOW}[DESKTOP]${NC} Started (PID: $DESKTOP_PID)"
}

# Cleanup on exit
cleanup() {
  echo ""
  echo -e "${RED}Shutting down...${NC}"
  [ ! -z "$BACKEND_PID" ] && kill $BACKEND_PID 2>/dev/null && echo -e "${BLUE}[BACKEND]${NC} Stopped"
  [ ! -z "$DESKTOP_PID" ] && kill $DESKTOP_PID 2>/dev/null && echo -e "${YELLOW}[DESKTOP]${NC} Stopped"
  exit 0
}

trap cleanup INT TERM

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  OpenCode Development Environment${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Start in correct order: Native Desktop > Web > Backend
start_desktop
sleep 3

# Start backend server
if check_backend; then
  echo -e "${BLUE}[BACKEND]${NC} Already running ✓"
else
  start_backend
  sleep 2
fi

# Web frontend is served by desktop app
start_web

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  All services started!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "Desktop (with Web): ${YELLOW}Native App Window${NC}"
echo -e "Backend:            ${BLUE}opencode serve${NC}"
echo ""
echo -e "Press ${RED}Ctrl+C${NC} to stop all services"
echo ""

# Wait for all background processes
wait
