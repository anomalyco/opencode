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

# Check if API is running
check_api() {
  curl -s http://localhost:12345/health > /dev/null 2>&1
  return $?
}

# Start OpenCode API
start_api() {
  echo -e "${BLUE}[API]${NC} Starting OpenCode API..."
  if command -v opencode &> /dev/null; then
    opencode dev &
    API_PID=$!
    echo -e "${BLUE}[API]${NC} Started (PID: $API_PID)"
  else
    echo -e "${RED}[API]${NC} opencode CLI not found. Install with: npm install -g @opencode-ai/cli"
    exit 1
  fi
}

# Start Web Frontend
start_web() {
  if [ -d "../web" ]; then
    echo -e "${GREEN}[WEB]${NC} Starting web frontend..."
    cd ../web && npm run dev &
    WEB_PID=$!
    cd - > /dev/null
    echo -e "${GREEN}[WEB]${NC} Started (PID: $WEB_PID)"
  else
    echo -e "${YELLOW}[WEB]${NC} Web package not found, skipping..."
  fi
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
  [ ! -z "$API_PID" ] && kill $API_PID 2>/dev/null && echo -e "${BLUE}[API]${NC} Stopped"
  [ ! -z "$WEB_PID" ] && kill $WEB_PID 2>/dev/null && echo -e "${GREEN}[WEB]${NC} Stopped"
  [ ! -z "$DESKTOP_PID" ] && kill $DESKTOP_PID 2>/dev/null && echo -e "${YELLOW}[DESKTOP]${NC} Stopped"
  exit 0
}

trap cleanup INT TERM

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  OpenCode Development Environment${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Check if API is already running
if check_api; then
  echo -e "${BLUE}[API]${NC} Already running ✓"
else
  start_api
  sleep 2
fi

# Start other services
start_desktop

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  All services started!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "Desktop:  ${YELLOW}http://localhost:3000${NC}"
echo -e "API:      ${BLUE}http://localhost:12345${NC}"
echo ""
echo -e "Press ${RED}Ctrl+C${NC} to stop all services"
echo ""

# Wait for all background processes
wait
