import { useEffect, useRef, useState } from "react";
import "./legacy.css";
import "./react-ui.css";
import { installGarageBridge } from "./legacyBridge";

const loadedScripts = new Set();
const TOKEN_KEY = "garage_auth_token";

// Detect if running in Electron
const isElectron = typeof window !== 'undefined' && window.isElectron === true;
const API_BASE = isElectron ? "http://localhost:4000" : (import.meta.env.VITE_API_BASE || "");

function buildApiUrl(path) {
  if (!API_BASE) return path;
  return API_BASE.endsWith("/") ? API_BASE.slice(0, -1) + path : API_BASE + path;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (loadedScripts.has(src)) {
      resolve();
      return;
    }
    const existing = document.querySelector(`script[data-legacy-src="${src}"]`);
    if (existing) {
      loadedScripts.add(src);
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.legacySrc = src;
    script.onload = () => {
      loadedScripts.add(src);
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.body.appendChild(script);
  });
}

function App() {
  const containerRef = useRef(null);
  const [legacyReady, setLegacyReady] = useState(false);
  const [user, setUser] = useState(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [showConflicts, setShowConflicts] = useState(false);
  const [conflicts, setConflicts] = useState([]);
  const [conflictsLoading, setConflictsLoading] = useState(false);
  const [conflictsError, setConflictsError] = useState("");
  const [clearingConflictId, setClearingConflictId] = useState(null);

  const isAdmin = user && user.role === "main_admin";

  useEffect(() => {
    window.__USE_REACT_LOGIN = true;
    installGarageBridge();
    let cancelled = false;

    async function initLegacy() {
      if (window.__garagePrimeCache) {
        try {
          await window.__garagePrimeCache();
        } catch (e) {}
      }

      const res = await fetch("/legacy.html");
      const html = await res.text();
      if (cancelled) return;
      if (containerRef.current) {
        containerRef.current.innerHTML = html;
      }

      await loadScript("/vendor/xlsx.full.min.js");
      await loadScript("/legacy.js");
      if (cancelled) return;

      setLegacyReady(true);
      const stored = window.garageDB?.getById("settings", "current_user");
      if (stored && stored.value) {
        setUser(stored.value);
        if (typeof window.showApp === "function") window.showApp();
      } else if (typeof window.showLogin === "function") {
        window.showLogin();
      }
    }

    initLegacy().catch((err) => {
      console.error("Failed to load legacy app:", err);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let timer = null;
    let cancelled = false;
    async function loadSyncStatus() {
      if (!user) return;
      const token = window.localStorage.getItem(TOKEN_KEY);
      if (!token) return;
      try {
        const res = await fetch(buildApiUrl("/api/sync/status"), {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setSyncStatus(data);
          setSyncError(data.lastSyncError || "");
        }
      } catch (e) {}
    }
    if (user) {
      loadSyncStatus();
      timer = window.setInterval(loadSyncStatus, 30000);
    } else {
      setSyncStatus(null);
      setSyncError("");
    }
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [user]);

  useEffect(() => {
    if (!user) {
      setShowConflicts(false);
      setConflicts([]);
      setConflictsError("");
      setConflictsLoading(false);
      setClearingConflictId(null);
    }
  }, [user]);

  function formatSyncTime(ms) {
    if (!ms) return "Never";
    try {
      return new Date(ms).toLocaleString();
    } catch (e) {
      return String(ms);
    }
  }

  async function handleSyncNow() {
    const token = window.localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    setSyncing(true);
    setSyncError("");
    try {
      const res = await fetch(buildApiUrl("/api/sync/run"), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) {
        setSyncError(data && data.error ? data.error : "Sync failed");
      } else if (data && data.result) {
        if (window.__garageRefreshCache) {
          try {
            await window.__garageRefreshCache();
          } catch (e) {}
        }
        if (typeof window.showApp === "function") window.showApp();
        setSyncStatus((prev) => ({ ...prev, lastSyncTime: data.result.serverTime }));
      }
    } catch (e) {
      setSyncError("Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function loadConflicts() {
    if (!user) return;
    const token = window.localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    setConflictsLoading(true);
    setConflictsError("");
    try {
      const res = await fetch(buildApiUrl("/api/sync/conflicts"), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) {
        setConflictsError(data && data.error ? data.error : "Failed to load conflicts");
        setConflicts([]);
        return;
      }
      setConflicts(Array.isArray(data && data.conflicts) ? data.conflicts : []);
    } catch (e) {
      setConflictsError("Failed to load conflicts");
      setConflicts([]);
    } finally {
      setConflictsLoading(false);
    }
  }

  async function clearConflict(conflictId) {
    const token = window.localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    const id = String(conflictId || "");
    if (!id) return;
    setClearingConflictId(id);
    setConflictsError("");
    try {
      const res = await fetch(buildApiUrl(`/api/sync/conflicts/${encodeURIComponent(id)}`), {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) {
        setConflictsError(data && data.error ? data.error : "Failed to clear conflict");
        return;
      }
      setConflicts((prev) => prev.filter((c) => String(c.conflictId) !== id));
    } catch (e) {
      setConflictsError("Failed to clear conflict");
    } finally {
      setClearingConflictId(null);
    }
  }

  function openConflicts() {
    setShowConflicts(true);
    loadConflicts();
  }

  async function handleLogin(event) {
    event.preventDefault();
    if (!username || !password) {
      setError("Please enter username and password.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const result = await window.auth.login(username, password);
      if (!result) {
        setError("Invalid username or password.");
        setLoading(false);
        return;
      }

      window.garageDB.upsert("settings", { id: "current_user", value: result });
      setUser(result);
      setUsername("");
      setPassword("");
      if (typeof window.showApp === "function") window.showApp();
    } catch (err) {
      setError("Login failed. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    try {
      await window.auth.logout();
    } catch (e) {}
    window.garageDB.remove("settings", "current_user");
    setUser(null);
    if (typeof window.showLogin === "function") window.showLogin();
  }

  return (
    <>
      {legacyReady && user && (
        <>
          <div className="react-topbar">
            <div className="meta">
              Signed in as <strong>{user.username}</strong> ({user.role || "viewer"})
            </div>
            <div className="actions">
              {syncStatus && syncStatus.role === "client" && (
                <div className="sync-status">
                  <span className="sync-state">
                    {syncStatus.remoteUrl && syncStatus.deviceTokenPresent
                      ? `Last sync: ${formatSyncTime(syncStatus.lastSyncTime)}`
                      : "Sync not configured"}
                  </span>
                  <span className="sync-meta">
                    Pending: {syncStatus.pendingOps || 0} | Conflicts: {syncStatus.conflicts || 0}
                  </span>
                  {syncError ? <span className="sync-error">{syncError}</span> : null}
                </div>
              )}

              {syncStatus && syncStatus.role === "client" && isAdmin ? (
                <button className="btn btn-secondary" type="button" onClick={openConflicts}>
                  Conflicts
                </button>
              ) : null}

              {syncStatus && syncStatus.role === "client" ? (
                <button className="btn btn-primary" type="button" onClick={handleSyncNow} disabled={syncing}>
                  {syncing ? "Syncing..." : "Sync now"}
                </button>
              ) : null}

              <button className="btn btn-warning" type="button" onClick={handleLogout}>
                Log Out
              </button>
            </div>
          </div>

          {showConflicts && isAdmin && (
            <div className="react-modal-backdrop" onClick={() => setShowConflicts(false)} role="presentation">
              <div className="react-modal" onClick={(e) => e.stopPropagation()}>
                <div className="react-modal-header">
                  <div className="react-modal-title">Sync conflicts</div>
                  <div className="react-modal-actions">
                    <button className="btn btn-secondary" type="button" onClick={loadConflicts} disabled={conflictsLoading}>
                      Refresh
                    </button>
                    <button className="btn btn-warning" type="button" onClick={() => setShowConflicts(false)}>
                      Close
                    </button>
                  </div>
                </div>

                <div className="react-modal-body">
                  {conflictsError ? <div className="react-modal-error">{conflictsError}</div> : null}

                  {conflictsLoading ? <div className="react-modal-muted">Loading…</div> : null}

                  {!conflictsLoading && conflicts.length === 0 ? (
                    <div className="react-modal-muted">No conflicts.</div>
                  ) : null}

                  {!conflictsLoading && conflicts.length > 0 ? (
                    <div className="conflicts-list">
                      {conflicts.map((c) => (
                        <details className="conflict-item" key={c.conflictId}>
                          <summary className="conflict-summary">
                            <span className="conflict-id">{c.tableName}/{c.recordId}</span>
                            <span className="conflict-meta">
                              {c.createdAt ? formatSyncTime(c.createdAt) : ""}
                            </span>
                          </summary>

                          <div className="conflict-body">
                            <div className="conflict-columns">
                              <div className="conflict-col">
                                <div className="conflict-col-title">Server</div>
                                <pre className="conflict-pre">
                                  {JSON.stringify(c.server, null, 2)}
                                </pre>
                              </div>
                              <div className="conflict-col">
                                <div className="conflict-col-title">Client</div>
                                <pre className="conflict-pre">
                                  {JSON.stringify(c.client, null, 2)}
                                </pre>
                              </div>
                            </div>

                            <div className="conflict-actions">
                              <button
                                className="btn btn-danger"
                                type="button"
                                onClick={() => clearConflict(c.conflictId)}
                                disabled={clearingConflictId === String(c.conflictId)}
                              >
                                {clearingConflictId === String(c.conflictId) ? "Clearing…" : "Mark resolved (remove)"}
                              </button>
                              <div className="conflict-note">
                                This only removes the conflict entry; it does not change data.
                              </div>
                            </div>
                          </div>
                        </details>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {!user && (
        <div className="react-login">
          <form className="container" onSubmit={handleLogin}>
            <h1>Garage Login</h1>
            <div className="form-group">
              <label>Username</label>
              <input
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
              />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
              />
            </div>
            <div className="form-group">
              <button className="btn btn-primary" type="submit" disabled={loading}>
                {loading ? "Signing in..." : "Login"}
              </button>
            </div>
            {error ? <div style={{ color: "#dc2626", fontWeight: "bold" }}>{error}</div> : null}
            <p className="login-note">
              Users: <strong>admin</strong>/<strong>1234</strong> | <strong>saadeyat</strong>/
              <strong>stock123</strong> | <strong>viewer</strong>/<strong>viewer123</strong>
            </p>
          </form>
        </div>
      )}

      <div ref={containerRef} />
    </>
  );
}

export default App;
