#!/usr/bin/env bash
set -euo pipefail

# Starts the local backend + frontend dev servers for a laptop.
# Prereq: set backend/.env from deploy/env/backend.client.env.example

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "Starting backend (http://localhost:4000) ..."
(
  cd "$ROOT_DIR/backend"
  npm install
  npm run dev
) &

echo "Starting frontend (http://localhost:5173) ..."
(
  cd "$ROOT_DIR/frontend"
  npm install
  npm run dev
)

