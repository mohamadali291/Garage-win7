#!/usr/bin/env bash
set -euo pipefail

# Builds the frontend for "local website" usage.
# Output is static files in frontend/dist, but API calls will go to the local backend.
#
# Assumes your local backend is running at http://localhost:4000
# and has CORS enabled (default CORS_ORIGIN=* in backend/.env examples).

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR/frontend"

export VITE_API_BASE="http://localhost:4000"

npm install
npm run build

echo "Frontend build complete: $ROOT_DIR/frontend/dist"
echo "To preview locally: cd \"$ROOT_DIR/frontend\" && npm run preview"

