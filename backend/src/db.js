const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const VALID_COLLECTIONS = [
  "clients",
  "cars",
  "items",
  "invoices",
  "suppliers",
  "employees",
  "warehouses",
  "settings",
  "transfers",
  "expenses",
  "payrollPayments",
  "serviceItems"
];

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data", "garage.sqlite");
const SYNC_ROLE = (process.env.SYNC_ROLE || "server").toLowerCase();

let dbInstance = null;
const SYNC_META_KEY = "records_backfilled_v1";

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function nowMs() {
  return Date.now();
}

function generateNumericId() {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

function generateOpId() {
  return crypto.randomBytes(16).toString("hex");
}

function normalizeKey(id) {
  if (id === null || id === undefined) return "";
  return String(id);
}

function hashPassword(plain) {
  return crypto.createHash("sha256").update(String(plain || "")).digest("hex");
}

function withTimestampsForWrite(existing, incoming) {
  const t = nowMs();
  const base = existing && typeof existing === "object" ? existing : {};
  const rec = { ...base, ...(incoming || {}) };
  if (rec.createdAt === undefined || rec.createdAt === null) {
    rec.createdAt = base.createdAt != null ? base.createdAt : t;
  }
  rec.updatedAt = t;
  return rec;
}

function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    role: user.role || "viewer",
    enabled: !!user.enabled,
    isMainAdmin: !!user.is_main_admin
  };
}

function getDb() {
  if (dbInstance) return dbInstance;
  ensureDir(DB_PATH);
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      is_main_admin INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER,
      updated_at INTEGER
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `).run();

  for (const col of VALID_COLLECTIONS) {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS "${col}" (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL
      )
    `).run();
  }

  ensureSyncTables(db);
  ensureDefaultUsers(db);

  backfillRecordsFromCollections(db);

  dbInstance = db;
  return dbInstance;
}

function ensureSyncTables(db) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS records (
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      data TEXT,
      version INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER,
      updated_by TEXT,
      deleted_at INTEGER,
      PRIMARY KEY (table_name, record_id)
    )
  `).run();

  db.prepare("CREATE INDEX IF NOT EXISTS records_updated_at ON records(updated_at)").run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS sync_ops (
      op_id TEXT PRIMARY KEY,
      device_id TEXT,
      created_at INTEGER NOT NULL
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS devices (
      device_id TEXT PRIMARY KEY,
      device_token TEXT UNIQUE NOT NULL,
      label TEXT,
      revoked INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      last_seen INTEGER
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS pending_ops (
      op_id TEXT PRIMARY KEY,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      op TEXT NOT NULL,
      payload TEXT,
      base_version INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `).run();

  db.prepare("CREATE INDEX IF NOT EXISTS pending_ops_record ON pending_ops(table_name, record_id)").run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS sync_conflicts (
      conflict_id TEXT PRIMARY KEY,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      server_record TEXT,
      client_op TEXT,
      created_at INTEGER NOT NULL
    )
  `).run();

  db.prepare("CREATE INDEX IF NOT EXISTS sync_conflicts_record ON sync_conflicts(table_name, record_id)").run();
}

function getSyncMeta(db, key) {
  const row = db.prepare("SELECT value FROM sync_meta WHERE key = ?").get(String(key));
  return row ? row.value : null;
}

function setSyncMeta(db, key, value) {
  db.prepare(`
    INSERT INTO sync_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `).run(String(key), String(value));
}

function backfillRecordsFromCollections(db) {
  if (SYNC_ROLE === "client") return;
  const flag = getSyncMeta(db, SYNC_META_KEY);
  if (flag === "1") return;

  const count = db.prepare("SELECT COUNT(*) as count FROM records").get();
  if (count && count.count > 0) {
    setSyncMeta(db, SYNC_META_KEY, "1");
    return;
  }

  const insert = db.prepare(`
    INSERT OR REPLACE INTO records
      (table_name, record_id, data, version, updated_at, updated_by, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const now = nowMs();
  const tx = db.transaction(() => {
    for (const col of VALID_COLLECTIONS) {
      const rows = db.prepare(`SELECT data FROM "${col}" ORDER BY rowid`).all();
      rows.forEach((row) => {
        let obj = null;
        try {
          obj = JSON.parse(row.data);
        } catch (e) {
          obj = null;
        }
        if (!obj || obj.id === undefined || obj.id === null) return;
        const updatedAt = obj.updatedAt || obj.createdAt || now;
        insert.run(
          col,
          normalizeKey(obj.id),
          JSON.stringify(obj),
          1,
          updatedAt,
          "system",
          null
        );
      });
    }
  });

  tx();
  setSyncMeta(db, SYNC_META_KEY, "1");
}

function ensureDefaultUsers(db) {
  const row = db.prepare("SELECT COUNT(*) as count FROM users").get();
  if (row && row.count > 0) {
    ensureSystemUsers(db);
    return;
  }

  const now = nowMs();
  const insert = db.prepare(`
    INSERT INTO users (id, username, password_hash, role, enabled, is_main_admin, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const defaults = [
    { username: "admin", password: "1234", role: "main_admin", isMainAdmin: 1 },
    { username: "saadeyat", password: "stock123", role: "saadeyat_stock", isMainAdmin: 0 },
    { username: "viewer", password: "viewer123", role: "viewer", isMainAdmin: 0 }
  ];

  const tx = db.transaction(() => {
    defaults.forEach((u) => {
      insert.run(
        String(generateNumericId()),
        u.username,
        hashPassword(u.password),
        u.role,
        1,
        u.isMainAdmin,
        now,
        now
      );
    });
  });

  tx();
}

function ensureSystemUsers(db) {
  const existing = db.prepare("SELECT id, username, role, enabled, is_main_admin FROM users").all();
  const userMap = new Map(existing.map((u) => [String(u.username).toLowerCase(), u]));

  const systemUsers = [
    { username: "saadeyat", password: "stock123", role: "saadeyat_stock", isMainAdmin: 0 },
    { username: "viewer", password: "viewer123", role: "viewer", isMainAdmin: 0 }
  ];

  const insert = db.prepare(`
    INSERT INTO users (id, username, password_hash, role, enabled, is_main_admin, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const now = nowMs();
  const tx = db.transaction(() => {
    systemUsers.forEach((u) => {
      if (userMap.has(u.username.toLowerCase())) return;
      insert.run(
        String(generateNumericId()),
        u.username,
        hashPassword(u.password),
        u.role,
        1,
        u.isMainAdmin,
        now,
        now
      );
    });
  });

  tx();

  const hasAdmin = existing.some((u) => u.role === "main_admin" && u.enabled);
  if (!hasAdmin && existing.length > 0) {
    const first = existing[0];
    db.prepare("UPDATE users SET role='main_admin', is_main_admin=1, enabled=1 WHERE id = ?").run(first.id);
  }
}

function ensureCollection(collection) {
  if (!VALID_COLLECTIONS.includes(collection)) {
    throw new Error(`Invalid collection: ${collection}`);
  }
}

function parseRow(row) {
  if (!row) return null;
  try {
    return JSON.parse(row.data);
  } catch (e) {
    return null;
  }
}

function getAll(collection) {
  ensureCollection(collection);
  const db = getDb();
  const rows = db.prepare(`SELECT data FROM "${collection}" ORDER BY rowid`).all();
  return rows.map(parseRow).filter(Boolean);
}

function getById(collection, id) {
  ensureCollection(collection);
  const db = getDb();
  const key = normalizeKey(id);
  const row = db.prepare(`SELECT data FROM "${collection}" WHERE id = ?`).get(key);
  return parseRow(row);
}

function upsert(collection, record) {
  ensureCollection(collection);
  const db = getDb();

  const rec = record && typeof record === "object" ? { ...record } : {};
  if (!rec.id) rec.id = generateNumericId();
  const existing = getById(collection, rec.id);
  const finalRec = withTimestampsForWrite(existing, rec);

  db.prepare(`INSERT OR REPLACE INTO "${collection}" (id, data) VALUES (?, ?)`)
    .run(normalizeKey(rec.id), JSON.stringify({ ...finalRec, id: rec.id }));

  return { ...finalRec, id: rec.id };
}

function upsertRaw(collection, record) {
  ensureCollection(collection);
  const db = getDb();
  const rec = record && typeof record === "object" ? { ...record } : {};
  if (!rec.id) rec.id = generateNumericId();
  db.prepare(`INSERT OR REPLACE INTO "${collection}" (id, data) VALUES (?, ?)`)
    .run(normalizeKey(rec.id), JSON.stringify({ ...rec, id: rec.id }));
  return { ...rec, id: rec.id };
}

function update(collection, id, changes) {
  ensureCollection(collection);
  const existing = getById(collection, id);
  if (!existing) throw new Error("Record not found");
  const finalRec = withTimestampsForWrite(existing, changes);
  const db = getDb();
  db.prepare(`INSERT OR REPLACE INTO "${collection}" (id, data) VALUES (?, ?)`)
    .run(normalizeKey(id), JSON.stringify({ ...finalRec, id: existing.id }));
  return { ...finalRec, id: existing.id };
}

function setAll(collection, list) {
  ensureCollection(collection);
  const db = getDb();
  const items = Array.isArray(list) ? list : [];

  const clear = db.prepare(`DELETE FROM "${collection}"`);
  const ins = db.prepare(`INSERT OR REPLACE INTO "${collection}" (id, data) VALUES (?, ?)`);

  const tx = db.transaction(() => {
    clear.run();
    items.forEach((raw) => {
      const rec = raw && typeof raw === "object" ? { ...raw } : {};
      if (!rec.id) rec.id = generateNumericId();
      const finalRec = withTimestampsForWrite(null, rec);
      ins.run(normalizeKey(rec.id), JSON.stringify({ ...finalRec, id: rec.id }));
    });
  });

  tx();
  return true;
}

function remove(collection, id) {
  ensureCollection(collection);
  const db = getDb();
  const info = db.prepare(`DELETE FROM "${collection}" WHERE id = ?`).run(normalizeKey(id));
  return info && info.changes > 0;
}

function applyServerRecord(record) {
  if (!record || !record.tableName || record.recordId === undefined || record.recordId === null) {
    return false;
  }
  const db = getDb();
  const payload = record.data && typeof record.data === "object" ? { ...record.data } : null;
  db.prepare(`
    INSERT OR REPLACE INTO records
      (table_name, record_id, data, version, updated_at, updated_by, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(record.tableName),
    normalizeKey(record.recordId),
    payload ? JSON.stringify(payload) : null,
    Number(record.version || 0),
    record.updatedAt != null ? Number(record.updatedAt) : null,
    record.updatedBy != null ? String(record.updatedBy) : null,
    record.deletedAt != null ? Number(record.deletedAt) : null
  );
  return true;
}

function getRecord(tableName, recordId) {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM records WHERE table_name = ? AND record_id = ?
  `).get(String(tableName), normalizeKey(recordId));
  if (!row) return null;
  let data = null;
  if (row.data) {
    try {
      data = JSON.parse(row.data);
    } catch (e) {
      data = null;
    }
  }
  return {
    tableName: row.table_name,
    recordId: row.record_id,
    data,
    version: row.version,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    deletedAt: row.deleted_at
  };
}

function writeRecord(tableName, recordId, data, updatedBy) {
  const db = getDb();
  const existing = getRecord(tableName, recordId);
  const nextVersion = existing ? existing.version + 1 : 1;
  const now = nowMs();
  const payload = data && typeof data === "object" ? { ...data } : {};
  if (payload.id === undefined || payload.id === null) payload.id = recordId;

  db.prepare(`
    INSERT OR REPLACE INTO records
      (table_name, record_id, data, version, updated_at, updated_by, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(tableName),
    normalizeKey(recordId),
    JSON.stringify(payload),
    nextVersion,
    now,
    updatedBy || null,
    null
  );

  return getRecord(tableName, recordId);
}

function writeRecordDeleted(tableName, recordId, updatedBy) {
  const db = getDb();
  const existing = getRecord(tableName, recordId);
  const nextVersion = existing ? existing.version + 1 : 1;
  const now = nowMs();
  const data = existing && existing.data ? JSON.stringify(existing.data) : null;

  db.prepare(`
    INSERT OR REPLACE INTO records
      (table_name, record_id, data, version, updated_at, updated_by, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(tableName),
    normalizeKey(recordId),
    data,
    nextVersion,
    now,
    updatedBy || null,
    now
  );

  return getRecord(tableName, recordId);
}

function listRecordsSince(since) {
  const db = getDb();
  const ts = Number.isFinite(Number(since)) ? Number(since) : 0;
  const rows = db.prepare(`
    SELECT * FROM records
    WHERE (updated_at IS NOT NULL AND updated_at > ?)
       OR (deleted_at IS NOT NULL AND deleted_at > ?)
  `).all(ts, ts);

  return rows.map((row) => {
    let data = null;
    if (row.data) {
      try {
        data = JSON.parse(row.data);
      } catch (e) {
        data = null;
      }
    }
    return {
      tableName: row.table_name,
      recordId: row.record_id,
      data,
      version: row.version,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
      deletedAt: row.deleted_at
    };
  });
}

function markSyncOp(opId, deviceId) {
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO sync_ops (op_id, device_id, created_at)
    VALUES (?, ?, ?)
  `).run(String(opId), deviceId || null, nowMs());
}

function hasSyncOp(opId) {
  const db = getDb();
  const row = db.prepare("SELECT op_id FROM sync_ops WHERE op_id = ?").get(String(opId));
  return !!row;
}

function createDevice(label) {
  const db = getDb();
  const deviceId = crypto.randomBytes(16).toString("hex");
  const deviceToken = crypto.randomBytes(24).toString("hex");
  const now = nowMs();
  db.prepare(`
    INSERT INTO devices (device_id, device_token, label, revoked, created_at)
    VALUES (?, ?, ?, 0, ?)
  `).run(deviceId, deviceToken, label || null, now);
  return { deviceId, deviceToken };
}

function revokeDevice(deviceId) {
  const db = getDb();
  const info = db.prepare("UPDATE devices SET revoked = 1 WHERE device_id = ?").run(String(deviceId));
  return info && info.changes > 0;
}

function getDeviceByToken(token) {
  const db = getDb();
  const row = db.prepare(`
    SELECT device_id, device_token, revoked, label, created_at, last_seen
    FROM devices
    WHERE device_token = ?
  `).get(String(token));
  if (!row || row.revoked) return null;
  return {
    deviceId: row.device_id,
    deviceToken: row.device_token,
    label: row.label,
    revoked: !!row.revoked,
    createdAt: row.created_at,
    lastSeen: row.last_seen
  };
}

function touchDevice(deviceId) {
  const db = getDb();
  db.prepare("UPDATE devices SET last_seen = ? WHERE device_id = ?").run(nowMs(), String(deviceId));
}

function replaceRecordsForCollection(collection, items, updatedBy) {
  const db = getDb();
  const list = Array.isArray(items) ? items : [];
  const now = nowMs();

  const existingRows = db.prepare(`
    SELECT record_id FROM records WHERE table_name = ?
  `).all(String(collection));
  const existingIds = new Set(existingRows.map((row) => String(row.record_id)));
  const incomingIds = new Set();

  list.forEach((item) => {
    if (!item || item.id === undefined || item.id === null) return;
    incomingIds.add(String(item.id));
    const existing = getRecord(collection, item.id);
    const nextVersion = existing ? existing.version + 1 : 1;
    const payload = { ...item };
    if (payload.id === undefined || payload.id === null) payload.id = item.id;

    db.prepare(`
      INSERT OR REPLACE INTO records
        (table_name, record_id, data, version, updated_at, updated_by, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      String(collection),
      normalizeKey(item.id),
      JSON.stringify(payload),
      nextVersion,
      now,
      updatedBy || null,
      null
    );
  });

  existingIds.forEach((id) => {
    if (incomingIds.has(id)) return;
    const existing = getRecord(collection, id);
    const nextVersion = existing ? existing.version + 1 : 1;
    const data = existing && existing.data ? JSON.stringify(existing.data) : null;
    db.prepare(`
      INSERT OR REPLACE INTO records
        (table_name, record_id, data, version, updated_at, updated_by, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(String(collection), normalizeKey(id), data, nextVersion, now, updatedBy || null, now);
  });
}

function queuePendingOp(tableName, recordId, op, payload, baseVersion) {
  ensureCollection(tableName);
  const db = getDb();
  const normalizedId = normalizeKey(recordId);
  const existing = db.prepare(`
    SELECT op_id, base_version FROM pending_ops
    WHERE table_name = ? AND record_id = ?
  `).get(String(tableName), normalizedId);
  const effectiveBase = existing ? Number(existing.base_version || 0) : Number(baseVersion || 0);
  if (existing && existing.op_id) {
    db.prepare("DELETE FROM pending_ops WHERE op_id = ?").run(String(existing.op_id));
  }
  const opId = generateOpId();
  db.prepare(`
    INSERT INTO pending_ops (op_id, table_name, record_id, op, payload, base_version, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    opId,
    String(tableName),
    normalizedId,
    String(op),
    payload ? JSON.stringify(payload) : null,
    effectiveBase,
    nowMs()
  );
  return { opId, baseVersion: effectiveBase };
}

function listPendingOps(limit) {
  const db = getDb();
  const rows = Number.isFinite(Number(limit))
    ? db.prepare(`
        SELECT * FROM pending_ops ORDER BY created_at ASC LIMIT ?
      `).all(Number(limit))
    : db.prepare(`
        SELECT * FROM pending_ops ORDER BY created_at ASC
      `).all();
  return rows.map((row) => {
    let payload = null;
    if (row.payload) {
      try {
        payload = JSON.parse(row.payload);
      } catch (e) {
        payload = null;
      }
    }
    return {
      opId: row.op_id,
      tableName: row.table_name,
      recordId: row.record_id,
      op: row.op,
      payload,
      baseVersion: row.base_version,
      createdAt: row.created_at
    };
  });
}

function deletePendingOps(opIds) {
  const db = getDb();
  const ids = Array.isArray(opIds) ? opIds.map(String).filter(Boolean) : [];
  if (ids.length === 0) return 0;
  const stmt = db.prepare("DELETE FROM pending_ops WHERE op_id = ?");
  const tx = db.transaction(() => {
    ids.forEach((id) => stmt.run(id));
  });
  tx();
  return ids.length;
}

function hasPendingOpForRecord(tableName, recordId) {
  const db = getDb();
  const row = db.prepare(`
    SELECT op_id FROM pending_ops WHERE table_name = ? AND record_id = ?
  `).get(String(tableName), normalizeKey(recordId));
  return !!row;
}

function countPendingOps() {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) as count FROM pending_ops").get();
  return row ? row.count : 0;
}

function addConflict(conflict) {
  const db = getDb();
  const conflictId = conflict && conflict.opId ? String(conflict.opId) : generateOpId();
  const serverRecord = conflict && conflict.server ? JSON.stringify(conflict.server) : null;
  const clientOp = conflict && conflict.client ? JSON.stringify(conflict.client) : null;
  db.prepare(`
    INSERT OR REPLACE INTO sync_conflicts
      (conflict_id, table_name, record_id, server_record, client_op, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    conflictId,
    String(conflict.tableName),
    normalizeKey(conflict.recordId),
    serverRecord,
    clientOp,
    nowMs()
  );
  return conflictId;
}

function listConflicts() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM sync_conflicts ORDER BY created_at DESC
  `).all();
  return rows.map((row) => {
    let server = null;
    let client = null;
    if (row.server_record) {
      try {
        server = JSON.parse(row.server_record);
      } catch (e) {
        server = null;
      }
    }
    if (row.client_op) {
      try {
        client = JSON.parse(row.client_op);
      } catch (e) {
        client = null;
      }
    }
    return {
      conflictId: row.conflict_id,
      tableName: row.table_name,
      recordId: row.record_id,
      server,
      client,
      createdAt: row.created_at
    };
  });
}

function listConflictsPaged(limit = 10, offset = 0) {
  const db = getDb();
  const lim = Math.max(1, Math.min(1000, Number(limit) || 10));
  const off = Math.max(0, Number(offset) || 0);
  const rows = db.prepare(`
    SELECT * FROM sync_conflicts ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(lim, off);
  return rows.map((row) => {
    let server = null;
    let client = null;
    if (row.server_record) {
      try {
        server = JSON.parse(row.server_record);
      } catch (e) {
        server = null;
      }
    }
    if (row.client_op) {
      try {
        client = JSON.parse(row.client_op);
      } catch (e) {
        client = null;
      }
    }
    return {
      conflictId: row.conflict_id,
      tableName: row.table_name,
      recordId: row.record_id,
      server,
      client,
      createdAt: row.created_at
    };
  });
}

function removeConflict(conflictId) {
  const db = getDb();
  const info = db.prepare("DELETE FROM sync_conflicts WHERE conflict_id = ?").run(String(conflictId));
  return info && info.changes > 0;
}

function clearAllConflicts() {
  const db = getDb();
  const info = db.prepare("DELETE FROM sync_conflicts").run();
  return info && info.changes ? info.changes : 0;
}

function hasConflictForRecord(tableName, recordId) {
  const db = getDb();
  const row = db.prepare(`
    SELECT conflict_id FROM sync_conflicts WHERE table_name = ? AND record_id = ?
  `).get(String(tableName), normalizeKey(recordId));
  return !!row;
}

function countConflicts() {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) as count FROM sync_conflicts").get();
  return row ? row.count : 0;
}

function findUserByUsername(username) {
  const db = getDb();
  const needle = (username || "").trim().toLowerCase();
  if (!needle) return null;
  return db.prepare("SELECT * FROM users WHERE lower(username) = ?").get(needle) || null;
}

function authenticateUser(username, password) {
  const user = findUserByUsername(username);
  if (!user || !user.enabled) return null;
  const hash = hashPassword(password);
  if (user.password_hash !== hash) return null;
  return sanitizeUser(user);
}

function listUsers() {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM users ORDER BY username").all();
  return rows.map(sanitizeUser);
}

function createUser(username, password, role = "viewer") {
  const trimmed = (username || "").trim();
  if (!trimmed || !password) throw new Error("Username and password are required");
  const existing = findUserByUsername(trimmed);
  if (existing) throw new Error("Username already exists");

  const now = nowMs();
  const record = {
    id: String(generateNumericId()),
    username: trimmed,
    password_hash: hashPassword(password),
    role: role || "viewer",
    enabled: 1,
    is_main_admin: role === "main_admin" ? 1 : 0,
    created_at: now,
    updated_at: now
  };

  const db = getDb();
  db.prepare(`
    INSERT INTO users (id, username, password_hash, role, enabled, is_main_admin, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.username,
    record.password_hash,
    record.role,
    record.enabled,
    record.is_main_admin,
    record.created_at,
    record.updated_at
  );

  return sanitizeUser(record);
}

function updateCredentials(currentUsername, currentPassword, newUsername, newPassword) {
  const user = findUserByUsername(currentUsername);
  if (!user) throw new Error("User not found");

  const currentHash = hashPassword(currentPassword || "");
  if (user.password_hash !== currentHash) throw new Error("Current password is incorrect");

  let nextUsername = user.username;
  if (newUsername && newUsername.trim() && newUsername.trim() !== user.username) {
    if (findUserByUsername(newUsername.trim())) throw new Error("New username is already in use");
    nextUsername = newUsername.trim();
  }

  let nextHash = user.password_hash;
  if (newPassword && newPassword.length > 0) {
    nextHash = hashPassword(newPassword);
  }

  const db = getDb();
  const now = nowMs();
  db.prepare(`
    UPDATE users
    SET username = ?, password_hash = ?, updated_at = ?
    WHERE id = ?
  `).run(nextUsername, nextHash, now, user.id);

  return sanitizeUser({
    ...user,
    username: nextUsername,
    password_hash: nextHash,
    updated_at: now
  });
}

function createSession(userId) {
  const db = getDb();
  const token = crypto.randomBytes(24).toString("hex");
  db.prepare("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)").run(token, userId, nowMs());
  return token;
}

function getUserByToken(token) {
  if (!token) return null;
  const db = getDb();
  const row = db.prepare(`
    SELECT u.id, u.username, u.role, u.enabled, u.is_main_admin
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
  `).get(token);
  return sanitizeUser(row);
}

function deleteSession(token) {
  if (!token) return false;
  const db = getDb();
  const info = db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  return info && info.changes > 0;
}

module.exports = {
  VALID_COLLECTIONS,
  getDb,
  getAll,
  getById,
  upsert,
  upsertRaw,
  update,
  setAll,
  remove,
  authenticateUser,
  listUsers,
  createUser,
  updateCredentials,
  createSession,
  getUserByToken,
  deleteSession,
  getRecord,
  applyServerRecord,
  writeRecord,
  writeRecordDeleted,
  listRecordsSince,
  markSyncOp,
  hasSyncOp,
  createDevice,
  revokeDevice,
  getDeviceByToken,
  touchDevice,
  replaceRecordsForCollection,
  queuePendingOp,
  listPendingOps,
  deletePendingOps,
  hasPendingOpForRecord,
  countPendingOps,
  addConflict,
  listConflicts,
  listConflictsPaged,
  removeConflict,
  clearAllConflicts,
  hasConflictForRecord,
  countConflicts,
  generateOpId
};
