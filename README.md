# Hamdan Garage Manager (Web)

This repo now ships a web app version of the Garage Management System with a
React frontend and a Node/SQLite backend.

## Structure

- `frontend/` - React app that loads the existing Garage UI/logic and calls the API.
- `backend/` - Express API with SQLite storage and role-based permissions.
- `docs/` - Project plans and notes.

## Quick start (dev)

Backend:

```
cd backend
npm install
npm run dev
```

Frontend:

```
cd frontend
npm install
npm run dev
```

Then open `http://localhost:5173`.

## Production build

Build frontend:

```
./scripts/build-frontend.sh
```

Start backend:

```
./scripts/start-backend.sh
```

To point the frontend at a deployed API, set `VITE_API_BASE` in
`frontend/.env` before building.

## Import a legacy desktop database

If your friend is using the old Electron app, ask them for the SQLite file
`garage-db.db` (and close the app before copying).

Run:

```
cd backend
npm run import-legacy -- /path/to/garage-db.db
```

This imports the data collections. The web app auth users remain the defaults
unless you ask me to migrate legacy login accounts too.

## Default users

- `admin / 1234` (Main Admin)
- `saadeyat / stock123` (Saadeyat Stock)
- `viewer / viewer123` (Viewer)

## Environment variables

Backend (`backend/.env`):

- `PORT` (default: 4000)
- `DB_PATH` (default: `backend/data/garage.sqlite`)
- `CORS_ORIGIN` (default: `*`)
- `SYNC_ROLE` (`server` or `client`, default: `server`)
- `SYNC_REMOTE_URL` (client mode only, example: `https://sync.example.com`)
- `SYNC_DEVICE_TOKEN` (client mode only, from `/api/admin/devices`)
- `SYNC_INTERVAL_MS` (client mode only, set to `0` to disable auto sync)

Frontend (`frontend/.env`):

- `VITE_API_BASE` (optional, defaults to same origin; use full URL for deployed API)

## Sync (offline laptops)

Central server:

1. Run backend with `SYNC_ROLE=server` (default).
2. Create device tokens for each laptop using `POST /api/admin/devices` (admin login required).

Each laptop (local backend + local SQLite):

1. Set `SYNC_ROLE=client`, `SYNC_REMOTE_URL`, and `SYNC_DEVICE_TOKEN` in `backend/.env`.
2. (Optional) set `SYNC_INTERVAL_MS=300000` to auto-sync every 5 minutes.
3. Trigger a manual sync via `POST /api/sync/run` (admin login required).

Check status with `GET /api/sync/status` and conflicts with `GET /api/sync/conflicts`.

### Deployment templates

See [`deploy/README.md`](deploy/README.md) for:

- VPS templates (systemd, Nginx, backup script, env example)
- Laptop env example for client mode
