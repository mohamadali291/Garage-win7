#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR/frontend"

npm install
npm run build

echo "Frontend build complete: $ROOT_DIR/frontend/dist"
