#!/usr/bin/env bash
# Start Garage Manager as a local website and open the browser.
# Run from project root, or use the .desktop / shortcut.

set -e
cd "$(dirname "$0")/.."
PROJECT_ROOT="$(pwd)"

echo "========================================"
echo "  Hamdan Garage Manager (Website)"
echo "========================================"
echo ""
echo "Starting server... (first run may build the frontend)"
echo ""

# Start server in background so we can wait for it and open browser
npm run website &
SERVER_PID=$!

# Wait for server to be ready (up to 60 seconds)
echo "Waiting for server at http://localhost:4000 ..."
for i in $(seq 1 60); do
  if curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/api/health 2>/dev/null | grep -q 200; then
    echo "Server is ready."
    break
  fi
  if ! kill -0 $SERVER_PID 2>/dev/null; then
    echo "Server process exited unexpectedly."
    exit 1
  fi
  sleep 1
done

# Open default browser (Linux)
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://localhost:4000"
elif command -v sensible-browser >/dev/null 2>&1; then
  sensible-browser "http://localhost:4000"
fi

echo ""
echo "App is running at: http://localhost:4000"
echo "Close this terminal to stop the server."
echo ""

# Bring server to foreground so terminal shows logs and Ctrl+C stops it
wait $SERVER_PID
