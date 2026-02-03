// Detect if running in Electron
const isElectron = typeof window !== 'undefined' && window.isElectron === true;

// Use localhost:4000 in Electron, otherwise use VITE_API_BASE
const API_BASE = isElectron ? "http://localhost:4000" : (import.meta.env.VITE_API_BASE || "");
const TOKEN_KEY = "garage_auth_token";
const USER_KEY = "garage_current_user";
const NO_LOGIN = true;
const DEFAULT_USER = { username: "device", role: "main_admin" };

const cache = {
  collections: {},
  users: [],
  ready: false
};

let primePromise = null;

function buildUrl(path) {
  if (!API_BASE) return path;
  return API_BASE.endsWith("/") ? API_BASE.slice(0, -1) + path : API_BASE + path;
}

function getToken() {
  return window.localStorage.getItem(TOKEN_KEY);
}

function setToken(token) {
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

function getStoredUser() {
  const raw = window.localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function setStoredUser(user) {
  if (!user) {
    window.localStorage.removeItem(USER_KEY);
    return;
  }
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function generateNumericId() {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

function setCollection(name, items) {
  cache.collections[name] = Array.isArray(items) ? items : [];
}

function getCollection(name) {
  return cache.collections[name] || [];
}

function getByIdFromCollection(collection, id) {
  const list = getCollection(collection);
  const key = String(id);
  return list.find((item) => item && String(item.id) === key) || null;
}

function upsertInCollection(collection, record) {
  const list = getCollection(collection);
  const key = String(record.id);
  const index = list.findIndex((item) => item && String(item.id) === key);
  if (index >= 0) {
    list[index] = record;
  } else {
    list.push(record);
  }
  return record;
}

function removeFromCollection(collection, id) {
  const list = getCollection(collection);
  const key = String(id);
  const next = list.filter((item) => !(item && String(item.id) === key));
  setCollection(collection, next);
}

async function requestJson(method, path, body, opts = {}) {
  const { auth = true } = opts;
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(buildUrl(path), {
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
    const error = data && data.error ? data.error : `Request failed (${res.status})`;
    throw new Error(error);
  }

  return data;
}

function fireAndForget(promise, label) {
  promise.catch((err) => {
    console.error(label || "API request failed", err);
  });
}

async function primeCache(force = false) {
  if (cache.ready && !force) return cache;

  const data = await requestJson("GET", "/api/bootstrap");
  const collections = data && data.collections ? data.collections : {};
  Object.keys(collections).forEach((name) => {
    setCollection(name, collections[name]);
  });
  cache.users = Array.isArray(data.users) ? data.users : [];
  cache.ready = true;
  return cache;
}

function ensurePrimePromise() {
  if (!primePromise) {
    primePromise = NO_LOGIN || getToken() ? primeCache() : Promise.resolve(cache);
  }
  return primePromise;
}

function installGarageBridge() {
  if (window.garageDB && window.auth) return;

  if (!getToken() && getStoredUser() && !NO_LOGIN) {
    setStoredUser(null);
  }

  if (NO_LOGIN && !getStoredUser()) {
    setStoredUser(DEFAULT_USER);
  }

  window.__garagePrimeCache = () => ensurePrimePromise();
  window.__garageRefreshCache = () => primeCache(true);

  window.garageDB = {
    init: () => ({}),
    getAll: (collection) => {
      if (collection === "users") return cache.users.slice();
      return getCollection(collection).slice();
    },
    getById: (collection, id) => {
      if (collection === "settings" && String(id) === "current_user") {
        const stored = getStoredUser();
        if (stored) return { id: "current_user", value: stored };
      }
      return getByIdFromCollection(collection, id);
    },
    setAll: (collection, list) => {
      if (collection === "users") {
        cache.users = Array.isArray(list) ? list : [];
        return true;
      }
      setCollection(collection, Array.isArray(list) ? list : []);
      fireAndForget(
        requestJson("PUT", `/api/collections/${collection}/bulk`, { items: list || [] }),
        `setAll:${collection}`
      );
      return true;
    },
    insert: (collection, record) => {
      const base = record && typeof record === "object" ? { ...record } : {};
      if (!base.id) base.id = generateNumericId();
      const saved = upsertInCollection(collection, base);
      fireAndForget(
        requestJson("POST", `/api/collections/${collection}`, saved).then((data) => {
          if (data && data.item) upsertInCollection(collection, data.item);
        }),
        `insert:${collection}`
      );
      return saved;
    },
    update: (collection, id, changes) => {
      const existing = getByIdFromCollection(collection, id) || { id };
      const next = { ...existing, ...(changes || {}), id: existing.id };
      const saved = upsertInCollection(collection, next);
      fireAndForget(
        requestJson("PUT", `/api/collections/${collection}/${encodeURIComponent(id)}`, next).then(
          (data) => {
            if (data && data.item) upsertInCollection(collection, data.item);
          }
        ),
        `update:${collection}`
      );
      return saved;
    },
    upsert: (collection, record) => {
      if (collection === "settings" && record && record.id === "current_user") {
        setStoredUser(record.value || null);
        const settings = getCollection("settings").slice();
        const idx = settings.findIndex((item) => item && item.id === "current_user");
        if (idx >= 0) settings[idx] = record;
        else settings.push(record);
        setCollection("settings", settings);
        return record;
      }
      const base = record && typeof record === "object" ? { ...record } : {};
      if (!base.id) base.id = generateNumericId();
      const saved = upsertInCollection(collection, base);
      fireAndForget(
        requestJson("POST", `/api/collections/${collection}`, saved).then((data) => {
          if (data && data.item) upsertInCollection(collection, data.item);
        }),
        `upsert:${collection}`
      );
      return saved;
    },
    remove: (collection, id) => {
      if (collection === "settings" && String(id) === "current_user") {
        setStoredUser(null);
        setToken(null);
        removeFromCollection("settings", id);
        return true;
      }
      removeFromCollection(collection, id);
      fireAndForget(
        requestJson("DELETE", `/api/collections/${collection}/${encodeURIComponent(id)}`),
        `remove:${collection}`
      );
      return true;
    }
  };

  window.auth = {
    login: async (username, password) => {
      if (NO_LOGIN) {
        const user = DEFAULT_USER;
        setStoredUser(user);
        cache.ready = false;
        primePromise = primeCache(true);
        await primePromise;
        return user;
      }
      try {
        const data = await requestJson(
          "POST",
          "/api/auth/login",
          { username, password },
          { auth: false }
        );
        if (data && data.token) setToken(data.token);
        const user = data && data.user ? data.user : null;
        setStoredUser(user);
        if (user) {
          cache.ready = false;
          primePromise = primeCache(true);
          await primePromise;
        }
        return user;
      } catch (err) {
        return null;
      }
    },
    updateCredentials: async (currentUsername, currentPassword, newUsername, newPassword) => {
      if (NO_LOGIN) return DEFAULT_USER;
      const data = await requestJson("POST", "/api/auth/update-credentials", {
        currentUsername,
        currentPassword,
        newUsername,
        newPassword
      });
      const user = data && data.user ? data.user : null;
      if (user) setStoredUser(user);
      return user;
    },
    changePassword: async (username, currentPassword, newPassword) => {
      if (NO_LOGIN) return DEFAULT_USER;
      const data = await requestJson("POST", "/api/auth/update-credentials", {
        currentUsername: username,
        currentPassword,
        newPassword
      });
      return data && data.user ? data.user : null;
    },
    createUser: async (username, password, role) => {
      if (NO_LOGIN) return null;
      const data = await requestJson("POST", "/api/users", { username, password, role });
      const user = data && data.user ? data.user : null;
      if (user) cache.users = cache.users.concat([user]);
      return user;
    },
    listUsers: async () => {
      if (NO_LOGIN) {
        cache.users = [];
        return [];
      }
      const data = await requestJson("GET", "/api/users");
      const users = data && data.users ? data.users : [];
      cache.users = users;
      return users;
    },
    logout: async () => {
      if (NO_LOGIN) return;
      try {
        await requestJson("POST", "/api/auth/logout");
      } catch (e) {}
      setStoredUser(null);
      setToken(null);
      cache.ready = false;
      cache.collections = {};
      cache.users = [];
    }
  };
}

export { installGarageBridge };
