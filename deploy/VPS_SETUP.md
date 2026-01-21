# VPS setup (central sync server, SQLite)

Assumptions:
- Ubuntu VPS
- Domain like `sync.yourdomain.com`
- You will run the backend on `127.0.0.1:4000` and put Nginx in front for HTTPS.

## 1) Install prerequisites

- Node.js LTS
- Nginx
- Certbot for Nginx

## 2) Deploy backend code

Copy the repo's `backend/` folder to the VPS, e.g.:

- `/opt/garage-backend`

Install deps:

- `cd /opt/garage-backend && npm install`

## 3) Create persistent SQLite location

Create a folder and allow the service user to write:

- DB path: `/var/lib/garage/garage.sqlite`
- Folder: `/var/lib/garage`

## 4) Configure systemd service

Use the template:

- `deploy/systemd/garage-backend.service`

Adjust these lines to match your VPS:

- `WorkingDirectory=/opt/garage-backend`
- `ExecStart=/usr/bin/node /opt/garage-backend/src/server.js`
- `User=` / `Group=`
- `DB_PATH=/var/lib/garage/garage.sqlite`

Then:

- `sudo systemctl daemon-reload`
- `sudo systemctl enable --now garage-backend`
- `sudo systemctl status garage-backend`

## 5) Configure Nginx reverse proxy + HTTPS

Use the template:

- `deploy/nginx/garage-sync.conf`

Enable it as a site, then obtain TLS certs via certbot for your domain.

## 6) Create device tokens (one per laptop)

1. Login as admin to get a session token:

```bash
curl -sS -X POST 'https://sync.yourdomain.com/api/auth/login' \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"1234"}'
```

2. Use the returned `token` to create a device token:

```bash
curl -sS -X POST 'https://sync.yourdomain.com/api/admin/devices' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_ADMIN_TOKEN' \
  -d '{"label":"laptop-1"}'
```

This returns `{ "deviceId": "...", "deviceToken": "..." }`.

## 7) Backups

Use:

- `deploy/backup/backup-garage-sqlite.sh`

Recommended: run daily (cron/systemd timer) and retain 7–14 days.

