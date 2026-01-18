# Sync Plan (Server -> Test -> Link Laptops)

Goal: Multiple laptops work offline with SQLite, then sync online through an HTTPS API, with real conflicts and a conflict UI.

## Phase 0 - Roles and access (no SSH sharing)

- [ ] Friend (server admin) keeps SSH/sudo access and deploys and maintains the server.
- [ ] Laptops use HTTPS API only; no SSH required.
- [ ] Friend provides `API_BASE_URL` (example: `https://sync.domain.com`).
- [ ] Friend provides a way to create device tokens (admin endpoint or admin panel).
- [ ] Friend provides a test device token for the first laptop.

## Phase 1 - Server foundation (friend does this first)

### 1.1 Isolate the project

- [ ] Create a dedicated folder and service name for "garage-sync".
- [ ] Do not touch existing hosted websites.

### 1.2 Postgres (private)

- [ ] Postgres is localhost-only (not exposed to the internet).
- [ ] Create a dedicated DB and user for the sync project.

### 1.3 Data model (must support conflicts)

- [ ] Create `records` table (canonical latest state):
  - [ ] `tableName`, `recordId`, `data`, `version`, `updatedAt`, `updatedBy`, `deletedAt`.
- [ ] Create `sync_ops` table (idempotency/log):
  - [ ] Ensure `opId` cannot be applied twice.
- [ ] Create `devices` table (multi-laptop tokens):
  - [ ] `deviceId`, `deviceToken`, `revoked`, etc.
- [ ] Ensure every update increments `version`.

## Phase 2 - HTTPS sync API (friend does this)

### 2.1 Authentication model (multi-laptop)

- [ ] Use 1 master token (friend keeps it).
- [ ] Issue a unique `deviceToken` per laptop.
- [ ] Ensure a single laptop can be revoked without affecting others.

### 2.2 Required endpoints

Admin (master token only):

- [ ] `POST /admin/devices` -> create laptop token.
- [ ] `POST /admin/devices/revoke` -> revoke laptop token.

Sync (device token):

- [ ] `POST /sync/push`:
  - [ ] Receives ops with `baseVersion`.
  - [ ] If `baseVersion == currentVersion` -> apply and `version++`.
  - [ ] If not -> return `CONFLICT` with server record and client attempted payload.
- [ ] `GET /sync/pull?since=timestamp`:
  - [ ] Returns records updated since timestamp, including `data`, `version`, `deletedAt`, `updatedBy`, `updatedAt`.

### 2.3 Conflict details required in API response

- [ ] On conflict, response includes:
  - [ ] `tableName`, `recordId`.
  - [ ] Server record (latest data + version + updatedBy/At).
  - [ ] Client attempted payload + `baseVersion`.

## Phase 3 - Server deployment hardening (friend does this)

- [ ] Run API with restart-on-crash (system service or Docker).
- [ ] Put Nginx in front with HTTPS (Let's Encrypt).
- [ ] Firewall allows 22 (SSH) and 80/443; block everything else.
- [ ] Daily `pg_dump` backups; keep 7-14 days.

## Phase 4 - Server testing (do this before linking laptops)

### 4.1 Health

- [ ] `/health` returns OK.

### 4.2 Device registration test

- [ ] Create a device token via `/admin/devices`.
- [ ] Verify token works and can be revoked.

### 4.3 Sync test (dummy data)

- [ ] Push one record update.
- [ ] Pull it back.
- [ ] Verify server increments `version`.

### 4.4 Conflict test (critical)

- [ ] Device A edits record at `baseVersion 5`.
- [ ] Device B edits same record and pushes first (server becomes version 6).
- [ ] Device A pushes with `baseVersion 5` -> must return `CONFLICT`.

## Phase 5 - Laptop integration (after server passes tests)

### 5.1 Local storage per laptop

- [ ] Store `deviceId`, `deviceToken`, `lastSyncTime`.

### 5.2 Local DB record metadata

- [ ] Store `server_version`, `server_updated_at`, `server_updated_by`, `deleted_at`.

### 5.3 Local ops queue

- [ ] On local edits, write to local DB.
- [ ] Append operation into "pending ops".
- [ ] Include `baseVersion = local server_version`.

### 5.4 Sync loop (every 2-5 minutes or "Sync now")

- [ ] Push pending ops.
- [ ] If conflict returned -> store conflict and do not overwrite.
- [ ] Pull updates since `lastSyncTime`.
- [ ] Apply updates (respect `deletedAt`).
- [ ] Update `lastSyncTime` with `serverTime`.

## Phase 6 - Conflict UI (after basic sync works)

### 6.1 Conflicts inbox page

- [ ] List open conflicts.
- [ ] Show `tableName`, `recordId`, created time.

### 6.2 Conflict resolver view

- [ ] Show 3 panels: Mine (local attempted), Theirs (server), Resolved (final).
- [ ] Buttons: Keep Mine, Keep Theirs, Merge (field picker), Save resolution.

### 6.3 Save resolution workflow

- [ ] Create a new "upsert" op with:
  - [ ] `payload = resolved data`.
  - [ ] `baseVersion = serverVersion` (latest).
- [ ] Push it; it should apply cleanly.
- [ ] Mark conflict resolved locally.

## Next steps (requested flow)

- [ ] Friend completes Phase 1-3 (server + API + HTTPS).
- [ ] Run Phase 4 tests (health + push/pull + conflict test).
- [ ] Link Electron app (Phase 5).
- [ ] Add conflict UI (Phase 6).
