# Deploy

- **env/** – Example `.env` files for backend (server and client).
- **nginx/** – Nginx config for the sync server.
- **systemd/** – systemd unit for the backend service.

## 401 Unauthorized on the server (e.g. garage.quantumlab.codes)

`/api/sync/status` and other `/api/*` routes require a valid login token by default. If the app is used without logging in (e.g. same UI as local “no login” mode), the server returns **401 Unauthorized**.

**Fix:** On the server (VPS), enable no-login mode so the API accepts requests without a Bearer token:

1. **Option A – .env**  
   In the **backend** directory create or edit `.env` and set:
   ```bash
   NO_LOGIN=true
   ```
   The backend loads `.env` from the backend directory (not from the process cwd), so it works even when started by systemd from another directory.

2. **Option B – systemd**  
   If you use the provided systemd unit, add to the `[Service]` section:
   ```ini
   Environment=NO_LOGIN=true
   ```
   (The example unit in `systemd/garage-backend.service` already includes this.)

3. Restart the backend (e.g. `sudo systemctl restart garage-backend`).

4. **Verify:** `curl https://garage.quantumlab.codes/api/health` should include `"noLogin": true`. Then `/api/sync/status` should return 200 without a token.

**If you want login on production:** Leave `NO_LOGIN` unset (or `false`). Then users must log in via `/api/auth/login`; the frontend must send the returned token in `Authorization: Bearer <token>` for all API requests.
