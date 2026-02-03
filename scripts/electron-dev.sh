#!/usr/bin/env bash
set -euo pipefail

# Development script for Electron app
# This script starts the frontend dev server and launches Electron

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "=== Starting Electron Development Mode ==="
echo "Root directory: $ROOT_DIR"
echo ""

# Function to cleanup background processes on exit
cleanup() {
  echo ""
  echo "=== Cleaning up processes ==="
  if [ -n "${FRONTEND_PID:-}" ]; then
    echo "Stopping frontend dev server (PID: $FRONTEND_PID)..."
    kill $FRONTEND_PID 2>/dev/null || true
  fi
  exit 0
}

trap cleanup SIGINT SIGTERM EXIT

# Check if frontend node_modules exists
if [ ! -d "$ROOT_DIR/frontend/node_modules" ]; then
  echo "Frontend dependencies not installed. Installing..."
  cd "$ROOT_DIR/frontend"
  npm install
  cd "$ROOT_DIR"
fi

# Check if backend node_modules exists
if [ ! -d "$ROOT_DIR/backend/node_modules" ]; then
  echo "Backend dependencies not installed. Installing..."
  cd "$ROOT_DIR/backend"
  npm install
  cd "$ROOT_DIR"
fi

# Start frontend dev server in background
echo "Starting frontend dev server (Vite)..."
cd "$ROOT_DIR/frontend"
npm run dev &
FRONTEND_PID=$!
cd "$ROOT_DIR"

echo "Frontend dev server started (PID: $FRONTEND_PID)"
echo "Waiting for frontend to be ready..."

# Wait for frontend dev server to be ready
MAX_WAIT=30
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
  if curl -s http://localhost:5173 > /dev/null 2>&1; then
    echo "Frontend dev server is ready!"
    break
  fi
  sleep 1
  WAITED=$((WAITED + 1))
  if [ $((WAITED % 5)) -eq 0 ]; then
    echo "Still waiting... ($WAITED/$MAX_WAIT seconds)"
  fi
done

if [ $WAITED -ge $MAX_WAIT ]; then
  echo "ERROR: Frontend dev server failed to start within $MAX_WAIT seconds"
  exit 1
fi

echo ""
echo "=== Launching Electron ==="
echo ""

# Launch Electron (backend will be started by Electron)
NODE_ENV=development npm start

# Cleanup happens automatically via trap
