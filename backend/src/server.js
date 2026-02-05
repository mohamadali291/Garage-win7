require("dotenv").config();

const express = require("express");
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
  removeConflict,
  hasConflictForRecord,
  countConflicts,
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
const NO_LOGIN =
  String(process.env.NO_LOGIN || "").toLowerCase() === "true" || SYNC_ROLE === "client";

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
    const err = new Error(data && data.error ? data.error : `Request failed (${res.status})`);
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
  if (collection !== "settings") return true;
  const key = String(recordId || "");
  return key !== "current_user" && key !== "last_sync_time";
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

    if (ops.length > 0) {
      try {
        const pushRes = await requestRemote("POST", "/api/sync/push", { ops });
        appliedIds = (pushRes.applied || []).map((item) => item.opId).filter(Boolean);
        conflictIds = (pushRes.conflicts || []).map((item) => item.opId).filter(Boolean);
        errorOps = (pushRes.errors || []).map((item) => item.opId).filter(Boolean);
      } catch (err) {
        if (err && err.status === 409 && err.data) {
          const data = err.data;
          appliedIds = (data.applied || []).map((item) => item.opId).filter(Boolean);
          conflictIds = (data.conflicts || []).map((item) => item.opId).filter(Boolean);
          errorOps = (data.errors || []).map((item) => item.opId).filter(Boolean);
          (data.conflicts || []).forEach((conflict) => {
            addConflict(conflict);
          });
        } else {
          throw err;
        }
      }
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

    lastSyncError = null;
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
      serverTime: Number(serverTime)
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
    let items = getAll(name);
    if (name === "settings") {
      items = items.filter((item) => item && item.id !== "current_user" && item.id !== "last_sync_time");
    }
    collections[name] = items;
  });
  const result = await requestRemote("POST", "/api/sync/full-push", { collections });
  return result;
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, time: Date.now() });
});

app.get("/api/bootstrap", requireAuth, (req, res) => {
  const collections = {};
  VALID_COLLECTIONS.forEach((name) => {
    collections[name] = getAll(name);
  });

  const users = NO_LOGIN ? [] : req.user.role === "main_admin" ? listUsers() : [];
  res.json({ collections, users });
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

    if (baseVersion !== currentVersion) {
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
  const collections = req.body && req.body.collections && typeof req.body.collections === "object" ? req.body.collections : {};
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
    const msg = err && err.message ? err.message : "Push all failed";
    res.status(400).json({ error: msg });
  }
});

app.get("/api/sync/conflicts", requireAuth, (req, res) => {
  if (req.user.role !== "main_admin") return res.status(403).json({ error: "Forbidden" });
  res.json({ conflicts: listConflicts() });
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

app.listen(PORT, () => {
  console.log(`Garage backend listening on http://localhost:${PORT}`);
});
