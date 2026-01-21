# Deployment (VPS + laptops)

This repo is designed to run:

- **VPS (central sync server)**: `backend/` in `SYNC_ROLE=server` (default), with a persistent SQLite file.
- **Each laptop (offline-first)**: `backend/` in `SYNC_ROLE=client` using its own local SQLite, syncing to the VPS over HTTPS.

This folder contains **templates** for a typical Ubuntu VPS setup using **systemd + Nginx + Let's Encrypt**.

## Files

- `deploy/systemd/garage-backend.service`: systemd unit template for the backend
- `deploy/nginx/garage-sync.conf`: Nginx site template for HTTPS reverse proxy
- `deploy/backup/backup-garage-sqlite.sh`: simple daily backup script for SQLite
- `deploy/env/backend.server.env.example`: example env for VPS (server)
- `deploy/env/backend.client.env.example`: example env for laptops (client)

## VPS quick setup (high level)

1. Copy `backend/` to your VPS (example destination: `/opt/garage-backend`).
2. Create a persistent DB folder:
   - `/var/lib/garage` (owned by the systemd user, e.g. `www-data`).
3. Configure systemd:
   - Start from `deploy/systemd/garage-backend.service` and adjust paths/user.
4. Configure Nginx:
   - Start from `deploy/nginx/garage-sync.conf` and set `server_name`.
   - Add HTTPS via certbot (Let’s Encrypt).
5. Add backups:
   - Use `deploy/backup/backup-garage-sqlite.sh` daily into `/var/backups/garage`.

Detailed step-by-step guides:
- `deploy/VPS_SETUP.md`
- `deploy/LAPTOP_SETUP.md`

