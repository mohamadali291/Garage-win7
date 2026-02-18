const path = require("path");
try {
  require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
} catch (_) {
  // dotenv optional when env is set by Electron or system
}

const express = require("express");
const fs = require("fs");
const cors = require("cors");
const morgan = require("morgan");
const {
  VALID_COLLECTIONS,
  getAll,
  getById,
  upsert,
  upsertRaw,
  update,
  setAll,
  remove,
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
  generateOpId,
  authenticateUser,
  listUsers,
  createUser,
  updateCredentials,
  createSession,
  getUserByToken,
  deleteSession,
  getDb
} = require("./db");

const app = express();
const PORT = process.env.PORT || 4000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const SYNC_ROLE = (process.env.SYNC_ROLE || "server").toLowerCase();
const SYNC_REMOTE_URL = process.env.SYNC_REMOTE_URL || "";
const SYNC_DEVICE_TOKEN = process.env.SYNC_DEVICE_TOKEN || "";
const SYNC_INTERVAL_MS = Number(process.env.SYNC_INTERVAL_MS || 0);
const NO_LOGIN = String(process.env.NO_LOGIN || "").toLowerCase() === "true";
const SYNC_CONFLICT_POLICY = String(process.env.SYNC_CONFLICT_POLICY || "strict").toLowerCase();
const AUTO_BACKUP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const AUTO_BACKUP_CHECK_MS = 60 * 60 * 1000;
const AUTO_BACKUP_SETTING_ID = "last_auto_backup_time";

app.set("etag", false);

getDb();

function buildCorsOriginOption(raw) {
  const value = String(raw || "").trim();
  if (!value || value === "*") return "*";
  const parts = value
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return "*";
  if (parts.includes("*")) return "*";
  return function corsOrigin(origin, cb) {
    if (!origin) return cb(null, true);
    if (parts.includes(origin)) return cb(null, true);
    return cb(new Error("Not allowed by CORS"), false);
  };
}

app.use(cors({ origin: buildCorsOriginOption(CORS_ORIGIN) }));
app.use(express.json({ limit: "12mb" }));
app.use(morgan("dev"));
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

function extractToken(req) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return null;
  return auth.slice(7).trim();
}

function requireAuth(req, res, next) {
  if (NO_LOGIN) {
    req.user = {
      id: "device",
      username: "device",
      role: "main_admin",
      enabled: true,
      isMainAdmin: true
    };
    req.token = null;
    next();
    return;
  }
  const token = extractToken(req);
  const user = getUserByToken(token);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  req.user = user;
  req.token = token;
  next();
}

function canWriteCollection(role, collection) {
  if (role === "main_admin") return true;
  if (role === "saadeyat_stock") {
    return collection === "items" || collection === "transfers";
  }
  return false;
}

function requireWriteAccess(req, res, next) {
  const collection = req.params.collection;
  if (!VALID_COLLECTIONS.includes(collection)) {
    return res.status(400).json({ error: "Invalid collection" });
  }
  if (!canWriteCollection(req.user.role, collection)) {
    if (req.user.role === "saadeyat_stock" && collection === "settings") {
      const bodyId = req.body && req.body.id != null ? String(req.body.id) : "";
      const paramId = req.params && req.params.id != null ? String(req.params.id) : "";
      const targetId = bodyId || paramId;
      if (targetId === "fixed_tags") {
        return next();
      }
    }
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

function requireDeviceAuth(req, res, next) {
  const token = extractToken(req);
  const device = getDeviceByToken(token);
  if (!device) return res.status(401).json({ error: "Unauthorized" });
  req.device = device;
  touchDevice(device.deviceId);
  next();
}

function requireServerRole(req, res, next) {
  if (SYNC_ROLE !== "server") {
    return res.status(404).json({ error: "Not available" });
  }
  next();
}

let fetchFn = typeof fetch === "function" ? fetch : null;
function getRemoteBaseUrl() {
  return SYNC_REMOTE_URL.replace(/\/$/, "").replace(/\/api$/, "");
}
async function requestRemote(method, path, body) {
  if (!fetchFn) {
    const mod = await import("node-fetch");
    fetchFn = mod.default || mod;
  }
  const url = getRemoteBaseUrl() + path;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${SYNC_DEVICE_TOKEN}`
  };
  const res = await fetchFn(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = text;
    }
  }
  if (!res.ok) {
    let message = "";
    if (data && data.error) {
      message = data.error;
    } else if (data && Array.isArray(data.errors) && data.errors.length > 0) {
      const first = data.errors[0] || {};
      const detail = first.error || JSON.stringify(first);
      message = `Sync push error: ${detail}`;
    } else if (typeof data === "string" && data.trim()) {
      message = data.trim();
    } else {
      message = `Request failed (${res.status})`;
    }
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function getBaseVersion(tableName, recordId) {
  const record = getRecord(tableName, recordId);
  return record ? Number(record.version || 0) : 0;
}

function shouldSyncRecord(collection, recordId) {
  if (collection === "payrollPayments") return false;
  if (collection !== "settings") return true;
  const key = String(recordId || "");
  return (
    key !== "current_user" &&
    key !== "last_sync_time" &&
    key !== "backup_folder" &&
    key !== AUTO_BACKUP_SETTING_ID
  );
}

function getBackupFolderSetting() {
  const rec = getById("settings", "backup_folder");
  if (!rec || rec.value == null) return "";
  return String(rec.value || "");
}

function getElectronDialog() {
  try {
    const electron = require("electron");
    if (electron && electron.dialog) return electron.dialog;
  } catch (_) {}
  return null;
}

function getElectronApp() {
  try {
    const electron = require("electron");
    if (electron && electron.app) return electron.app;
  } catch (_) {}
  return null;
}

function buildBackupFilename() {
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .replace("Z", "");
  return `garage.sqlite.${stamp}.bak`;
}

async function createBackupFile(folder) {
  const targetDir = String(folder || "").trim();
  if (!targetDir) throw new Error("Backup folder not set");
  fs.mkdirSync(targetDir, { recursive: true });
  const outPath = path.join(targetDir, buildBackupFilename());
  const db = getDb();
  if (db && typeof db.backup === "function") {
    await db.backup(outPath);
  } else {
    const fallbackDbPath = process.env.DB_PATH || path.join(__dirname, "..", "data", "garage.sqlite");
    fs.copyFileSync(fallbackDbPath, outPath);
  }
  return outPath;
}

function clearPendingOpsForTable(tableName) {
  try {
    const db = getDb();
    db.prepare("DELETE FROM pending_ops WHERE table_name = ?").run(String(tableName));
  } catch (_) {}
}

function getLastAutoBackupTime() {
  const rec = getById("settings", AUTO_BACKUP_SETTING_ID);
  if (!rec || rec.value == null) return 0;
  const value = Number(rec.value);
  return Number.isFinite(value) ? value : 0;
}

function setLastAutoBackupTime(ts) {
  upsert("settings", { id: AUTO_BACKUP_SETTING_ID, value: Number(ts) });
}

let autoBackupInFlight = null;
async function runAutoBackupIfDue() {
  if (autoBackupInFlight) return autoBackupInFlight;
  autoBackupInFlight = (async () => {
    const folder = getBackupFolderSetting();
    if (!folder) return { skipped: "no_folder" };
    const last = getLastAutoBackupTime();
    const now = Date.now();
    if (last && now - last < AUTO_BACKUP_INTERVAL_MS) {
      return { skipped: "not_due" };
    }
    const file = await createBackupFile(folder);
    setLastAutoBackupTime(now);
    return { ok: true, file };
  })();
  try {
    return await autoBackupInFlight;
  } finally {
    autoBackupInFlight = null;
  }
}

function scheduleAutoBackup() {
  if (AUTO_BACKUP_INTERVAL_MS <= 0 || AUTO_BACKUP_CHECK_MS <= 0) return;
  setTimeout(() => {
    runAutoBackupIfDue().catch((err) => {
      console.log("Auto backup failed:", err && err.message ? err.message : err);
    });
  }, 10 * 1000);
  setInterval(() => {
    runAutoBackupIfDue().catch((err) => {
      console.log("Auto backup failed:", err && err.message ? err.message : err);
    });
  }, AUTO_BACKUP_CHECK_MS);
}

function queueBulkOps(collection, nextItems, existingItems) {
  const existingIds = new Set(
    (Array.isArray(existingItems) ? existingItems : [])
      .map((item) => (item && item.id != null ? String(item.id) : null))
      .filter(Boolean)
  );
  const incomingIds = new Set();
  const list = Array.isArray(nextItems) ? nextItems : [];

  list.forEach((item) => {
    if (!item || item.id == null) return;
    const id = String(item.id);
    incomingIds.add(id);
    if (!shouldSyncRecord(collection, id)) return;
    const baseVersion = getBaseVersion(collection, id);
    queuePendingOp(collection, id, "upsert", item, baseVersion);
  });

  existingIds.forEach((id) => {
    if (incomingIds.has(id)) return;
    if (!shouldSyncRecord(collection, id)) return;
    const baseVersion = getBaseVersion(collection, id);
    queuePendingOp(collection, id, "delete", null, baseVersion);
  });
}

async function pushOpsInBatches(ops) {
  const batchSize = Math.max(1, Number(process.env.SYNC_PUSH_BATCH_SIZE || 200));
  const appliedIds = [];
  const conflictIds = [];
  const errorOps = [];
  const invalidCollections = new Set();
  let errorCount = 0;

  for (let i = 0; i < ops.length; i += batchSize) {
    const batch = ops.slice(i, i + batchSize);
    let data = null;
    try {
      data = await requestRemote("POST", "/api/sync/push", { ops: batch });
    } catch (err) {
      if (err && err.data && (err.data.applied || err.data.conflicts || err.data.errors)) {
        data = err.data || {};
      } else {
        throw err;
      }
    }

    const applied = (data.applied || []).map((item) => item.opId).filter(Boolean);
    const conflicts = (data.conflicts || []).map((item) => item.opId).filter(Boolean);
    const errors = (data.errors || []).map((item) => item.opId).filter(Boolean);
    appliedIds.push(...applied);
    conflictIds.push(...conflicts);
    errorOps.push(...errors);

    if (Array.isArray(data.conflicts) && data.conflicts.length > 0) {
      data.conflicts.forEach((conflict) => addConflict(conflict));
    }

    if (Array.isArray(data.errors) && data.errors.length > 0) {
      errorCount += data.errors.length;
      const opById = new Map(batch.map((op) => [op.opId, op]));
      data.errors.forEach((item) => {
        if (!item || item.error !== "Invalid collection") return;
        const op = opById.get(item.opId);
        if (op && op.tableName) invalidCollections.add(op.tableName);
      });
    }
  }

  let pushWarning = null;
  if (errorCount > 0) {
    if (invalidCollections.size > 0) {
      pushWarning = `Sync skipped ${errorCount} ops for unsupported collections: ${Array.from(
        invalidCollections
      ).join(", ")}`;
    } else {
      pushWarning = `Sync skipped ${errorCount} ops due to server errors`;
    }
  }

  return { appliedIds, conflictIds, errorOps, pushWarning };
}

let syncInFlight = null;
let lastSyncError = null;

async function runClientSync() {
  if (SYNC_ROLE !== "client") {
    throw new Error("Sync client is disabled");
  }
  if (!SYNC_REMOTE_URL || !SYNC_DEVICE_TOKEN) {
    throw new Error("SYNC_REMOTE_URL and SYNC_DEVICE_TOKEN are required");
  }
  if (syncInFlight) return syncInFlight;

  syncInFlight = (async () => {
    clearPendingOpsForTable("payrollPayments");
    const pending = listPendingOps();
    const ops = pending.map((op) => ({
      opId: op.opId,
      tableName: op.tableName,
      recordId: op.recordId,
      op: op.op,
      payload: op.payload || null,
      baseVersion: Number(op.baseVersion || 0)
    }));

    let appliedIds = [];
    let conflictIds = [];
    let errorOps = [];
    let pushWarning = null;

    if (ops.length > 0) {
      const pushRes = await pushOpsInBatches(ops);
      appliedIds = pushRes.appliedIds;
      conflictIds = pushRes.conflictIds;
      errorOps = pushRes.errorOps;
      pushWarning = pushRes.pushWarning;
    }

    const removedIds = Array.from(new Set([...appliedIds, ...conflictIds, ...errorOps]));
    if (removedIds.length > 0) {
      deletePendingOps(removedIds);
    }

    const lastSyncRecord = getById("settings", "last_sync_time");
    const lastSync = Number(lastSyncRecord && lastSyncRecord.value) || 0;
    const pullRes = await requestRemote("GET", `/api/sync/pull?since=${lastSync}`);
    const records = Array.isArray(pullRes.records) ? pullRes.records : [];
    let applied = 0;
    let skipped = 0;

    records.forEach((record) => {
      if (!record || !record.tableName) return;
      if (!shouldSyncRecord(record.tableName, record.recordId)) {
        skipped += 1;
        return;
      }
      if (hasPendingOpForRecord(record.tableName, record.recordId)) {
        skipped += 1;
        return;
      }
      if (hasConflictForRecord(record.tableName, record.recordId)) {
        skipped += 1;
        return;
      }
      if (record.deletedAt) {
        remove(record.tableName, record.recordId);
      } else if (record.data) {
        upsertRaw(record.tableName, record.data);
      }
      applyServerRecord(record);
      applied += 1;
    });

    const serverTime = pullRes.serverTime || Date.now();
    upsert("settings", { id: "last_sync_time", value: Number(serverTime) });

    lastSyncError = pushWarning;
    return {
      pushed: {
        total: ops.length,
        applied: appliedIds.length,
        conflicts: conflictIds.length,
        errors: errorOps.length
      },
      pulled: {
        total: records.length,
        applied,
        skipped
      },
      serverTime: Number(serverTime),
      warning: pushWarning
    };
  })();

  try {
    return await syncInFlight;
  } finally {
    syncInFlight = null;
  }
}

async function runPushFull() {
  if (SYNC_ROLE !== "client") throw new Error("Sync client is disabled");
  if (!SYNC_REMOTE_URL || !SYNC_DEVICE_TOKEN) throw new Error("SYNC_REMOTE_URL and SYNC_DEVICE_TOKEN are required");
  const collections = {};
  VALID_COLLECTIONS.forEach((name) => {
    if (name === "payrollPayments") return;
    let items = getAll(name);
    if (name === "settings") {
      items = items.filter(
        (item) =>
          item &&
          item.id !== "current_user" &&
          item.id !== "last_sync_time" &&
          item.id !== "backup_folder" &&
          item.id !== AUTO_BACKUP_SETTING_ID
      );
    }
    collections[name] = items;
  });
  try {
    const result = await requestRemote("POST", "/api/sync/full-push", { collections });
    return result;
  } catch (err) {
    if (err && err.status === 413) {
      // Fallback: batched upserts only (no deletes) to avoid large payloads
      const ops = [];
      Object.keys(collections).forEach((name) => {
        const list = collections[name] || [];
        list.forEach((item) => {
          if (!item || item.id == null) return;
          if (!shouldSyncRecord(name, item.id)) return;
          const recordId = String(item.id);
          ops.push({
            opId: generateOpId(),
            tableName: name,
            recordId,
            op: "upsert",
            payload: item,
            baseVersion: getBaseVersion(name, recordId)
          });
        });
      });
      const res = await pushOpsInBatches(ops);
      return {
        ok: true,
        mode: "upsert-batched",
        warning: "Full push payload too large; sent batched upserts only (no deletes).",
        pushed: res.appliedIds.length,
        conflicts: res.conflictIds.length,
        errors: res.errorOps.length
      };
    }
    throw err;
  }
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, time: Date.now(), noLogin: NO_LOGIN });
});

app.get("/api/bootstrap", requireAuth, (req, res) => {
  const collections = {};
  VALID_COLLECTIONS.forEach((name) => {
    collections[name] = getAll(name);
  });

  const users = NO_LOGIN ? [] : req.user.role === "main_admin" ? listUsers() : [];
  res.json({ collections, users });
});

app.post("/api/backup/select-folder", requireAuth, async (req, res) => {
  const dialog = getElectronDialog();
  if (!dialog) {
    return res.status(400).json({ error: "Backup folder selection is available only in the desktop app." });
  }
  try {
    const appRef = getElectronApp();
    const saved = getBackupFolderSetting();
    const defaultPath = saved || (appRef && appRef.getPath ? appRef.getPath("documents") : undefined);
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      defaultPath
    });
    if (result.canceled || !result.filePaths || !result.filePaths[0]) {
      return res.json({ folder: null, cancelled: true });
    }
    return res.json({ folder: result.filePaths[0] });
  } catch (err) {
    return res.status(500).json({ error: err && err.message ? err.message : "Failed to open folder picker" });
  }
});

app.post("/api/backup/run", requireAuth, async (req, res) => {
  let folder = req.body && req.body.folder ? String(req.body.folder) : "";
  if (!folder) folder = getBackupFolderSetting();
  if (!folder) return res.status(400).json({ error: "Backup folder not set" });
  try {
    const file = await createBackupFile(folder);
    res.json({ ok: true, file });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : "Backup failed" });
  }
});

app.post("/api/auth/login", (req, res) => {
  if (NO_LOGIN) return res.status(404).json({ error: "Not available" });
  const { username, password } = req.body || {};
  const user = authenticateUser(username, password);
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const token = createSession(user.id);
  res.json({ token, user });
});

app.post("/api/auth/logout", requireAuth, (req, res) => {
  if (NO_LOGIN) return res.status(404).json({ error: "Not available" });
  deleteSession(req.token);
  res.json({ ok: true });
});

app.post("/api/auth/update-credentials", requireAuth, (req, res) => {
  if (NO_LOGIN) return res.status(404).json({ error: "Not available" });
  const { currentUsername, currentPassword, newUsername, newPassword } = req.body || {};
  if (!currentUsername || !currentPassword) {
    return res.status(400).json({ error: "Current username and password are required" });
  }

  if (currentUsername !== req.user.username) {
    return res.status(403).json({ error: "Cannot change another user" });
  }

  try {
    const user = updateCredentials(currentUsername, currentPassword, newUsername, newPassword);
    res.json({ user });
  } catch (err) {
    res.status(400).json({ error: err.message || "Failed to update credentials" });
  }
});

app.get("/api/users", requireAuth, (req, res) => {
  if (NO_LOGIN) return res.status(404).json({ error: "Not available" });
  if (req.user.role !== "main_admin") return res.status(403).json({ error: "Forbidden" });
  res.json({ users: listUsers() });
});

app.post("/api/users", requireAuth, (req, res) => {
  if (NO_LOGIN) return res.status(404).json({ error: "Not available" });
  if (req.user.role !== "main_admin") return res.status(403).json({ error: "Forbidden" });
  const { username, password, role } = req.body || {};
  try {
    const user = createUser(username, password, role);
    res.json({ user });
  } catch (err) {
    res.status(400).json({ error: err.message || "Failed to create user" });
  }
});

app.get("/api/collections/:collection", requireAuth, (req, res) => {
  const { collection } = req.params;
  if (!VALID_COLLECTIONS.includes(collection)) {
    return res.status(400).json({ error: "Invalid collection" });
  }
  const items = getAll(collection);
  res.json({ items });
});

app.get("/api/collections/:collection/:id", requireAuth, (req, res) => {
  const { collection, id } = req.params;
  if (!VALID_COLLECTIONS.includes(collection)) {
    return res.status(400).json({ error: "Invalid collection" });
  }
  const item = getById(collection, id);
  if (!item) return res.status(404).json({ error: "Not found" });
  res.json({ item });
});

app.post("/api/collections/:collection", requireAuth, requireWriteAccess, (req, res) => {
  const { collection } = req.params;
  try {
    const item = upsert(collection, req.body || {});
    if (SYNC_ROLE === "server") {
      writeRecord(collection, item.id, item, req.user.username);
    } else if (SYNC_ROLE === "client" && shouldSyncRecord(collection, item.id)) {
      const baseVersion = getBaseVersion(collection, item.id);
      queuePendingOp(collection, item.id, "upsert", item, baseVersion);
    }
    res.json({ item });
  } catch (err) {
    res.status(400).json({ error: err.message || "Failed to save" });
  }
});

app.put("/api/collections/:collection/bulk", requireAuth, requireWriteAccess, (req, res) => {
  const { collection } = req.params;
  const items = Array.isArray(req.body && req.body.items) ? req.body.items : [];
  try {
    const existing = SYNC_ROLE === "client" ? getAll(collection) : null;
    setAll(collection, items);
    if (SYNC_ROLE === "server") {
      replaceRecordsForCollection(collection, items, req.user.username);
    } else if (SYNC_ROLE === "client") {
      queueBulkOps(collection, items, existing);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message || "Failed to save" });
  }
});

app.put("/api/collections/:collection/:id", requireAuth, requireWriteAccess, (req, res) => {
  const { collection, id } = req.params;
  try {
    const item = update(collection, id, req.body || {});
    if (SYNC_ROLE === "server") {
      writeRecord(collection, item.id, item, req.user.username);
    } else if (SYNC_ROLE === "client" && shouldSyncRecord(collection, item.id)) {
      const baseVersion = getBaseVersion(collection, item.id);
      queuePendingOp(collection, item.id, "upsert", item, baseVersion);
    }
    res.json({ item });
  } catch (err) {
    res.status(400).json({ error: err.message || "Failed to update" });
  }
});

app.delete("/api/collections/:collection/:id", requireAuth, requireWriteAccess, (req, res) => {
  const { collection, id } = req.params;
  try {
    const ok = remove(collection, id);
    if (ok) {
      if (SYNC_ROLE === "server") {
        writeRecordDeleted(collection, id, req.user.username);
      } else if (SYNC_ROLE === "client" && shouldSyncRecord(collection, id)) {
        const baseVersion = getBaseVersion(collection, id);
        queuePendingOp(collection, id, "delete", null, baseVersion);
      }
    }
    res.json({ ok });
  } catch (err) {
    res.status(400).json({ error: err.message || "Failed to delete" });
  }
});

app.post("/api/admin/devices", requireAuth, (req, res) => {
  if (NO_LOGIN) return res.status(404).json({ error: "Not available" });
  if (req.user.role !== "main_admin") return res.status(403).json({ error: "Forbidden" });
  const label = req.body && req.body.label ? String(req.body.label) : null;
  const device = createDevice(label);
  res.json(device);
});

app.post("/api/admin/devices/revoke", requireAuth, (req, res) => {
  if (NO_LOGIN) return res.status(404).json({ error: "Not available" });
  if (req.user.role !== "main_admin") return res.status(403).json({ error: "Forbidden" });
  const deviceId = req.body && req.body.deviceId ? String(req.body.deviceId) : null;
  if (!deviceId) return res.status(400).json({ error: "deviceId is required" });
  const ok = revokeDevice(deviceId);
  res.json({ ok });
});

app.post("/api/sync/push", requireServerRole, requireDeviceAuth, (req, res) => {
  const ops = Array.isArray(req.body && req.body.ops) ? req.body.ops : [];
  const applied = [];
  const conflicts = [];
  const errors = [];

  ops.forEach((op) => {
    if (!op || !op.opId || !op.tableName || !op.recordId) {
      errors.push({ opId: op && op.opId, error: "Invalid op" });
      return;
    }
    if (!VALID_COLLECTIONS.includes(op.tableName)) {
      errors.push({ opId: op.opId, error: "Invalid collection" });
      return;
    }
    if (hasSyncOp(op.opId)) {
      applied.push({ opId: op.opId, status: "duplicate" });
      return;
    }

    const current = getRecord(op.tableName, op.recordId);
    const currentVersion = current ? Number(current.version) : 0;
    const baseVersion = Number(op.baseVersion || 0);

    const isConflict = baseVersion !== currentVersion;
    if (isConflict) {
      const policy = SYNC_CONFLICT_POLICY;
      if (policy === "server_wins") {
        markSyncOp(op.opId, req.device.deviceId);
        applied.push({ opId: op.opId, status: "ignored" });
        return;
      }
      if (policy !== "client_wins" && policy !== "last_write_wins" && policy !== "overwrite") {
      conflicts.push({
        opId: op.opId,
        tableName: op.tableName,
        recordId: op.recordId,
        server: current,
        client: {
          op: op.op,
          payload: op.payload || null,
          baseVersion
        }
      });
      return;
      }
    }

    if (op.op === "delete") {
      remove(op.tableName, op.recordId);
      writeRecordDeleted(op.tableName, op.recordId, req.device.deviceId);
      markSyncOp(op.opId, req.device.deviceId);
      applied.push({ opId: op.opId, status: "deleted" });
      return;
    }

    if (op.op === "upsert") {
      const payload = op.payload && typeof op.payload === "object" ? { ...op.payload } : {};
      if (payload.id === undefined || payload.id === null) payload.id = op.recordId;
      const item = upsert(op.tableName, payload);
      writeRecord(op.tableName, item.id, item, req.device.deviceId);
      markSyncOp(op.opId, req.device.deviceId);
      applied.push({ opId: op.opId, status: "applied" });
      return;
    }

    errors.push({ opId: op.opId, error: "Unknown op" });
  });

  const response = {
    ok: conflicts.length === 0 && errors.length === 0,
    applied,
    conflicts,
    errors,
    serverTime: Date.now()
  };

  if (conflicts.length > 0) {
    return res.status(409).json(response);
  }

  if (errors.length > 0) {
    return res.status(400).json(response);
  }

  return res.json(response);
});

app.get("/api/sync/pull", requireServerRole, requireDeviceAuth, (req, res) => {
  const since = req.query && req.query.since ? Number(req.query.since) : 0;
  const records = listRecordsSince(since);
  res.json({ records, serverTime: Date.now() });
});

app.post("/api/sync/full-push", requireServerRole, requireDeviceAuth, (req, res) => {
  let collections = {};
  if (req.body && req.body.collections && typeof req.body.collections === "object") {
    collections = req.body.collections;
  }
  const summary = {};
  try {
    VALID_COLLECTIONS.forEach((name) => {
      let items = Array.isArray(collections[name]) ? collections[name] : [];
      if (name === "settings") {
        items = items.filter((item) => item && item.id !== "current_user" && item.id !== "last_sync_time");
      }
      setAll(name, items);
      replaceRecordsForCollection(name, items, req.device.deviceId);
      summary[name] = items.length;
    });
    res.json({ ok: true, summary });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : "Full push failed" });
  }
});

app.get("/api/sync/status", requireAuth, (req, res) => {
  const lastSyncRecord = getById("settings", "last_sync_time");
  const lastSyncTime = Number(lastSyncRecord && lastSyncRecord.value) || 0;
  res.json({
    role: SYNC_ROLE,
    remoteUrl: SYNC_REMOTE_URL || null,
    deviceTokenPresent: !!SYNC_DEVICE_TOKEN,
    lastSyncTime,
    pendingOps: countPendingOps(),
    conflicts: countConflicts(),
    lastSyncError
  });
});

app.post("/api/sync/run", requireAuth, async (req, res) => {
  if (SYNC_ROLE !== "client") {
    return res.status(400).json({ error: "Sync client is not enabled" });
  }
  try {
    const result = await runClientSync();
    res.json({ ok: true, result });
  } catch (err) {
    lastSyncError = err && err.message ? err.message : "Sync failed";
    res.status(400).json({ error: lastSyncError });
  }
});

app.post("/api/sync/push-full", requireAuth, async (req, res) => {
  if (SYNC_ROLE !== "client") {
    return res.status(400).json({ error: "Sync client is not enabled" });
  }
  try {
    const result = await runPushFull();
    res.json({ ok: true, result });
  } catch (err) {
    const status = err && err.status;
    const msg = err && err.message ? err.message : "Push all failed";
    const detail = status ? `Server returned ${status}: ${msg}` : msg;
    res.status(400).json({ error: detail });
  }
});

app.get("/api/sync/conflicts", requireAuth, (req, res) => {
  if (req.user.role !== "main_admin") return res.status(403).json({ error: "Forbidden" });
  const limit = Number(req.query && req.query.limit) || 10;
  const offset = Number(req.query && req.query.offset) || 0;
  const conflicts = listConflictsPaged(limit, offset);
  const total = countConflicts();
  res.json({ conflicts, total, limit, offset });
});

app.delete("/api/sync/conflicts", requireAuth, (req, res) => {
  if (req.user.role !== "main_admin") return res.status(403).json({ error: "Forbidden" });
  const removed = clearAllConflicts();
  res.json({ ok: true, removed });
});

app.delete("/api/sync/conflicts/:id", requireAuth, (req, res) => {
  if (req.user.role !== "main_admin") return res.status(403).json({ error: "Forbidden" });
  const ok = removeConflict(req.params.id);
  res.json({ ok });
});

if (SYNC_ROLE === "client" && SYNC_INTERVAL_MS > 0) {
  setInterval(() => {
    runClientSync().catch((err) => {
      lastSyncError = err && err.message ? err.message : "Sync failed";
    });
  }, SYNC_INTERVAL_MS);
}

scheduleAutoBackup();

// Serve built frontend as a local website (when frontend/dist exists)
const frontendDist = path.join(__dirname, "..", "..", "frontend", "dist");
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get("*", (req, res) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });
  console.log(`Serving frontend from ${frontendDist}`);
}

app.listen(PORT, () => {
  console.log(`Garage backend listening on http://localhost:${PORT}`);
  if (fs.existsSync(frontendDist)) {
    console.log(`Open in browser: http://localhost:${PORT}`);
  }
});
