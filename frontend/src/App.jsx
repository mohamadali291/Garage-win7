import { useEffect, useRef, useState } from "react";
import "./legacy.css";
import "./react-ui.css";
import { installGarageBridge } from "./legacyBridge";

const loadedScripts = new Set();
const NO_LOGIN = false;
const DEFAULT_USER = { username: "device", role: "main_admin" };

// Detect if running in Electron
const isElectron = typeof window !== 'undefined' && window.isElectron === true;
const API_BASE = isElectron ? "http://localhost:4000" : (import.meta.env.VITE_API_BASE || "");

const AUTH_TOKEN_KEY = "garage_auth_token";
const STORED_USER_KEY = "garage_current_user";

function buildApiUrl(path) {
  if (!API_BASE) return path;
  return API_BASE.endsWith("/") ? API_BASE.slice(0, -1) + path : API_BASE + path;
}

function getAuthHeaders() {
  const headers = {};
  try {
    const token = typeof window !== "undefined" && window.localStorage && window.localStorage.getItem(AUTH_TOKEN_KEY);
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch (e) {}
  return headers;
}

function friendlySyncError(message) {
  const text = String(message || "").trim();
  if (!text) return "Sync failed";
  if (/Failed to fetch|fetch failed/i.test(text)) {
    return "Cannot reach local backend (http://localhost:4000). Restart the app.";
  }
  if (/getaddrinfo ENOTFOUND/i.test(text)) {
    return "Sync server not reachable (DNS). Check internet connection.";
  }
  if (/SYNC_REMOTE_URL|SYNC_DEVICE_TOKEN/i.test(text)) {
    return "Sync not configured. Set SYNC_REMOTE_URL and SYNC_DEVICE_TOKEN in backend/.env and restart.";
  }
  return text;
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
  const [syncStatus, setSyncStatus] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [showConflicts, setShowConflicts] = useState(false);
  const [conflicts, setConflicts] = useState([]);
  const [conflictsTotal, setConflictsTotal] = useState(0);
  const [conflictsPage, setConflictsPage] = useState(1);
  const [conflictsPageSize] = useState(10);
  const [conflictsLoading, setConflictsLoading] = useState(false);
  const [conflictsError, setConflictsError] = useState("");
  const [clearingConflictId, setClearingConflictId] = useState(null);
  const [pushFullLoading, setPushFullLoading] = useState(false);
  const [pushFullError, setPushFullError] = useState("");
  const lastUserRawRef = useRef(null);

  const isAdmin = user && user.role === "main_admin";

  useEffect(() => {
    function handleUserChanged(event) {
      setUser(event && Object.prototype.hasOwnProperty.call(event, "detail") ? event.detail : null);
    }
    window.addEventListener("garage-user-changed", handleUserChanged);
    return () => {
      window.removeEventListener("garage-user-changed", handleUserChanged);
    };
  }, []);

  useEffect(() => {
    if (!legacyReady) return;
    function syncStoredUser() {
      try {
        const raw = window.localStorage.getItem(STORED_USER_KEY);
        if (raw === lastUserRawRef.current) return;
        lastUserRawRef.current = raw;
        const next = raw ? JSON.parse(raw) : null;
        setUser(next);
      } catch (e) {}
    }
    syncStoredUser();
    const timer = window.setInterval(syncStoredUser, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [legacyReady]);

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
      if (NO_LOGIN) {
        window.garageDB?.upsert("settings", { id: "current_user", value: DEFAULT_USER });
        setUser(DEFAULT_USER);
        if (typeof window.showApp === "function") window.showApp();
      } else {
        const stored = window.garageDB?.getById("settings", "current_user");
        if (stored && stored.value) {
          setUser(stored.value);
          if (typeof window.showApp === "function") window.showApp();
        } else if (typeof window.showLogin === "function") {
          window.showLogin();
        }
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
      try {
        const res = await fetch(buildApiUrl("/api/sync/status"), {
          headers: getAuthHeaders()
        });
        if (!res.ok) {
          setSyncError(friendlySyncError(`Request failed (${res.status})`));
          return;
        }
        const data = await res.json();
        if (!cancelled) {
          setSyncStatus(data);
          setSyncError(data.lastSyncError || "");
        }
      } catch (e) {
        if (!cancelled) {
          setSyncError(friendlySyncError(e && e.message ? e.message : "Sync failed"));
        }
      }
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
    setSyncing(true);
    setSyncError("");
    try {
      const res = await fetch(buildApiUrl("/api/sync/run"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() }
      });
      let data = null;
      try {
        data = await res.json();
      } catch (_) {
        data = {};
      }
      if (!res.ok) {
        setSyncError(friendlySyncError(data && data.error ? data.error : "Sync failed"));
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
      setSyncError(friendlySyncError(e && e.message ? e.message : "Sync failed"));
    } finally {
      setSyncing(false);
    }
  }

  async function handlePushFull() {
    setPushFullLoading(true);
    setPushFullError("");
    try {
      const res = await fetch(buildApiUrl("/api/sync/push-full"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() }
      });
      let data = null;
      try {
        data = await res.json();
      } catch (_) {
        data = {};
      }
      if (!res.ok) {
        setPushFullError(friendlySyncError(data && data.error ? data.error : "Push all failed"));
        return;
      }
      if (window.__garageRefreshCache) {
        try {
          await window.__garageRefreshCache();
        } catch (e) {}
      }
      if (typeof window.showApp === "function") window.showApp();
      setPushFullError("");
    } catch (e) {
      setPushFullError(friendlySyncError(e && e.message ? e.message : "Push all failed"));
    } finally {
      setPushFullLoading(false);
    }
  }

  async function loadConflicts(page = conflictsPage) {
    if (!user) return;
    setConflictsLoading(true);
    setConflictsError("");
    try {
      const nextPage = Math.max(1, Number(page) || 1);
      const offset = (nextPage - 1) * conflictsPageSize;
      const res = await fetch(buildApiUrl(`/api/sync/conflicts?limit=${conflictsPageSize}&offset=${offset}`), {
        headers: getAuthHeaders()
      });
      const data = await res.json();
      if (!res.ok) {
        setConflictsError(data && data.error ? data.error : "Failed to load conflicts");
        setConflicts([]);
        setConflictsTotal(0);
        return;
      }
      setConflicts(Array.isArray(data && data.conflicts) ? data.conflicts : []);
      setConflictsTotal(Number(data && data.total) || 0);
      setConflictsPage(nextPage);
    } catch (e) {
      setConflictsError("Failed to load conflicts");
      setConflicts([]);
      setConflictsTotal(0);
    } finally {
      setConflictsLoading(false);
    }
  }

  async function clearConflict(conflictId) {
    const id = String(conflictId || "");
    if (!id) return;
    setClearingConflictId(id);
    setConflictsError("");
    try {
      const res = await fetch(buildApiUrl(`/api/sync/conflicts/${encodeURIComponent(id)}`), {
        method: "DELETE",
        headers: getAuthHeaders()
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

  async function clearAllConflicts() {
    if (!conflictsTotal) return;
    const ok = window.confirm("Clear ALL sync conflicts? This only deletes conflict records, not your data.");
    if (!ok) return;
    setConflictsError("");
    setConflictsLoading(true);
    try {
      const res = await fetch(buildApiUrl("/api/sync/conflicts"), {
        method: "DELETE",
        headers: getAuthHeaders()
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setConflictsError(data && data.error ? data.error : "Failed to clear conflicts");
      } else {
        setConflicts([]);
        setConflictsTotal(0);
        setConflictsPage(1);
      }
    } catch (e) {
      setConflictsError("Failed to clear conflicts");
    } finally {
      setConflictsLoading(false);
    }
  }
  function openConflicts() {
    setShowConflicts(true);
    loadConflicts(1);
  }

  const conflictPageCount = Math.max(1, Math.ceil(conflictsTotal / conflictsPageSize));

  return (
    <>
      {legacyReady && user && (
        <>
          <div className="react-topbar">
            <div className="meta">
              Signed in as <strong>{user.username}</strong> ({user.role || "viewer"})
            </div>
            <div className="actions">
              {syncStatus && syncStatus.role !== "client" ? (
                <div className="sync-status sync-not-configured">
                  <span className="sync-state">
                    Sync is not configured on this device. To sync with the server, set in backend/.env: SYNC_ROLE=client, SYNC_REMOTE_URL, SYNC_DEVICE_TOKEN — then restart the app.
                  </span>
                </div>
              ) : null}
              {syncStatus && syncStatus.role === "client" && (
                <div className="sync-status">
                  <span className="sync-state">
                    {syncStatus.remoteUrl && syncStatus.deviceTokenPresent
                      ? `Last sync: ${formatSyncTime(syncStatus.lastSyncTime)}`
                      : "Sync not configured (set SYNC_REMOTE_URL and SYNC_DEVICE_TOKEN in backend/.env)"}
                  </span>
                  <span className="sync-meta">
                    Pending: {syncStatus.pendingOps || 0} | Conflicts: {syncStatus.conflicts || 0}
                  </span>
                </div>
              )}

              {syncStatus && syncStatus.role === "client" && isAdmin ? (
                <button className="btn btn-secondary" type="button" onClick={openConflicts}>
                  Conflicts
                </button>
              ) : null}

              {syncStatus && syncStatus.role === "client" ? (
                <>
                  <button className="btn btn-primary" type="button" onClick={handleSyncNow} disabled={syncing}>
                    {syncing ? "Syncing..." : "Sync now"}
                  </button>
                  <button className="btn btn-secondary" type="button" onClick={handlePushFull} disabled={pushFullLoading || syncing} title="Upload all local data to the server (use if data was added before sync was configured)">
                    {pushFullLoading ? "Pushing…" : "Push all to server"}
                  </button>
                </>
              ) : null}
              {syncError ? <span className="sync-error">{syncError}</span> : null}
              {pushFullError ? <span className="sync-error">{pushFullError}</span> : null}
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
                    <button className="btn btn-danger" type="button" onClick={clearAllConflicts} disabled={conflictsLoading || conflictsTotal === 0}>
                      Clear All
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

                  {!conflictsLoading && conflictsTotal > 0 ? (
                    <div className="conflicts-pager" style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "12px", flexWrap: "wrap" }}>
                      <button
                        className="btn btn-secondary"
                        type="button"
                        onClick={() => loadConflicts(conflictsPage - 1)}
                        disabled={conflictsPage <= 1}
                      >
                        Prev
                      </button>
                      <span>
                        Page {conflictsPage} / {conflictPageCount} (Total {conflictsTotal})
                      </span>
                      <button
                        className="btn btn-secondary"
                        type="button"
                        onClick={() => loadConflicts(conflictsPage + 1)}
                        disabled={conflictsPage >= conflictPageCount}
                      >
                        Next
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <div ref={containerRef} />
    </>
  );
}

export default App;
