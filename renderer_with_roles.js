// renderer_with_roles.js - Electron PRELOAD (SQLite + Auth + Backups + Sync Foundations)
//
// Exposes (same API as before + new sync helpers):
//   window.garageDB.init/getAll/setAll/getById/insert/update/upsert/remove/reset/getDbPath
//   window.garageDB.checkpoint()/backup()/getDeviceId()/backfillTimestamps(force?)
//   window.garageDB.getSyncStats()/getPendingOps(limit?)/markOpsSent(opIds)/markOpFailed(opId,err)/retryFailedOps(limit?)/clearSentOps(olderThanDays?)
//   window.auth.login/changePassword/updateCredentials/createUser/listUsers
//
// DB location (Windows):
//   C:\Users\<YOU>\AppData\Roaming\garage-management-system\garage-db.db
//
// Notes:
// - IDs in your UI logic are often treated as NUMBERS with strict equality.
//   SQLite keys are stored as TEXT; we normalize ids + foreign keys back to numbers on READ when safe.
// - We add createdAt/updatedAt automatically on writes and do a one-time backfill for old imported data.
// - We maintain an offline-first sync queue (__sync_queue) that logs upserts/deletes automatically.

const { contextBridge, ipcRenderer } = require("electron");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

let Database;
try {
  Database = require("better-sqlite3");
} catch (e) {
  console.error("better-sqlite3 failed to load:", e);
  Database = null;
}

// ====================== PATHS ======================

let USER_DATA_PATH = null;
try { USER_DATA_PATH = ipcRenderer.sendSync("getUserDataPath"); } catch (e) {}

const DB_FILE_NAME = "garage-db.db";
const LEGACY_JSON_NAME = "garage-db.json";

let DB_FILE_PATH = path.join(__dirname, DB_FILE_NAME);
let LEGACY_JSON_PATH = path.join(__dirname, LEGACY_JSON_NAME);
if (USER_DATA_PATH) {
  DB_FILE_PATH = path.join(USER_DATA_PATH, DB_FILE_NAME);
  LEGACY_JSON_PATH = path.join(USER_DATA_PATH, LEGACY_JSON_NAME);
}
const LEGACY_JSON_APPDIR = path.join(__dirname, LEGACY_JSON_NAME);

const VALID_COLLECTIONS = [
  "clients", "cars", "items", "invoices", "suppliers", "employees",
  "users", "warehouses", "settings", "transfers"
];

const EMPTY_DB = {
  clients: [], cars: [], items: [], invoices: [], suppliers: [],
  employees: [], users: [], warehouses: [], settings: [], transfers: []
};

// ====================== SQLITE CORE ======================

let SQLITE = null;

function openSqlite() {
  if (SQLITE) return SQLITE;
  if (!Database) throw new Error("better-sqlite3 missing. Install + rebuild for Electron.");

  try {
    const dir = path.dirname(DB_FILE_PATH);
    if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (e) {}

  SQLITE = new Database(DB_FILE_PATH);
  SQLITE.pragma("journal_mode = WAL");
  SQLITE.pragma("foreign_keys = OFF");

  // Data tables
  for (const col of VALID_COLLECTIONS) {
    SQLITE.prepare(`
      CREATE TABLE IF NOT EXISTS "${col}" (
        id   TEXT PRIMARY KEY,
        data TEXT NOT NULL
      )
    `).run();
  }

  // Meta table
  SQLITE.prepare(`
    CREATE TABLE IF NOT EXISTS "__meta" (
      key   TEXT PRIMARY KEY,
      value TEXT
    )
  `).run();

  // Sync queue table
  SQLITE.prepare(`
    CREATE TABLE IF NOT EXISTS "__sync_queue" (
      opId        TEXT PRIMARY KEY,
      ts          INTEGER NOT NULL,
      tableName   TEXT NOT NULL,
      recordId    TEXT NOT NULL,
      op          TEXT NOT NULL,               -- upsert | delete | reset | setAll
      payload     TEXT,                        -- JSON string (optional)
      deviceId    TEXT,
      status      TEXT NOT NULL DEFAULT 'pending', -- pending | sent | failed
      retryCount  INTEGER NOT NULL DEFAULT 0,
      lastError   TEXT,
      lastTriedAt INTEGER,
      sentAt      INTEGER
    )
  `).run();
  SQLITE.prepare(`CREATE INDEX IF NOT EXISTS "__sync_queue_status_ts" ON "__sync_queue"(status, ts)`).run();

  return SQLITE;
}

function ensureCollectionTable(col) {
  if (!VALID_COLLECTIONS.includes(col)) throw new Error(`Invalid collection: ${col}`);
}

// ====================== META + DEVICE ID ======================

function metaGet(key) {
  const db = openSqlite();
  const row = db.prepare(`SELECT value FROM "__meta" WHERE key = ?`).get(String(key));
  return row ? row.value : null;
}

function metaSet(key, value) {
  const db = openSqlite();
  db.prepare(`
    INSERT INTO "__meta"(key,value) VALUES(?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `).run(String(key), String(value));
}

function uuidv4() {
  try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
  return crypto.randomBytes(16).toString("hex");
}

function getOrCreateDeviceId() {
  const existing = metaGet("device_id");
  if (existing) return String(existing);
  const id = uuidv4();
  metaSet("device_id", id);
  return id;
}

// ====================== ID NORMALIZATION ======================

const INT_STRING_RE = /^-?\d+$/;

function toNumberIfIntString(v) {
  if (typeof v === "string" && INT_STRING_RE.test(v)) {
    const n = Number(v);
    if (Number.isSafeInteger(n)) return n;
  }
  return v;
}

function normalizeRecordForUi(collectionName, rec) {
  if (!rec || typeof rec !== "object") return rec;
  const out = Array.isArray(rec) ? rec : { ...rec };

  if ("id" in out) out.id = toNumberIfIntString(out.id);

  const fkFields = ["clientId", "carId", "itemId", "employeeId", "supplierId", "warehouseId", "fromWarehouseId", "toWarehouseId"];
  for (const f of fkFields) {
    if (f in out) out[f] = toNumberIfIntString(out[f]);
  }

  if (collectionName === "invoices" && Array.isArray(out.items)) {
    out.items = out.items.map(it => {
      if (!it || typeof it !== "object") return it;
      const it2 = { ...it };
      if ("itemId" in it2) it2.itemId = toNumberIfIntString(it2.itemId);
      return it2;
    });
  }

  return out;
}

function normalizeKey(id) {
  if (id === null || id === undefined) return "";
  return String(id);
}

// Numeric-ish IDs to stay compatible with old JSON format (Date.now-based)
function generateNumericId() {
  return (Date.now() * 1000) + Math.floor(Math.random() * 1000);
}

// ====================== TIMESTAMPS ======================

function nowMs() { return Date.now(); }

function withTimestampsForWrite(existing, incoming) {
  const t = nowMs();
  const base = existing && typeof existing === "object" ? existing : {};
  const rec = { ...base, ...(incoming || {}) };

  if (rec.createdAt === undefined || rec.createdAt === null) rec.createdAt = t;
  rec.updatedAt = t;
  return rec;
}

// ====================== MIGRATION JSON -> SQLITE ======================

function safeParseJsonFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (e) {
    return null;
  }
}

let __suppressQueue = true; // avoid spamming queue during init/migration/backfill

function migrateJsonToSqliteIfNeeded() {
  const db = openSqlite();
  const already = metaGet("migrated_from_json_v1");
  if (already === "1") return;

  let jsonPath = null;
  if (fs.existsSync(LEGACY_JSON_PATH)) jsonPath = LEGACY_JSON_PATH;
  else if (LEGACY_JSON_APPDIR !== LEGACY_JSON_PATH && fs.existsSync(LEGACY_JSON_APPDIR)) jsonPath = LEGACY_JSON_APPDIR;

  if (!jsonPath) {
    metaSet("migrated_from_json_v1", "1");
    return;
  }

  const parsed = safeParseJsonFile(jsonPath);
  if (!parsed) {
    metaSet("migrated_from_json_v1", "1");
    return;
  }

  for (const col of VALID_COLLECTIONS) {
    if (!Array.isArray(parsed[col])) parsed[col] = [];
  }

  const ins = {};
  const del = {};
  for (const col of VALID_COLLECTIONS) {
    del[col] = db.prepare(`DELETE FROM "${col}"`);
    ins[col] = db.prepare(`INSERT OR REPLACE INTO "${col}" (id, data) VALUES (?, ?)`);
  }

  const tx = db.transaction(() => {
    for (const col of VALID_COLLECTIONS) {
      del[col].run();
      const rows = parsed[col] || [];
      for (const r0 of rows) {
        const r = (r0 && typeof r0 === "object") ? { ...r0 } : {};
        if (!("id" in r) || r.id === null || r.id === undefined || r.id === "") r.id = generateNumericId();
        const key = normalizeKey(r.id);
        ins[col].run(key, JSON.stringify({ ...r, id: r.id }));
      }
    }
  });

  try {
    tx();
    metaSet("migrated_from_json_v1", "1");

    // rename userData JSON to .bak
    try {
      if (jsonPath === LEGACY_JSON_PATH) {
        const bak = LEGACY_JSON_PATH + ".bak";
        if (!fs.existsSync(bak)) fs.renameSync(LEGACY_JSON_PATH, bak);
      }
    } catch (e) {}

    console.log("Migrated legacy JSON DB into SQLite:", DB_FILE_PATH);
  } catch (e) {
    console.error("Migration JSON -> SQLite failed:", e);
  }
}

// ====================== CRUD (SQLITE) ======================

function getAll(collectionName) {
  ensureCollectionTable(collectionName);
  const db = openSqlite();
  const rows = db.prepare(`SELECT data FROM "${collectionName}" ORDER BY rowid`).all();
  return rows.map(r => {
    try { return normalizeRecordForUi(collectionName, JSON.parse(r.data)); } catch (e) { return null; }
  }).filter(Boolean);
}

function getById(collectionName, id) {
  ensureCollectionTable(collectionName);
  const db = openSqlite();
  const key = normalizeKey(id);
  const row = db.prepare(`SELECT data FROM "${collectionName}" WHERE id = ?`).get(key);
  if (!row) return null;
  try { return normalizeRecordForUi(collectionName, JSON.parse(row.data)); } catch (e) { return null; }
}

function setAll(collectionName, list) {
  ensureCollectionTable(collectionName);
  const db = openSqlite();
  if (!Array.isArray(list)) list = [];

  const clear = db.prepare(`DELETE FROM "${collectionName}"`);
  const ins = db.prepare(`INSERT OR REPLACE INTO "${collectionName}" (id, data) VALUES (?, ?)`);

  const tx = db.transaction(() => {
    clear.run();
    for (const r0 of list) {
      const r = (r0 && typeof r0 === "object") ? { ...r0 } : {};
      if (!("id" in r) || r.id === null || r.id === undefined || r.id === "") r.id = generateNumericId();
      const key = normalizeKey(r.id);
      // setAll is treated as bulk write; keep timestamps if present, else create
      const finalRec = withTimestampsForWrite(null, r);
      ins.run(key, JSON.stringify({ ...finalRec, id: r.id }));
    }
  });
  tx();

  // Optional: log bulk replace (usually not needed; but helpful for debugging)
  if (!__suppressQueue) enqueueSyncOp("setAll", collectionName, "ALL", { count: list.length });

  return true;
}

function insert(collectionName, record) {
  ensureCollectionTable(collectionName);
  const db = openSqlite();

  const r0 = (record && typeof record === "object") ? { ...record } : {};
  if (!("id" in r0) || r0.id === null || r0.id === undefined || r0.id === "") r0.id = generateNumericId();

  const key = normalizeKey(r0.id);
  const finalRec = withTimestampsForWrite(null, r0);

  db.prepare(`INSERT OR REPLACE INTO "${collectionName}" (id, data) VALUES (?, ?)`)
    .run(key, JSON.stringify({ ...finalRec, id: r0.id }));

  if (!__suppressQueue) enqueueSyncOp("upsert", collectionName, key, finalRec);

  return normalizeRecordForUi(collectionName, { ...finalRec, id: r0.id });
}

function update(collectionName, id, changes) {
  ensureCollectionTable(collectionName);
  const db = openSqlite();
  const key = normalizeKey(id);

  const existing = getById(collectionName, id);
  if (!existing) throw new Error(`Record not found in ${collectionName} with id=${id}`);

  const finalRec = withTimestampsForWrite(existing, changes);
  // Keep original id type in payload (number if UI uses number)
  const payload = { ...finalRec, id: existing.id };

  db.prepare(`INSERT OR REPLACE INTO "${collectionName}" (id, data) VALUES (?, ?)`)
    .run(key, JSON.stringify(payload));

  if (!__suppressQueue) enqueueSyncOp("upsert", collectionName, key, payload);

  return normalizeRecordForUi(collectionName, payload);
}

function upsert(collectionName, record) {
  ensureCollectionTable(collectionName);
  const db = openSqlite();

  const r0 = (record && typeof record === "object") ? { ...record } : {};
  if (!("id" in r0) || r0.id === null || r0.id === undefined || r0.id === "") r0.id = generateNumericId();

  const key = normalizeKey(r0.id);
  const existing = getById(collectionName, r0.id);

  const finalRec = withTimestampsForWrite(existing || null, r0);
  const payload = { ...finalRec, id: r0.id };

  db.prepare(`INSERT OR REPLACE INTO "${collectionName}" (id, data) VALUES (?, ?)`)
    .run(key, JSON.stringify(payload));

  if (!__suppressQueue) enqueueSyncOp("upsert", collectionName, key, payload);

  return normalizeRecordForUi(collectionName, payload);
}

function remove(collectionName, id) {
  ensureCollectionTable(collectionName);
  const db = openSqlite();
  const key = normalizeKey(id);

  const existing = getById(collectionName, id);

  const info = db.prepare(`DELETE FROM "${collectionName}" WHERE id = ?`).run(key);
  const ok = (info && typeof info.changes === "number") ? info.changes > 0 : false;

  if (ok && !__suppressQueue) {
    // for delete we keep minimal payload; you can also include the existing record for audit
    enqueueSyncOp("delete", collectionName, key, existing ? { ...existing } : null);
  }

  return ok;
}

function resetDb() {
  const db = openSqlite();
  const tx = db.transaction(() => {
    for (const col of VALID_COLLECTIONS) db.prepare(`DELETE FROM "${col}"`).run();
  });
  tx();

  ensureDefaultUsers();
  ensureSystemUsers();

  if (!__suppressQueue) enqueueSyncOp("reset", "__all__", "ALL", {});

  return { ...EMPTY_DB };
}

// ====================== BACKUP / CHECKPOINT ======================

function pad2(n) { return String(n).padStart(2, "0"); }

function backupFolderPath() {
  const base = USER_DATA_PATH || path.dirname(DB_FILE_PATH);
  return path.join(base, "backups");
}

function ensureBackupFolder() {
  const dir = backupFolderPath();
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  return dir;
}

function checkpointWalTruncate() {
  const db = openSqlite();
  try {
    db.pragma("wal_checkpoint(TRUNCATE)");
    return true;
  } catch (e) {
    console.error("wal checkpoint failed:", e);
    return false;
  }
}

function makeBackupFileName() {
  const d = new Date();
  const stamp =
    d.getFullYear() +
    pad2(d.getMonth() + 1) +
    pad2(d.getDate()) + "-" +
    pad2(d.getHours()) +
    pad2(d.getMinutes()) +
    pad2(d.getSeconds());
  const baseName = path.basename(DB_FILE_PATH);
  return `${baseName}.backup-${stamp}.db`;
}

function backupDatabaseNow() {
  checkpointWalTruncate();
  const dir = ensureBackupFolder();
  const target = path.join(dir, makeBackupFileName());

  try {
    fs.copyFileSync(DB_FILE_PATH, target);
    return { ok: true, path: target };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

// ====================== SYNC QUEUE (PHASE 2 FOUNDATION) ======================

function enqueueSyncOp(op, tableName, recordId, payloadObj) {
  const db = openSqlite();
  const deviceId = getOrCreateDeviceId();
  const opId = uuidv4();
  const ts = nowMs();

  let payload = null;
  try {
    if (payloadObj !== undefined) payload = JSON.stringify(payloadObj);
  } catch (e) {
    payload = null;
  }

  db.prepare(`
    INSERT INTO "__sync_queue"
      (opId, ts, tableName, recordId, op, payload, deviceId, status, retryCount)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0)
  `).run(opId, ts, String(tableName), String(recordId), String(op), payload, deviceId);

  return opId;
}

function getSyncStats() {
  const db = openSqlite();
  const pending = db.prepare(`SELECT COUNT(*) AS c FROM "__sync_queue" WHERE status='pending'`).get().c || 0;
  const failed  = db.prepare(`SELECT COUNT(*) AS c FROM "__sync_queue" WHERE status='failed'`).get().c || 0;
  const sent    = db.prepare(`SELECT COUNT(*) AS c FROM "__sync_queue" WHERE status='sent'`).get().c || 0;
  return { pending, failed, sent };
}

function getPendingOps(limit) {
  const db = openSqlite();
  const lim = Math.max(1, Math.min(Number(limit || 200), 2000));
  const rows = db.prepare(`
    SELECT opId, ts, tableName, recordId, op, payload, deviceId, status, retryCount, lastError, lastTriedAt, sentAt
    FROM "__sync_queue"
    WHERE status='pending'
    ORDER BY ts ASC
    LIMIT ?
  `).all(lim);

  return rows.map(r => ({
    ...r,
    payload: (() => { try { return r.payload ? JSON.parse(r.payload) : null; } catch (e) { return null; } })()
  }));
}

function markOpsSent(opIds) {
  const db = openSqlite();
  const ids = Array.isArray(opIds) ? opIds.map(String).filter(Boolean) : [];
  if (!ids.length) return 0;

  const stmt = db.prepare(`
    UPDATE "__sync_queue"
    SET status='sent', sentAt=?, lastError=NULL
    WHERE opId=?
  `);
  const tx = db.transaction(() => {
    let n = 0;
    const t = nowMs();
    for (const id of ids) {
      const info = stmt.run(t, id);
      n += (info && info.changes) ? info.changes : 0;
    }
    return n;
  });
  return tx();
}

function markOpFailed(opId, errMsg) {
  const db = openSqlite();
  const id = String(opId || "");
  if (!id) return 0;

  const info = db.prepare(`
    UPDATE "__sync_queue"
    SET status='failed',
        retryCount = retryCount + 1,
        lastError = ?,
        lastTriedAt = ?
    WHERE opId=?
  `).run(String(errMsg || "error"), nowMs(), id);

  return (info && info.changes) ? info.changes : 0;
}

function retryFailedOps(limit) {
  const db = openSqlite();
  const lim = Math.max(1, Math.min(Number(limit || 500), 5000));
  const info = db.prepare(`
    UPDATE "__sync_queue"
    SET status='pending'
    WHERE opId IN (
      SELECT opId FROM "__sync_queue"
      WHERE status='failed'
      ORDER BY ts ASC
      LIMIT ?
    )
  `).run(lim);
  return (info && info.changes) ? info.changes : 0;
}

function clearSentOps(olderThanDays) {
  const db = openSqlite();
  const days = Number.isFinite(Number(olderThanDays)) ? Number(olderThanDays) : 30;
  const cutoff = nowMs() - Math.max(0, days) * 24 * 60 * 60 * 1000;

  const info = db.prepare(`
    DELETE FROM "__sync_queue"
    WHERE status='sent' AND ts < ?
  `).run(cutoff);

  return (info && info.changes) ? info.changes : 0;
}

// ====================== AUTH (same interface) ======================

function hashPassword(plain) {
  return crypto.createHash("sha256").update(String(plain || "")).digest("hex");
}

function findUser(username) {
  const needle = (username || "").trim().toLowerCase();
  const users = getAll("users");
  return users.find(u => (u.username || "").trim().toLowerCase() === needle) || null;
}

function createUser(username, password, role = "viewer") {
  const trimmedUsername = (username || "").trim();
  if (!trimmedUsername || !password) throw new Error("Username and password are required");

  const users = getAll("users");
  const existing = users.find(u => u.username === trimmedUsername);
  if (existing) throw new Error("Username already exists");

  const user = {
    id: generateNumericId(),
    username: trimmedUsername,
    passwordHash: hashPassword(password),
    role: role || "viewer",
    enabled: true,
    isMainAdmin: role === "main_admin"
  };

  // write through DB so timestamps + queue apply
  insert("users", user);

  return { id: user.id, username: user.username, role: user.role, enabled: !!user.enabled, isMainAdmin: !!user.isMainAdmin };
}

function listUsers() {
  return getAll("users").map(u => ({
    id: u.id,
    username: u.username,
    role: u.role || "viewer",
    enabled: !!u.enabled,
    isMainAdmin: !!u.isMainAdmin
  }));
}

function ensureDefaultUsers() {
  let users = getAll("users");
  if (!Array.isArray(users)) users = [];

  if (users.length === 0) {
    __suppressQueue = true;
    try {
      setAll("users", [
        { id: generateNumericId(), username: "admin",    passwordHash: hashPassword("1234"),      role: "main_admin",     enabled: true, isMainAdmin: true },
        { id: generateNumericId(), username: "saadeyat", passwordHash: hashPassword("stock123"),  role: "saadeyat_stock", enabled: true, isMainAdmin: false },
        { id: generateNumericId(), username: "viewer",   passwordHash: hashPassword("viewer123"), role: "viewer",         enabled: true, isMainAdmin: false }
      ]);
    } finally {
      __suppressQueue = true; // keep suppressed until end of init
    }
    return;
  }

  // Ensure fields exist
  let changed = false;
  users = users.map(u => {
    const next = { ...u };
    if (typeof next.enabled !== "boolean") { next.enabled = true; changed = true; }
    if (!next.role) { next.role = "viewer"; changed = true; }
    if (typeof next.isMainAdmin !== "boolean") {
      next.isMainAdmin = (next.role === "main_admin") || (next.username === "admin");
      if (next.isMainAdmin) next.role = "main_admin";
      changed = true;
    }
    return next;
  });

  if (changed) {
    __suppressQueue = true;
    try { setAll("users", users); } finally { __suppressQueue = true; }
  }
}

function ensureSystemUsers() {
  let users = getAll("users");
  if (!Array.isArray(users)) users = [];

  const systemUsers = [
    { username: "saadeyat", password: "stock123", role: "saadeyat_stock" },
    { username: "viewer",   password: "viewer123", role: "viewer" }
  ];

  let changed = false;

  for (const u of systemUsers) {
    const exists = users.some(x => (x.username || "").toLowerCase() === u.username.toLowerCase());
    if (!exists) {
      users.push({
        id: generateNumericId(),
        username: u.username,
        passwordHash: hashPassword(u.password),
        role: u.role,
        enabled: true,
        isMainAdmin: false
      });
      changed = true;
    }
  }

  const hasAdmin = users.some(u => u.role === "main_admin" && u.enabled);
  if (!hasAdmin && users.length > 0) {
    users[0].role = "main_admin";
    users[0].enabled = true;
    users[0].isMainAdmin = true;
    changed = true;
  }

  if (changed) {
    __suppressQueue = true;
    try { setAll("users", users); } finally { __suppressQueue = true; }
  }
}

function login(username, password) {
  const user = findUser(username);
  if (!user) return null;
  if (user.enabled === false) return null;
  const hash = hashPassword(password);
  if (user.passwordHash !== hash) return null;

  return {
    id: user.id,
    username: user.username,
    role: user.role || "viewer",
    enabled: !!user.enabled,
    isMainAdmin: !!user.isMainAdmin
  };
}

function updateCredentials(currentUsername, currentPassword, newUsername, newPassword) {
  const trimmedCurrent = (currentUsername || "").trim();

  let users = getAll("users");
  if (!Array.isArray(users)) users = [];

  const index = users.findIndex(u => u.username === trimmedCurrent);
  if (index === -1) throw new Error("User not found");

  const user = users[index];
  const currentHash = hashPassword(currentPassword || "");
  if (user.passwordHash !== currentHash) throw new Error("Current password is incorrect");

  let finalUsername = user.username;
  let finalPasswordHash = user.passwordHash;

  const trimmedNewUsername = (newUsername || "").trim();
  if (trimmedNewUsername && trimmedNewUsername !== user.username) {
    const taken = users.some(u => u.username === trimmedNewUsername);
    if (taken) throw new Error("New username is already in use");
    finalUsername = trimmedNewUsername;
  }

  if (newPassword && newPassword.length > 0) {
    finalPasswordHash = hashPassword(newPassword);
  }

  const updatedUser = { ...user, username: finalUsername, passwordHash: finalPasswordHash };
  users[index] = updatedUser;

  __suppressQueue = true;
  try { setAll("users", users); } finally { __suppressQueue = false; }

  return {
    id: updatedUser.id,
    username: updatedUser.username,
    role: updatedUser.role || "viewer",
    enabled: !!updatedUser.enabled,
    isMainAdmin: !!updatedUser.isMainAdmin
  };
}

function changePassword(username, currentPassword, newPassword) {
  if (!newPassword) throw new Error("New password cannot be empty");
  return updateCredentials(username, currentPassword, null, newPassword);
}

// ====================== TIMESTAMP BACKFILL ======================

function backfillTimestampsOnce(force) {
  const db = openSqlite();
  const flag = metaGet("timestamps_backfilled_v1");
  if (!force && flag === "1") return { ok: true, already: true };

  const upd = {};
  const sel = {};
  for (const col of VALID_COLLECTIONS) {
    sel[col] = db.prepare(`SELECT id, data FROM "${col}"`);
    upd[col] = db.prepare(`UPDATE "${col}" SET data=? WHERE id=?`);
  }

  const tx = db.transaction(() => {
    let updatedRows = 0;
    for (const col of VALID_COLLECTIONS) {
      const rows = sel[col].all();
      for (const row of rows) {
        let obj = null;
        try { obj = JSON.parse(row.data); } catch (e) { obj = null; }
        if (!obj || typeof obj !== "object") continue;

        const needsCreated = (obj.createdAt === undefined || obj.createdAt === null);
        const needsUpdated = (obj.updatedAt === undefined || obj.updatedAt === null);

        if (needsCreated || needsUpdated) {
          const t = nowMs();
          if (needsCreated) obj.createdAt = t;
          if (needsUpdated) obj.updatedAt = obj.createdAt || t;
          upd[col].run(JSON.stringify(obj), row.id);
          updatedRows++;
        }
      }
    }
    return updatedRows;
  });

  const updatedRows = tx();
  metaSet("timestamps_backfilled_v1", "1");
  return { ok: true, updatedRows };
}

// ====================== INIT ======================

(function init() {
  openSqlite();
  getOrCreateDeviceId();

  // Init steps should NOT create sync ops
  __suppressQueue = true;
  try {
    migrateJsonToSqliteIfNeeded();
    ensureDefaultUsers();
    ensureSystemUsers();
    backfillTimestampsOnce(false);
  } finally {
    __suppressQueue = false;
  }
})();

// ====================== EXPOSE ======================

contextBridge.exposeInMainWorld("garageDB", {
  init: () => {
    openSqlite();
    return {
      clients: getAll("clients"),
      cars: getAll("cars"),
      items: getAll("items"),
      invoices: getAll("invoices"),
      suppliers: getAll("suppliers"),
      employees: getAll("employees"),
      users: getAll("users"),
      warehouses: getAll("warehouses"),
      settings: getAll("settings"),
      transfers: getAll("transfers")
    };
  },

  // CRUD
  getAll,
  setAll,
  getById,
  insert,
  update,
  upsert,
  remove,
  reset: () => resetDb(),

  // DB info
  getDbPath: () => DB_FILE_PATH,

  // Backups
  checkpoint: () => checkpointWalTruncate(),
  backup: () => backupDatabaseNow(),

  // Sync foundations
  getDeviceId: () => getOrCreateDeviceId(),
  backfillTimestamps: (force) => backfillTimestampsOnce(!!force),

  getSyncStats: () => getSyncStats(),
  getPendingOps: (limit) => getPendingOps(limit),
  markOpsSent: (opIds) => markOpsSent(opIds),
  markOpFailed: (opId, err) => markOpFailed(opId, err),
  retryFailedOps: (limit) => retryFailedOps(limit),
  clearSentOps: (olderThanDays) => clearSentOps(olderThanDays)
});

contextBridge.exposeInMainWorld("auth", {
  login,
  changePassword,
  updateCredentials,
  createUser,
  listUsers
});

console.log("renderer_with_roles.js (SQLite + backup + timestamps + sync queue) loaded. DB:", DB_FILE_PATH);
