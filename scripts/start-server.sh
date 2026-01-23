#!/bin/bash

# OpenCode Headless Web Server - Auto-restart Script
# Listens on all interfaces (0.0.0.0) on port 5000

HOST="0.0.0.0"
PORT="5000"
RESTART_DELAY=2

echo "Starting OpenCode headless web server on $HOST:$PORT"
echo "Press Ctrl+C to stop"

while true; do
    echo "[$(date)] Starting server..."
    opencode serve --hostname "$HOST" --port "$PORT"
    EXIT_CODE=$?
    echo "[$(date)] Server exited with code $EXIT_CODE"
    echo "[$(date)] Restarting in $RESTART_DELAY seconds..."
    sleep $RESTART_DELAY
done
