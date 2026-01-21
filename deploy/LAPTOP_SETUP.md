# Laptop setup (local backend in client mode + Sync now button)

Goal: each laptop runs its own local DB offline, and syncs to the VPS when online.

## 1) Configure local backend env

On each laptop, copy:

- `deploy/env/backend.client.env.example` → `backend/.env`

Then edit:

- `SYNC_REMOTE_URL=https://sync.yourdomain.com`
- `SYNC_DEVICE_TOKEN=...` (unique per laptop; created on VPS)

Optional:

- `SYNC_INTERVAL_MS=300000` (auto sync every 5 minutes)

## 2) Run local backend

From this repo:

- `cd backend`
- `npm install`
- `npm run dev`

## 3) Run local frontend (browser UI)

- `cd frontend`
- `npm install`
- `npm run dev`

Then open:

- `http://localhost:5173`

Note: in dev mode, Vite proxies `/api` to `http://localhost:4000` (see `frontend/vite.config.js`), so you usually do **not** need `VITE_API_BASE` on laptops.

### Optional: one command to start both

From the repo root:

- `./scripts/start-laptop-dev.sh`

## 4) Verify sync

After login, when the local backend is `SYNC_ROLE=client`, you should see a **Sync now** button.

If you want to validate via API:

- `GET http://localhost:4000/api/sync/status` (after login, with Bearer token)
- `POST http://localhost:4000/api/sync/run` (after login, with Bearer token)

Conflicts (admin only):

- `GET http://localhost:4000/api/sync/conflicts`

---

Note: the frontend talks to the **local** backend. The local backend talks to the VPS for syncing.
