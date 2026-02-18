/* ===============================
   DB-ONLY STORAGE (NO localStorage)
   =============================== */
function dbReady(cb) {
  (function wait() {
    if (window.garageDB && window.garageDB.getAll && window.garageDB.setAll && window.garageDB.getById && window.garageDB.upsert) return cb();
    setTimeout(wait, 80);
  })();
}
function dbGetSetting(id, fallback = null) {
  try {
    if (!window.garageDB || !window.garageDB.getById) return fallback;
    const rec = window.garageDB.getById('settings', id);
    return (rec && Object.prototype.hasOwnProperty.call(rec, 'value')) ? rec.value : fallback;
  } catch (e) { return fallback; }
}
function dbSetSetting(id, value) {
  try { window.garageDB && window.garageDB.upsert && window.garageDB.upsert('settings', { id, value }); } catch(e){}
}
function dbRemoveSetting(id) {
  try { window.garageDB && window.garageDB.remove && window.garageDB.remove('settings', id); } catch(e){}
}

// ===============================
// BACKUP FOLDER (local setting)
// ===============================
const BACKUP_FOLDER_SETTING_ID = 'backup_folder';

function getBackupFolder() {
  const v = dbGetSetting(BACKUP_FOLDER_SETTING_ID, '');
  return (typeof v === 'string') ? v : '';
}

function setBackupFolder(path) {
  if (path && typeof path === 'string') dbSetSetting(BACKUP_FOLDER_SETTING_ID, path);
  else dbRemoveSetting(BACKUP_FOLDER_SETTING_ID);
}

function getLegacyApiBase() {
  try {
    if (window.isElectron === true) return "http://localhost:4000";
    if (window.location && window.location.protocol === "file:") return "http://localhost:4000";
    const origin = window.location && window.location.origin ? window.location.origin : "";
    if (/localhost:5173|127\.0\.0\.1:5173/.test(origin)) return "http://localhost:4000";
  } catch (e) {}
  return "";
}

function buildLegacyApiUrl(path) {
  const base = getLegacyApiBase();
  if (!base) return path;
  return base.endsWith("/") ? base.slice(0, -1) + path : base + path;
}

function getAuthToken() {
  try { return window.localStorage.getItem('garage_auth_token'); } catch (e) { return null; }
}

function backupApiRequest(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  const token = getAuthToken();
  if (token) headers.Authorization = "Bearer " + token;
  return fetch(buildLegacyApiUrl(path), {
    method: method,
    headers: headers,
    body: body ? JSON.stringify(body) : undefined
  }).then(function(res) {
    return res.text().then(function(text) {
      let data = null;
      if (text) {
        try { data = JSON.parse(text); } catch (e) { data = text; }
      }
      if (!res.ok) {
        const msg = data && data.error ? data.error : ("Request failed (" + res.status + ")");
        throw new Error(msg);
      }
      return data;
    });
  });
}

function refreshBackupFolderUI() {
  const label = document.getElementById('backupFolderLabel');
  if (!label) return;
  const folder = getBackupFolder();
  if (folder) {
    label.textContent = folder;
    label.title = folder;
  } else {
    label.textContent = 'No backup folder selected';
    label.title = '';
  }
}

async function selectBackupFolder() {
  if (typeof requireAdminAction === 'function' && !requireAdminAction()) return;
  const btn = document.getElementById('backupFolderBtn');
  const originalText = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Selecting...';
  }
  try {
    const isDesktop =
      window.isElectron === true ||
      (window.location && window.location.protocol === 'file:');

    let folder = '';
    if (!isDesktop) {
      const current = getBackupFolder();
      const input = window.prompt('Enter full backup folder path (e.g., E:\\\\Backups):', current || '');
      folder = input ? String(input).trim() : '';
      if (!folder) return;
    } else {
      const result = await backupApiRequest('POST', '/api/backup/select-folder', {});
      folder = result && result.folder ? String(result.folder) : '';
      if (!folder) {
        if (result && result.cancelled) return;
        uiError('No folder selected.');
        return;
      }
    }
    setBackupFolder(folder);
    refreshBackupFolderUI();

    const backup = await backupApiRequest('POST', '/api/backup/run', { folder: folder });
    if (backup && backup.file) {
      uiError('Backup saved to: ' + backup.file);
    } else {
      uiError('Backup completed.');
    }
  } catch (e) {
    const msg = e && e.message ? e.message : 'Backup failed.';
    if (msg === 'Backup folder selection is available only in the desktop app.') return;
    uiError(msg);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText || 'Select Backup Folder';
    }
  }
}

async function backupNow() {
  if (typeof requireAdminAction === 'function' && !requireAdminAction()) return;
  const btn = document.getElementById('backupNowBtn');
  const originalText = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Backing up...';
  }
  try {
    const folder = getBackupFolder();
    if (!folder) {
      uiError('Select backup folder first.');
      return;
    }
    const backup = await backupApiRequest('POST', '/api/backup/run', { folder: folder });
    if (backup && backup.file) {
      uiError('Backup saved to: ' + backup.file);
    } else {
      uiError('Backup completed.');
    }
  } catch (e) {
    const msg = e && e.message ? e.message : 'Backup failed.';
    uiError(msg);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText || 'Backup Now';
    }
  }
}
function refreshItemsFromDb() {
  try {
    if (window.garageDB) {
      items = window.garageDB.getAll('items') || items || [];
    }
  } catch (e) {}
  try {
    syncServiceItemsFromItems();
  } catch (e) {}
  try {
    if (typeof syncServiceItemsFromItems === 'function') syncServiceItemsFromItems();
  } catch (e) {}
}
function refreshServiceItemsFromDb() {
  try {
    refreshItemsFromDb();
  } catch (e) {}
}
let lastItemsRefreshAt = 0;
let itemsRefreshPromise = null;
let lastServiceRefreshAt = 0;
let serviceRefreshPromise = null;
function refreshItemsFromServer(force) {
  if (typeof window.__garageRefreshCache !== 'function') return Promise.resolve();
  const now = Date.now();
  if (!force && now - lastItemsRefreshAt < 1500) return itemsRefreshPromise || Promise.resolve();
  if (itemsRefreshPromise) return itemsRefreshPromise;
  itemsRefreshPromise = window.__garageRefreshCache()
    .catch(function() {})
    .then(function() {
      lastItemsRefreshAt = Date.now();
      itemsRefreshPromise = null;
    });
  return itemsRefreshPromise;
}
function refreshServiceItemsFromServer(force) {
  if (typeof window.__garageRefreshCache !== 'function') return Promise.resolve();
  const now = Date.now();
  if (!force && now - lastServiceRefreshAt < 1500) return serviceRefreshPromise || Promise.resolve();
  if (serviceRefreshPromise) return serviceRefreshPromise;
  serviceRefreshPromise = refreshItemsFromServer(force)
    .catch(function() {})
    .then(function() {
      try {
        if (typeof syncServiceItemsFromItems === 'function') syncServiceItemsFromItems();
      } catch (e) {}
      lastServiceRefreshAt = Date.now();
      serviceRefreshPromise = null;
    });
  return serviceRefreshPromise;
}
function getCurrentUser() {
  const u = dbGetSetting('current_user', null);
  if (!u) return null;
  if (u.enabled === false) return null;
  return u;
}
function setCurrentUser(user) {
  if (!user) dbRemoveSetting('current_user');
  else dbSetSetting('current_user', user);
}
function getLogoDataUrl() {
  const v = dbGetSetting('logo_dataurl', '');
  return (typeof v === 'string') ? v : '';
}
function setLogoDataUrl(dataUrl) {
  try {
    if (dataUrl && typeof dataUrl === 'string') dbSetSetting('logo_dataurl', dataUrl);
    else dbRemoveSetting('logo_dataurl');
  } catch (e) {
    console.error('Failed to save logo:', e);
  }
}

const DEFAULT_INVOICE_HEADER = {
  line1: 'Hamdan EV Tronics',
  line2: 'Kornish Al Mazraa Facing Al Daman\"NSSF\"',
  line3: '71334040 / 03334040'
};
const DEFAULT_INVOICE_TVA_REG_NO = '';

function getInvoiceHeaderLines() {
  return {
    line1: String(dbGetSetting('invoice_header_line1', DEFAULT_INVOICE_HEADER.line1) || ''),
    line2: String(dbGetSetting('invoice_header_line2', DEFAULT_INVOICE_HEADER.line2) || ''),
    line3: String(dbGetSetting('invoice_header_line3', DEFAULT_INVOICE_HEADER.line3) || '')
  };
}

function getInvoiceTvaRegNo() {
  return String(dbGetSetting('invoice_tva_reg_no', DEFAULT_INVOICE_TVA_REG_NO) || '');
}

function getLbpUsdRate() {
  const v = dbGetSetting('lbp_usd_rate', '');
  const n = parseFloat(v);
  return isNaN(n) || n <= 0 ? 0 : n;
}

function refreshCurrencySettings() {
  const input = document.getElementById('lbp-usd-rate');
  if (!input) return;
  const rate = getLbpUsdRate();
  input.value = rate ? String(rate) : '';
}

function saveCurrencySettings() {
  if (typeof requireAdminAction === 'function' && !requireAdminAction()) return;
  const input = document.getElementById('lbp-usd-rate');
  if (!input) return;
  const rate = parseFloat(input.value);
  if (isNaN(rate) || rate <= 0) {
    uiError('Please enter a valid LBP to USD rate.', input);
    return;
  }
  dbSetSetting('lbp_usd_rate', rate);
  uiError('Currency rate saved.');
  try {
    if (typeof renderExpenses === 'function') renderExpenses();
  } catch (e) {}
  try {
    const reportType = document.getElementById('reportType');
    if (reportType && reportType.value === 'expenseToday') {
      renderReportExpenseToday();
    }
  } catch (e) {}
}

function refreshInvoiceHeaderSettings() {
  const lines = getInvoiceHeaderLines();
  const l1 = document.getElementById('invoice-header-line1');
  const l2 = document.getElementById('invoice-header-line2');
  const l3 = document.getElementById('invoice-header-line3');
  const tva = document.getElementById('invoice-tva-reg-no');
  if (l1) l1.value = lines.line1;
  if (l2) l2.value = lines.line2;
  if (l3) l3.value = lines.line3;
  if (tva) tva.value = getInvoiceTvaRegNo();
}

function saveInvoiceHeaderSettings() {
  if (typeof requireAdminAction === 'function' && !requireAdminAction()) return;
  const l1 = document.getElementById('invoice-header-line1');
  const l2 = document.getElementById('invoice-header-line2');
  const l3 = document.getElementById('invoice-header-line3');
  const tva = document.getElementById('invoice-tva-reg-no');
  dbSetSetting('invoice_header_line1', l1 ? l1.value.trim() : '');
  dbSetSetting('invoice_header_line2', l2 ? l2.value.trim() : '');
  dbSetSetting('invoice_header_line3', l3 ? l3.value.trim() : '');
  dbSetSetting('invoice_tva_reg_no', tva ? tva.value.trim() : '');
  uiError('Invoice header saved.');
}

// Collections (loaded from DB)
let clients = [];
let cars = [];
let items = [];
let invoices = [];
let suppliers = [];
let employees = [];
let payrollPayments = [];
let expenses = [];
let serviceItems = [];
let serviceItemSearchTerm = '';
let servicePage = 1;
let servicePageSize = 10;
let users = [];

function ensureEmployeePayrollArray(emp) {
  if (!emp) return [];
  if (!Array.isArray(emp.payrollPayments)) emp.payrollPayments = [];
  return emp.payrollPayments;
}

function rebuildPayrollPaymentsFromEmployees() {
  const list = [];
  (employees || []).forEach(function(emp) {
    const arr = Array.isArray(emp && emp.payrollPayments) ? emp.payrollPayments : [];
    arr.forEach(function(p) {
      if (!p) return;
      const copy = { ...p, employeeId: emp.id };
      list.push(copy);
    });
  });
  payrollPayments = list;
  return list;
}

function migratePayrollPaymentsToEmployees() {
  let legacy = [];
  try {
    legacy = window.garageDB ? (window.garageDB.getAll('payrollPayments') || []) : [];
  } catch (e) {
    legacy = [];
  }
  if (!legacy || legacy.length === 0) {
    rebuildPayrollPaymentsFromEmployees();
    return;
  }
  let changed = false;
  legacy.forEach(function(p) {
    if (!p || p.employeeId == null) return;
    const emp = (employees || []).find(function(e) { return String(e.id) === String(p.employeeId); });
    if (!emp) return;
    const arr = ensureEmployeePayrollArray(emp);
    const pid = p.id != null ? p.id : (Date.now() + Math.floor(Math.random() * 1000));
    if (arr.some(function(x) { return String(x.id) === String(pid); })) return;
    const copy = { ...p, id: pid };
    delete copy.employeeId;
    arr.push(copy);
    changed = true;
  });
  if (changed) {
    dbSetAll('employees', employees);
  }
  try { dbSetAll('payrollPayments', []); } catch (e) {}
  rebuildPayrollPaymentsFromEmployees();
}

function isServiceItem(item) {
  return !!(item && item.isService === true);
}

function syncServiceItemsFromItems() {
  serviceItems = (items || []).filter(isServiceItem);
}

let weeklyPayrollContext = null;
let weeklyPayrollEndDate = '';
let warehouses = [];
let transfers = [];



// ======= FAST SELECT OPTIONS (avoid building huge selects) =======
let invoiceClientCache = [];

function rebuildInvoiceClientCache() {
  try {
    invoiceClientCache = (clients || []).slice().sort(function(a,b){
      return String(a && a.name ? a.name : '').localeCompare(String(b && b.name ? b.name : ''));
    });
  } catch(e) { invoiceClientCache = (clients || []).slice(); }
}

// small safe escape (fallback if escapeHtml not defined)
function _esc(v){
  if (typeof escapeHtml === 'function') return escapeHtml(v);
  return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function buildClientOptionsLimited(selectedId, maxRows) {
  const sel = (selectedId == null) ? '' : String(selectedId);
  const MAX = (maxRows == null) ? 60 : parseInt(maxRows,10) || 60;
      const list = (clients || []);
  const subset = list.slice(0, MAX);

  return subset.map(function(c){
    const id = (c && c.id != null) ? String(c.id) : '';
    const name = _esc(c && c.name ? c.name : 'Client');
    const phone = _esc(c && c.phone ? c.phone : '');
    const label = phone ? (name + ' - ' + phone) : name;
    const selected = (sel && id === sel) ? 'selected' : '';
    return '<option value="' + id + '" ' + selected + '>' + label + '</option>';
  }).join('');
}

function buildClientOptionsAll(selectedId) {
  const sel = (selectedId == null) ? '' : String(selectedId);
      const list = (clients || []);
  return list.map(function(c){
    const id = (c && c.id != null) ? String(c.id) : '';
    const name = _esc(c && c.name ? c.name : 'Client');
    const phone = _esc(c && c.phone ? c.phone : '');
    const label = phone ? (name + ' - ' + phone) : name;
    const selected = (sel && id === sel) ? 'selected' : '';
    return '<option value="' + id + '" ' + selected + '>' + label + '</option>';
  }).join('');
}

// ======= BARCODE INDEX (fast lookup) =======
let barcodeIndex = new Map();
function rebuildBarcodeIndex() {
  barcodeIndex = new Map();
  (items || []).forEach(function(it) {
    if (isServiceItem(it)) return;
    const bc = String(it && it.barcode ? it.barcode : '').trim();
    if (!bc) return;
    // Keep first occurrence; barcodes should be unique
    if (!barcodeIndex.has(bc)) barcodeIndex.set(bc, it.id);
  });
}
function findItemByBarcode(code) {
  const bc = String(code || '').trim();
  if (!bc) return null;
  const id = barcodeIndex.get(bc);
  if (id === undefined) return null;
  return (items || []).find(function(i) { return String(i.id) === String(id); }) || null;
}

function migrateLegacyServiceItems() {
  if (!window.garageDB || !window.garageDB.getAll) {
    syncServiceItemsFromItems();
    return;
  }

  let legacy = [];
  try {
    legacy = window.garageDB.getAll('serviceItems') || [];
  } catch (e) {
    legacy = [];
  }

  if (!Array.isArray(legacy) || legacy.length === 0) {
    syncServiceItemsFromItems();
    return;
  }

  function buildKey(s) {
    const code = String(s && s.code ? s.code : '').trim().toLowerCase();
    const name = String(s && s.name ? s.name : '').trim().toLowerCase();
    return code + '|' + name;
  }

  const byKey = new Map();
  (items || []).forEach(function(it) {
    if (!isServiceItem(it)) return;
    byKey.set(buildKey(it), it);
  });

  let maxId = 0;
  (items || []).forEach(function(it) {
    const n = safeInt(it && it.id);
    if (n > maxId) maxId = n;
  });

  const idMap = new Map();
  let itemsChanged = false;

  legacy.forEach(function(svc) {
    if (!svc) return;
    const key = buildKey(svc);
    const existing = byKey.get(key);
    if (existing) {
      idMap.set(String(svc.id), existing.id);
      return;
    }

    let newId = svc.id;
    if (!newId || (items || []).some(function(it) { return String(it.id) === String(newId); })) {
      maxId += 1;
      newId = maxId;
    }

    const newItem = {
      id: newId,
      name: svc.name || '',
      code: svc.code || '',
      isService: true,
      sellingPrice: 0,
      costPrice: 0,
      price: 0,
      quantity: 0,
      quantities: {},
      lowStockThreshold: 0
    };

    ensureItemPricing(newItem);
    ensureItemQuantities(newItem);

    items.push(newItem);
    byKey.set(key, newItem);
    idMap.set(String(svc.id), newId);
    itemsChanged = true;
  });

  let invoicesChanged = false;
  if (idMap.size > 0) {
    (invoices || []).forEach(function(inv) {
      if (!inv || !Array.isArray(inv.items)) return;
      inv.items.forEach(function(line) {
        if (!line || line.serviceItemId == null) return;
        const mapped = idMap.get(String(line.serviceItemId));
        if (mapped && String(mapped) !== String(line.serviceItemId)) {
          line.serviceItemId = mapped;
          invoicesChanged = true;
        }
      });
    });
  }

  if (itemsChanged) dbSetAll('items', items);
  if (invoicesChanged) dbSetAll('invoices', invoices);

  syncServiceItemsFromItems();
}


function dbLoadAll() {
  clients = window.garageDB.getAll('clients') || [];
  cars = window.garageDB.getAll('cars') || [];
  items = window.garageDB.getAll('items') || [];
  (items || []).forEach(ensureItemPricing);
  rebuildBarcodeIndex();
  invoices = window.garageDB.getAll('invoices') || [];
  suppliers = window.garageDB.getAll('suppliers') || [];
  employees = window.garageDB.getAll('employees') || [];
  expenses = window.garageDB.getAll('expenses') || [];
  users = window.garageDB.getAll('users') || [];
  warehouses = window.garageDB.getAll('warehouses') || [];
  transfers = window.garageDB.getAll('transfers') || [];
  migrateLegacyServiceItems();
  syncServiceItemsFromItems();
  migratePayrollPaymentsToEmployees();
}

function dbSetAll(name, arr) {
  try { window.garageDB.setAll(name, Array.isArray(arr) ? arr : []); } catch(e){}
}

function dbPersistAll() {
  dbSetAll('clients', clients);
  rebuildInvoiceClientCache();
dbSetAll('cars', cars);
  dbSetAll('items', items);
  dbSetAll('invoices', invoices);
  dbSetAll('suppliers', suppliers);
  dbSetAll('employees', employees);
  dbSetAll('expenses', expenses);
  dbSetAll('users', users);
  dbSetAll('warehouses', warehouses);
  dbSetAll('transfers', transfers);
}

function clearAllInvoices() {
  if (typeof requireAdminAction === 'function' && !requireAdminAction()) return;
  uiConfirm('Delete ALL invoices? This cannot be undone.', () => {
    invoices = [];
    invoicePage = 1;
    dbSetAll('invoices', invoices);
    renderInvoices();
    renderInvoiceA();
    renderClients();
  });
}
function ensureWarehouses() {
  if (!Array.isArray(warehouses)) warehouses = [];
  let changed = false;
  if (warehouses.length === 0) {
    warehouses = [
      { id: 'main', name: 'Main Warehouse' },
      { id: 'saadeyat', name: 'Saadeyat Warehouse' }
    ];
    changed = true;
  } else {
    const hasMain = warehouses.some(w => String(w.id) === 'main' || String(w.name || '').toLowerCase().includes('main'));
    const hasSaadeyat = warehouses.some(w => String(w.id) === 'saadeyat' || String(w.name || '').toLowerCase().includes('saadeyat'));
    if (!hasMain) {
      warehouses.unshift({ id: 'main', name: 'Main Warehouse' });
      changed = true;
    }
    if (!hasSaadeyat) {
      warehouses.push({ id: 'saadeyat', name: 'Saadeyat Warehouse' });
      changed = true;
    }
  }
  if (changed) {
    let allowWrite = true;
    try {
      allowWrite = typeof hasPerm === 'function' ? hasPerm("*") : true;
    } catch (e) {
      allowWrite = true;
    }
    if (allowWrite) {
      dbSetAll('warehouses', warehouses);
    }
  }
}

function saveWarehouses() {
  ensureWarehouses();
  dbSetAll('warehouses', warehouses);
  // Ensure all items contain quantities object keys
  try {
    if (Array.isArray(items)) items.forEach(it => { if (typeof ensureItemQuantities === 'function') ensureItemQuantities(it); });
    dbSetAll('items', items);
  } catch(e){}
  if (typeof renderItems === 'function') renderItems();
  if (typeof refreshWarehouseSettingsUI === 'function') refreshWarehouseSettingsUI();
}

function updateWarehouseName(id, name) {
  if (typeof requireAdminAction === 'function' && !requireAdminAction()) return;
  const idx = (Array.isArray(warehouses) ? warehouses : []).findIndex(w => String(w.id) === String(id));
  if (idx === -1) return;
  warehouses[idx].name = String(name || '').trim() || warehouses[idx].name;
  saveWarehouses();
}
// Initialize collections from DB (only if session exists)
try {
  dbReady(() => {
    if (!getCurrentUser()) return;
    dbLoadAll();
    ensureWarehouses();
    rebuildInvoiceClientCache();
  });
} catch(e) {}



// ===============================
// AUTH (session handling – uses window.auth above)
// ===============================

// LOGO STORAGE KEY + HELPERS

// ===============================
// ✅ SAFE UI ERROR (replaces alert() to avoid Electron focus bug)
// ===============================
let __uiErrorCleanup = null;

function uiError(message, focusEl) {
  const modal = document.getElementById('alertModal');
  const title = document.getElementById('alertTitle');
  const body  = document.getElementById('alertBody');
if (!modal || !title || !body) {
    console.error("UI modal not found:", message);
    return;
  }

  // prevent stacking listeners
  if (typeof __uiErrorCleanup === "function") {
    __uiErrorCleanup();
    __uiErrorCleanup = null;
  }

  title.textContent = "⚠️ Missing / Invalid Data";
  body.textContent = "";

  const msg = document.createElement("p");
  msg.style.color = "#dc2626";
  msg.style.fontWeight = "bold";
  msg.style.marginBottom = "12px";
  msg.textContent = String(message);

  const footer = document.createElement("div");
  footer.className = "modal-footer";

  const okBtn = document.createElement("button");
  okBtn.className = "btn btn-primary";
  okBtn.type = "button";
  okBtn.textContent = "OK";

  footer.appendChild(okBtn);
  body.appendChild(msg);
  body.appendChild(footer);

  modal.classList.add("active");
  okBtn.focus();

  function closeAndRefocus() {
    modal.classList.remove("active");
    if (focusEl && typeof focusEl.focus === "function") {
      setTimeout(() => focusEl.focus(), 0);
    }
    if (typeof __uiErrorCleanup === "function") __uiErrorCleanup();
    __uiErrorCleanup = null;
  }

  function onKeyDown(e) {
    if (e.key === "Enter" || e.key === "Escape") closeAndRefocus();
  }

  okBtn.addEventListener("click", closeAndRefocus);
  document.addEventListener("keydown", onKeyDown);

  __uiErrorCleanup = () => {
    okBtn.removeEventListener("click", closeAndRefocus);
    document.removeEventListener("keydown", onKeyDown);
  };
}

function uiChooseInvoiceDelete(callback) {
  const modal = document.getElementById('modal');
  const title = document.getElementById('modalTitle');
  const body  = document.getElementById('modalBody');

  if (!modal || !title || !body) return;

  title.textContent = "🧾 Delete Invoice";

  body.textContent = "";

  const msg = document.createElement("p");
  msg.textContent = "Choose how you want to delete this invoice:";
  msg.style.marginBottom = "12px";

  const btnRestore = document.createElement("button");
  btnRestore.className = "btn btn-danger";
  btnRestore.textContent = "Delete & Restore Items";

  const btnDeleteOnly = document.createElement("button");
  btnDeleteOnly.className = "btn btn-warning";
  btnDeleteOnly.textContent = "Delete Only";

  const btnCancel = document.createElement("button");
  btnCancel.className = "btn";
  btnCancel.textContent = "Cancel";

  const footer = document.createElement("div");
  footer.className = "modal-footer";
  footer.style.display = "flex";
  footer.style.gap = "10px";

  footer.append(btnRestore, btnDeleteOnly, btnCancel);
  body.append(msg, footer);

  modal.classList.add("active");
  btnRestore.focus();

  function close(option) {
    modal.classList.remove("active");
    document.removeEventListener("keydown", onKeyDown);
    if (typeof callback === "function") callback(option);
  }

  function onKeyDown(e) {
    if (e.key === "Escape") close(0);
  }

  btnRestore.onclick = () => close(1); // restore + delete
  btnDeleteOnly.onclick = () => close(2); // delete only
  btnCancel.onclick = () => close(0);

  document.addEventListener("keydown", onKeyDown);
}

function uiConfirm(message, onYes, onNo) {
  const modal = document.getElementById('modal');
  const title = document.getElementById('modalTitle');
  const body  = document.getElementById('modalBody');

  if (!modal || !title || !body) {
    // fallback (last resort)
    const ok = window.confirm(message);
    return ok ? (onYes && onYes()) : (onNo && onNo());
  }

  title.textContent = "⚠️ Confirm";

  body.textContent = "";

  const msg = document.createElement("p");
  msg.style.marginBottom = "12px";
  msg.style.fontWeight = "bold";
  msg.textContent = String(message);

  const footer = document.createElement("div");
  footer.className = "modal-footer";

  const yesBtn = document.createElement("button");
  yesBtn.className = "btn btn-danger";
  yesBtn.type = "button";
  yesBtn.textContent = "Yes, Delete";

  const noBtn = document.createElement("button");
  noBtn.className = "btn";
  noBtn.type = "button";
  noBtn.textContent = "Cancel";

  footer.appendChild(yesBtn);
  footer.appendChild(noBtn);
  body.appendChild(msg);
  body.appendChild(footer);

  modal.classList.add("active");
  yesBtn.focus();

  function cleanup() {
    yesBtn.removeEventListener("click", onYesClick);
    noBtn.removeEventListener("click", onNoClick);
    document.removeEventListener("keydown", onKeyDown);
  }

  function close() {
    modal.classList.remove("active");
    cleanup();
  }

  function onYesClick() {
    close();
    if (typeof onYes === "function") onYes();
  }

  function onNoClick() {
    close();
    if (typeof onNo === "function") onNo();
  }

  function onKeyDown(e) {
    if (e.key === "Escape") onNoClick();
    if (e.key === "Enter") onYesClick();
  }

  yesBtn.addEventListener("click", onYesClick);
  noBtn.addEventListener("click", onNoClick);
  document.addEventListener("keydown", onKeyDown);
}


function refreshLogoPreview() {
    const img = document.getElementById('settings-logo-preview');
    if (!img) return;
    const dataUrl = getLogoDataUrl();
    if (dataUrl) {
        img.src = dataUrl;
        img.style.display = 'block';
    } else {
        img.src = '';
        img.style.display = 'none';
    }
}

function handleLogoFileChange(event) {
        if (!requireAdminAction()) return;    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        const dataUrl = e.target.result;
        setLogoDataUrl(dataUrl);
        refreshLogoPreview();
        uiError('Logo saved. It will appear on invoices.');
    };
    reader.readAsDataURL(file);
}

function clearLogo() {
        if (!requireAdminAction()) return;    setLogoDataUrl('');
    refreshLogoPreview();
    uiError('Logo removed.');
}


    // Who is currently logged in (session)

    /***********************
 * AUTH & PERMISSIONS *
 ***********************/














    // ===============================
    // ROLE-BASED ACCESS (3 fixed accounts)
    // main_admin: full access
    // saadeyat_stock: view everything + Excel import only
    // viewer: view only
    // ===============================
    const ROLES = {
        main_admin: { label: "Main Admin", perms: ["*"] },
        saadeyat_stock: { label: "Saadeyat Stock", perms: ["view:items", "import:excel"] },
        viewer: { label: "Viewer", perms: ["view:*"] }
    };

    function getRole() {
        const u = getCurrentUser();
        return u && u.role ? u.role : "viewer";
    }

    function hasPerm(perm) {
        const u = getCurrentUser();
        if (!u) return false;
        // enabled field may not exist in old sessions
        if (u.enabled === false) return false;

        const role = u.role || "viewer";
        const perms = (ROLES[role] && ROLES[role].perms) ? ROLES[role].perms : [];

        if (perms.includes("*")) return true;

        if (perm.startsWith("view:") && perms.includes("view:*")) return true;
        return perms.includes(perm);
    }

    function hasItemAdminAccess() {
        const role = getRole();
        return role === "saadeyat_stock" || hasPerm("*");
    }

   function requireAdminAction(message) {
  if (!hasPerm("*")) {
    uiError(message || "Access denied. Only Main Admin can do this.");
    return false;
  }
  return true;
}

function requireItemAdminAction(message) {
  if (!hasItemAdminAccess()) {
    uiError(message || "Access denied. Only Main Admin or Saadeyat Stock can do this.");
    return false;
  }
  return true;
}

function requireImportExcel(message) {
  if (!hasPerm("import:excel") && !hasPerm("*")) {
    uiError(message || "Access denied. Only Saadeyat Stock or Main Admin can import Excel.");
    return false;
  }
  return true;
}

function ensureRenderedOnce() {
    if (!renderedOnce || typeof renderedOnce !== 'object') {
        renderedOnce = {
            clients: false,
            cars: false,
            items: false,
            invoices: false,
            suppliers: false,
            employees: false,
            expenses: false
        };
    }
}

    function applyAccessControl() {
        ensureRenderedOnce();
        const user = getCurrentUser();
        const role = getRole();
        const roleLabel = (ROLES[role] && ROLES[role].label) ? ROLES[role].label : role;

        // Saadeyat role: only Items + Settings tabs are visible
        if (role === 'saadeyat_stock') {
            const allowedTabs = new Set(['items', 'settings']);
            document.querySelectorAll('.tab').forEach(btn => {
                const oc = btn.getAttribute('onclick') || '';
                const m = oc.match(/showTab\('([^']+)'/);
                if (m) {
                    const tab = m[1];
                    btn.style.display = allowedTabs.has(tab) ? '' : 'none';
                }
            });
            // If currently on a hidden tab, jump to Items
            const active = document.querySelector('.tab-content.active');
            if (active && !allowedTabs.has(active.id)) {
                const itemsBtn = Array.from(document.querySelectorAll('.tab')).find(b => (b.getAttribute('onclick') || '').includes("showTab('items'"));
                showTab('items', itemsBtn);
            }
        } else {
            // Non-Saadeyat roles: show all tabs (subject to other permission rules)
            document.querySelectorAll('.tab').forEach(btn => { btn.style.display = ''; });
        }


        // Show user in Settings
        const uDisplay = document.getElementById('settings-username-display');
        if (uDisplay && user) uDisplay.value = user.username + " (" + roleLabel + ")";

        // Import Excel button
        const importBtn = document.getElementById('importExcelBtn');
        if (importBtn) importBtn.style.display = (hasPerm("import:excel") || hasPerm("*")) ? "" : "none";
        // Transfer/Receive buttons + Notifications (role specific)
        const transferBtn = document.getElementById('transferBtn');
        const receiveBtn  = document.getElementById('receiveBtn');
        const notifPanel  = document.getElementById('notificationsPanel');

        if (transferBtn) transferBtn.style.display = (role === 'saadeyat_stock') ? "" : "none";
        if (receiveBtn)  receiveBtn.style.display  = (role === 'main_admin' || hasPerm("*")) ? "" : "none";
        if (notifPanel)  notifPanel.style.display  = "none"; // open only when user clicks Receive

        // Keep receive button count updated for main admin
        try { if (role === 'main_admin' || hasPerm("*")) updateTransferBadge(); } catch(e){}


        // Hide/disable all Admin-only controls
        document.querySelectorAll('[data-admin-only="1"]').forEach(el => {
            const inItems = !!el.closest('#items');
            const allow = inItems ? hasItemAdminAccess() : hasPerm("*");
            el.style.display = allow ? "" : "none";
        });
        document.querySelectorAll('[data-admin-disable="1"]').forEach(el => {
            const inItems = !!el.closest('#items');
            const allow = inItems ? hasItemAdminAccess() : hasPerm("*");
            el.disabled = !allow;
            el.style.pointerEvents = allow ? "" : "none";
            el.style.opacity = allow ? "" : "0.5";
        });

        // If not logged in, hide everything
        if (!user) {
            document.querySelectorAll('[data-admin-only],[data-admin-disable]').forEach(el => {
                el.style.display = "none";
            });
        }

        // Re-render ONLY current visible tab (avoid freezing on big DB)
        // (Tables are lazy-rendered when you open each tab)
        if (!renderedOnce.clients) { renderedOnce.clients = true; setTimeout(function(){ try{ renderClients(); }catch(e){console.error(e);} }, 0); }
        }
    

function showApp() {
        ensureRenderedOnce();
        const loginScreen = document.getElementById('login-screen');
        const appRoot = document.getElementById('app-root');

        if (loginScreen) loginScreen.style.display = 'none';
        if (appRoot) appRoot.style.display = 'block';

        try {
            dbLoadAll();
            ensureWarehouses();
            rebuildInvoiceClientCache();
            try { rebuildClientIndex(); } catch (e) {}
            try { rebuildClientCarsSearchIndex(); } catch (e) {}
        } catch (e) {}

        if (typeof renderedOnce === 'object' && renderedOnce) {
            Object.keys(renderedOnce).forEach(function(key) {
                renderedOnce[key] = false;
            });
        }

        refreshSettingsUser();
        refreshLogoPreview();
        refreshInvoiceHeaderSettings();
        refreshCurrencySettings();
        refreshWarehouseSettingsUI();
        refreshFixedTagsUI();
        refreshBackupFolderUI();
            applyAccessControl();

        // Re-render the currently active tab after sync/login so new data shows immediately
        try {
            const activeTab = document.querySelector('.tab-content.active');
            if (activeTab && activeTab.id) {
                const tabBtn = Array.from(document.querySelectorAll('.tab')).find(b => {
                    const oc = b.getAttribute('onclick') || '';
                    return oc.includes("showTab('" + activeTab.id + "'");
                });
                showTab(activeTab.id, tabBtn || null);
            }
        } catch (e) {}
}

    function showLogin() {
        const modal = document.getElementById('modal');
if (modal) modal.classList.remove('active');
    const loginScreen = document.getElementById('login-screen');
    const appRoot = document.getElementById('app-root');

    // Show login, hide app
    if (loginScreen) loginScreen.style.display = 'block';
    if (appRoot) appRoot.style.display = 'none';

    
    // Reset and focus login fields
    const usernameInput = document.getElementById('login-username');
    const passwordInput = document.getElementById('login-password');

    if (usernameInput && passwordInput) {
        usernameInput.disabled = false;
        passwordInput.disabled = false;

        // Optional: clear them when returning to login
        // comment these 2 lines out if you *want* to keep what they typed
        usernameInput.value = '';
        passwordInput.value = '';

        usernameInput.focus();
    }
}


    function refreshSettingsUser() {
        const sessionUser = getCurrentUser();
        const input = document.getElementById('settings-username-display');

        if (input) {
            input.value = sessionUser && sessionUser.username ? sessionUser.username : '';
        }

        const newUsernameInput = document.getElementById('settings-new-username');
        if (newUsernameInput) {
            newUsernameInput.value = '';
        }
    }

    async function logout() {
        try {
            if (window.auth && typeof window.auth.logout === 'function') {
                await window.auth.logout();
            }
        } catch (e) {}

        setCurrentUser(null);
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('garage-user-changed', { detail: null }));
        }
        showLogin();

        const firstTabBtn = document.querySelector('.tabs .tab');
        if (firstTabBtn) {
            showTab('clients', firstTabBtn);
        }
    }

    // Change username and/or password using DB auth
    async function changePassword() {
        requireAdminAction('Only Main Admin can change credentials.');
        const sessionUser = getCurrentUser();

        if (!sessionUser) {
            uiError('You are not logged in.');
            return;
        }

        const current = document.getElementById('settings-current-password').value;
        const newPass = document.getElementById('settings-new-password').value;
        const confirm = document.getElementById('settings-confirm-password').value;

        const newUsernameInput = document.getElementById('settings-new-username');
        const requestedUsername = newUsernameInput ? newUsernameInput.value.trim() : '';

        if (!current) {
            uiError('Please enter your current password.', document.getElementById('settings-current-password'));

            return;
        }

        // If user is trying to change password, both newPass and confirm must be filled and equal
        if (newPass || confirm) {
            if (!newPass || !confirm) {
                uiError(
  'Please fill both new password fields.',
  document.getElementById('settings-new-password')
);
                return;
            }
            if (newPass !== confirm) {
                uiError(
  'New passwords do not match.',
  document.getElementById('settings-confirm-password')
);
                return;
            }
        }

        if (!window.auth || !window.auth.updateCredentials) {
           uiError("Auth system not loaded. Check preload and console.");
console.error("window.auth missing - preload not loaded");
            return;
        }

        try {
            const updatedUser = await window.auth.updateCredentials(
                sessionUser.username,
                current,
                requestedUsername || null,
                newPass || null
            );

            // Update session
            setCurrentUser(updatedUser);

            // Clear fields
            document.getElementById('settings-current-password').value = '';
            document.getElementById('settings-new-password').value = '';
            document.getElementById('settings-confirm-password').value = '';
            if (newUsernameInput) newUsernameInput.value = '';

            refreshSettingsUser();
            uiError('Credentials updated successfully.');
        } catch (e) {
            console.error(e);
            uiError(
  e && e.message ? e.message : 'Failed to update credentials.',
  document.getElementById('settings-current-password')
);
        }
    }

// ===============================
// LOGIN PAGE WIRING (FIXED - no alert focus bug, unlimited retries)
// ===============================
function legacyInit() {
  // ✅ Remove any duplicate/non-functional pagers accidentally inserted in header areas
  try {
    document.querySelectorAll('#cars .header-actions .pager, #items .header-actions .pager, #invoices .header-actions .pager, #suppliers .header-actions .pager, #employees .header-actions .pager').forEach(el => el.remove());
  } catch(e) {}

  const loginButton = document.getElementById('login-button');
  const usernameInput = document.getElementById('login-username');
  const passwordInput = document.getElementById('login-password');
  const errorBox = document.getElementById('login-error');

  // Auto session restore
  const existingUser = getCurrentUser();
  if (existingUser) showApp();
  else showLogin();

  function setError(msg) {
    if (errorBox) errorBox.textContent = msg || '';
  }

  async function doLogin() {
    // Always re-grab elements (defensive)
    const uEl = document.getElementById('login-username');
    const pEl = document.getElementById('login-password');
    const btn = document.getElementById('login-button');

    if (!uEl || !pEl || !btn) {
      console.error('Login inputs/button missing from DOM');
      return;
    }

    // Ensure inputs are usable
    uEl.disabled = false;
    pEl.disabled = false;
    btn.disabled = false;

    const username = (uEl.value || '').trim();
    const password = pEl.value || '';

    if (!username || !password) {
      setError('Please enter username and password.');
      setTimeout(() => {
        if (!username) uEl.focus();
        else pEl.focus();
      }, 0);
      return;
    }

    if (!window.auth || typeof window.auth.login !== 'function') {
      setError('Auth not loaded. Check preload + console.');
      console.error('window.auth.login is missing');
      return;
    }

    let result = null;
    try {
      result = await window.auth.login(username, password);
    } catch (err) {
      console.error('Error in doLogin:', err);
      setError('Login error. Check console.');
      return;
    }

    // ❌ FAIL (no alert -> no focus stealing)
    if (!result) {
      setError('Invalid username or password. Try again.');

      // Ensure no modal overlay blocks clicks
      const modal = document.getElementById('modal');
      if (modal) modal.classList.remove('active');

      // Clear password and reliably restore focus
      pEl.value = '';
      pEl.blur();
      uEl.blur();
      setTimeout(() => {
        window.focus();
        pEl.focus();
        pEl.select?.();
      }, 0);

      return;
    }

    // ✅ SUCCESS
    setError('');
    setCurrentUser(result);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('garage-user-changed', { detail: result }));
    }
    uEl.value = '';
    pEl.value = '';
    showApp();
  }

  if (loginButton) loginButton.addEventListener('click', doLogin);

  // Enter works on BOTH fields
  if (usernameInput) {
    usernameInput.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') doLogin();
    });
  }
  if (passwordInput) {
    passwordInput.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') doLogin();
    });
  }

  // Settings: logo upload/remove wiring
  const logoInput = document.getElementById('settings-logo-file');
  if (logoInput) logoInput.addEventListener('change', handleLogoFileChange);
  const logoRemoveBtn = document.getElementById('settings-logo-remove');
  if (logoRemoveBtn) logoRemoveBtn.addEventListener('click', clearLogo);

  const backupBtn = document.getElementById('backupFolderBtn');
  if (backupBtn) backupBtn.addEventListener('click', selectBackupFolder);
  const backupNowBtn = document.getElementById('backupNowBtn');
  if (backupNowBtn) backupNowBtn.addEventListener('click', backupNow);
  refreshBackupFolderUI();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', legacyInit);
} else {
  setTimeout(legacyInit, 0);
}


    // ===============================
    // DATA STORAGE
    // ===============================


    // ===============================
    // WAREHOUSES + MULTI-QTY INVENTORY
    // ===============================

    // Each warehouse: { id: number, name: string }

    
    

    function getDefaultWarehouseId() {
        ensureWarehouses();
        return warehouses[0] ? warehouses[0].id : null;
    }

    

    // Main-warehouse-only invoicing: invoices can sell ONLY from the Main Warehouse stock
    function getMainWarehouseId() {
        ensureWarehouses();
        const main = (warehouses || []).find(w => String(w.name || '').toLowerCase().includes('main'));
        return main ? main.id : (warehouses[0] ? warehouses[0].id : null);
    }


    // Saadeyat-warehouse helper: imports (and Saadeyat role) must write ONLY to Saadeyat warehouse
    function getSaadeyatWarehouseId() {
        ensureWarehouses();
        const s = (warehouses || []).find(w => String(w.name || '').toLowerCase().includes('saadeyat'));
        return s ? s.id : (warehouses[0] ? warehouses[0].id : null);
    }

    // ======= TRANSFERS (Saadeyat -> Main) =======
    function ensureTransfers() {
        if (!Array.isArray(transfers)) transfers = [];
    }
    function saveTransfers() {
        ensureTransfers();
        dbSetAll('transfers', transfers);
    }

    function openTransferModal() {
        if (getRole() !== 'saadeyat_stock') return;
        ensureTransfers();
        ensureWarehouses();

        const modal = document.getElementById('modal');
        const title = document.getElementById('modalTitle');
        const body  = document.getElementById('modalBody');
        if (!modal || !title || !body) return;

        title.textContent = "📦 Transform to Main Warehouse";
        const opts = (items || [])
            .filter(function(it){ return !isServiceItem(it); })
            .slice()
            .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')))
            .map(it => `<option value="${it.id}">${escapeHtml(it.name || 'Item')} (${escapeHtml(it.partNumber || '-')})</option>`)
            .join('');

        body.innerHTML = `
            <div class="form-group">
                <label>Item</label>
                <select id="transferItemId" style="width:100%; padding:10px;">${opts}</select>
            </div>
            <div class="form-group">
                <label>Quantity to send</label>
                <input id="transferQty" type="number" min="1" value="1" style="width:100%; padding:10px;">
            </div>
            <div class="form-group">
                <label>Note (optional)</label>
                <input id="transferNote" type="text" placeholder="e.g. invoice #, reason..." style="width:100%; padding:10px;">
            </div>
            <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:12px;">
                <button class="btn btn-secondary" type="button" onclick="closeModal()">Cancel</button>
                <button class="btn btn-warning" type="button" onclick="submitTransfer()">Send</button>
            </div>
        `;

        
        modal.classList.add('active');
    }

    function submitTransfer() {
        if (getRole() !== 'saadeyat_stock') return;
        ensureTransfers();
        ensureWarehouses();

        const itemId = document.getElementById('transferItemId')?.value;
        const qty = safeInt(document.getElementById('transferQty')?.value);
        const note = (document.getElementById('transferNote')?.value || '').trim();

        const it = (items || []).find(x => String(x.id) === String(itemId));
        if (!it) { uiError("Item not found."); return; }
        if (qty <= 0) { uiError("Quantity must be at least 1."); return; }

        const fromWid = String(getSaadeyatWarehouseId());
        const toWid   = String(getMainWarehouseId());

        const available = getWarehouseQty(it, fromWid);
        if (qty > available) {
            uiError(`Not enough stock in Saadeyat. Available: ${available}`);
            return;
        }

        // Deduct now from Saadeyat (items are "in transit")
        adjustItemStock(it.id, fromWid, -qty);

        const transfer = {
            id: String(Date.now()) + "-" + String(Math.floor(Math.random()*1000000)),
            itemId: String(it.id),
            qty: qty,
            fromWarehouseId: fromWid,
            toWarehouseId: toWid,
            note: note,
            status: "pending",
            createdAt: new Date().toISOString(),
            createdBy: (getCurrentUser() && getCurrentUser().username) ? getCurrentUser().username : "unknown"
        };
        transfers.push(transfer);

        // persist
        dbSetAll('items', items);
        saveTransfers();

        closeModal();
        renderItems();
        // If main admin is logged in somewhere, keep counts correct for this session too
        updateTransferBadge();
    }

    function toggleNotifications(show) {
        const panel = document.getElementById('notificationsPanel');
        if (!panel) return;
        if (!show) {
            panel.style.display = 'none';
            return;
        }
        panel.style.display = '';
        renderNotifications();
    }

    function renderNotifications() {
        ensureTransfers();
        ensureWarehouses();
        const listEl = document.getElementById('notificationsList');
        const sumEl  = document.getElementById('notificationsSummary');
        if (!listEl || !sumEl) return;

        const mainWid = String(getMainWarehouseId());
        const pending = transfers
            .filter(t => t && t.status === 'pending' && String(t.toWarehouseId) === mainWid)
            .sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));

        sumEl.textContent = pending.length
            ? `You have ${pending.length} pending transfer(s) from Saadeyat.`
            : "No pending transfers.";

        if (!pending.length) {
            listEl.innerHTML = `<div style="color:#666; font-size:14px;">✅ Nothing to receive.</div>`;
            updateTransferBadge();
            return;
        }

        listEl.innerHTML = pending.map(t => {
            const it = (items || []).find(x => String(x.id) === String(t.itemId));
            const name = it ? (it.name || 'Item') : 'Item';
            const pn = it ? (it.partNumber || '-') : '-';
            const when = t.createdAt ? new Date(t.createdAt).toLocaleString() : '';
            const note = t.note ? `<div style="margin-top:6px; color:#666; font-size:13px;"><b>Note:</b> ${escapeHtml(t.note)}</div>` : '';
            return `
                <div style="border:1px solid #eee; border-radius:10px; padding:10px; margin-bottom:10px;">
                    <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;">
                        <div>
                            <div style="font-weight:700;">${escapeHtml(name)} <span style="font-weight:400; color:#666;">(${escapeHtml(pn)})</span></div>
                            <div style="color:#444;">Qty: <b>${t.qty}</b> • From: Saadeyat • ${escapeHtml(when)}</div>
                            ${note}
                        </div>
                        <div style="display:flex; gap:8px; align-items:center;">
                            <button class="btn btn-info" type="button" onclick="receiveTransfer('${t.id}')">Receive</button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        updateTransferBadge();
    }

    function receiveTransfer(transferId) {
        if (getRole() !== 'main_admin') return; // Only Hamdan/Main admin receives
        ensureTransfers();
        ensureWarehouses();

        const t = transfers.find(x => String(x.id) === String(transferId));
        if (!t || t.status !== 'pending') return;

        const it = (items || []).find(x => String(x.id) === String(t.itemId));
        if (!it) { uiError("Item not found for this transfer."); return; }

        const mainWid = String(getMainWarehouseId());
        adjustItemStock(it.id, mainWid, safeInt(t.qty));

        t.status = "received";
        t.receivedAt = new Date().toISOString();
        t.receivedBy = (getCurrentUser() && getCurrentUser().username) ? getCurrentUser().username : "unknown";

        dbSetAll('items', items);
        saveTransfers();

        renderItems();
        renderNotifications();
    }

    function updateTransferBadge() {
        ensureTransfers();
        const btn = document.getElementById('receiveBtn');
        if (!btn) return;
        const mainWid = String(getMainWarehouseId());
        const pendingCount = transfers.filter(t => t && t.status === 'pending' && String(t.toWarehouseId) === mainWid).length;
        btn.textContent = pendingCount ? `Receive (Saadeyat) • ${pendingCount}` : "Receive (Saadeyat)";
    }


    function getWarehouseQty(item, warehouseId) {
        const { quantities } = ensureItemQuantities(item);
        const wid = warehouseId != null ? String(warehouseId) : String(getMainWarehouseId());
        return safeInt(quantities[wid]);
    }
function safeInt(n) {
        const x = parseInt(n);
        return isNaN(x) ? 0 : x;
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    

    // ======= ITEM PRICING HELPERS (cost + selling) =======
    // Keeps backwards compatibility with legacy items that only had "price".
    function ensureItemPricing(item) {
        if (!item || typeof item !== 'object') return item;

        const legacyPrice = (typeof item.price === 'number' && !isNaN(item.price)) ? item.price : 0;
        const selling = (typeof item.sellingPrice === 'number' && !isNaN(item.sellingPrice)) ? item.sellingPrice : legacyPrice;
        const cost = (typeof item.costPrice === 'number' && !isNaN(item.costPrice)) ? item.costPrice : 0;

        item.sellingPrice = selling;
        item.costPrice = cost;

        // Keep "price" as the selling price for old code paths
        item.price = selling;

        return item;
    }

    function formatCostNumber(n) {
        const x = parseFloat(n);
        if (isNaN(x)) return '';
        // show like (4) or (4.5) or (4.50)
        if (Math.abs(x - Math.round(x)) < 1e-9) return String(Math.round(x));
        if (Math.abs(x*10 - Math.round(x*10)) < 1e-9) return (Math.round(x*10)/10).toString();
        return x.toFixed(2);
    }


    // ======= ITEM TAGS (hidden, used for invoice filtering) =======
    function ensureItemTags(item) {
        if (!item || typeof item !== 'object') return item;
        if (Array.isArray(item.tags)) return item;
        if (typeof item.tags === 'string') {
            item.tags = normalizeTagsInput(item.tags);
            return item;
        }
        item.tags = [];
        return item;
    }

function normalizeTagsInput(raw) {
  const s = String(raw || '');

  // split by comma OR semicolon OR any newline (\n or \r\n) OR spaced hyphen " - "
  const parts = s
    .split(/[,\r\n;]+|\s+-\s+/)
    .map(x => x.trim())
    .filter(Boolean);

  const seen = new Set();
  const out = [];

  for (const t of parts) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }

  return out;
}

function normalizeFixedTags(listOrString) {
  if (Array.isArray(listOrString)) {
    return listOrString
      .map(x => String(x || '').trim())
      .filter(Boolean)
      .filter((v, i, arr) => arr.findIndex(x => x.toLowerCase() === v.toLowerCase()) === i);
  }
  return normalizeTagsInput(listOrString);
}

function getFixedTags() {
  const v = dbGetSetting('fixed_tags', []);
  return normalizeFixedTags(v);
}

function setFixedTags(list) {
  dbSetSetting('fixed_tags', normalizeFixedTags(list));
}

function refreshFixedTagsUI() {
  const listEl = document.getElementById('fixedTagsList');
  if (!listEl) return;
  const tags = getFixedTags();
  if (!tags.length) {
    listEl.innerHTML = '<div style="font-size:12px;color:#666;">No tags yet.</div>';
    return;
  }
  listEl.innerHTML = tags.map(function(t) {
    const safe = escapeHtml(t);
    const jsTag = String(t || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return `
      <span style="display:inline-flex; gap:6px; align-items:center; background:#f3f4f6; border:1px solid #e5e7eb; padding:4px 8px; border-radius:999px; margin:4px;">
        <span>${safe}</span>
        <button class="btn btn-danger btn-small" data-admin-disable="1" type="button" onclick="removeFixedTag('${jsTag}')">x</button>
      </span>
    `;
  }).join('');
}

function toggleTagsPanel() {
  const panel = document.getElementById('items-tags-manager');
  if (!panel) return;
  const isHidden = panel.style.display === 'none' || panel.style.display === '';
  panel.style.display = isHidden ? 'block' : 'none';
  if (isHidden) {
    try { refreshFixedTagsUI(); } catch (e) {}
  }
}

function addFixedTag() {
  if (typeof requireItemAdminAction === 'function' && !requireItemAdminAction()) return;
  const input = document.getElementById('fixedTagInput');
  if (!input) return;
  const tag = String(input.value || '').trim();
  if (!tag) return;
  const tags = getFixedTags();
  if (!tags.some(t => t.toLowerCase() === tag.toLowerCase())) {
    tags.push(tag);
    setFixedTags(tags);
  }
  input.value = '';
  refreshFixedTagsUI();
}

function removeFixedTag(tag) {
  if (typeof requireItemAdminAction === 'function' && !requireItemAdminAction()) return;
  const tags = getFixedTags().filter(t => t.toLowerCase() !== String(tag || '').toLowerCase());
  setFixedTags(tags);
  refreshFixedTagsUI();
}

function buildFixedTagOptions(selected) {
  const sel = String(selected || '').trim();
  const tags = getFixedTags();
  return tags.map(function(t) {
    const s = String(t || '');
    const isSel = sel && s.toLowerCase() === sel.toLowerCase();
    return `<option value="${escapeHtml(s)}" ${isSel ? 'selected' : ''}>${escapeHtml(s)}</option>`;
  }).join('');
}

    function itemHasTag(item, tag) {
        const t = String(tag || '').trim();
        if (!t) return true; // no filter
        ensureItemTags(item);
        const needle = t.toLowerCase();
        return (item.tags || []).some(x => String(x || '').trim().toLowerCase() === needle);
    }

    function getAllItemTags() {
        const set = new Set();
        (items || []).forEach(it => {
            ensureItemTags(it);
            (it.tags || []).forEach(t => {
                const v = String(t || '').trim();
                if (v) set.add(v);
            });
        });
        return Array.from(set).sort((a,b) => a.localeCompare(b));
    }

    function getInvoiceTagFilterValue() {
        const sel = document.getElementById('invoiceTagFilter');
        return sel ? String(sel.value || '').trim() : '';
    }

    function onInvoiceTagFilterChange() {
        // refresh all invoice item dropdowns when tag changes
        document.querySelectorAll('#invoiceItems .invoice-item .invoice-item-search').forEach(inp => {
            onRowItemSearch(inp);
        });
        // If there are no rows yet, do nothing
    }


function ensureItemQuantities(item) {
        // New model: item.quantities = { [warehouseId]: qty }
        if (!item || typeof item !== 'object') return { quantities: {}, total: 0 };

        let q = (item.quantities && typeof item.quantities === 'object') ? item.quantities : null;

        // Migration from legacy: item.quantity (single number)
        if (!q) {
            q = {};
            const legacyTotal = safeInt(item.quantity);
            const wid = getSaadeyatWarehouseId();
            if (wid != null) q[String(wid)] = legacyTotal;
        }

        // Remove quantities for deleted warehouses (optional cleanup)
        const allowed = new Set((warehouses || []).map(w => String(w.id)));
        Object.keys(q).forEach(k => { if (!allowed.has(String(k))) delete q[k]; });

        // Ensure all warehouses exist in the map (default 0)
        (warehouses || []).forEach(w => {
            const key = String(w.id);
            if (q[key] === undefined) q[key] = 0;
            q[key] = safeInt(q[key]);
            if (q[key] < 0) q[key] = 0;
        });

        const total = Object.values(q).reduce((a, b) => a + safeInt(b), 0);
        item.quantities = q;
        // Keep item.quantity as cached total for backwards compatibility (but always recompute when saving)
        item.quantity = total;

        return { quantities: q, total };
    }

    function getItemTotalQty(item) {
        return ensureItemQuantities(item).total;
    }

    function adjustItemStock(itemId, warehouseId, delta) {
        const idx = items.findIndex(i => i.id === itemId);
        if (idx === -1) return;
        ensureWarehouses();
        const it = items[idx];
        const { quantities } = ensureItemQuantities(it);
        let wid = warehouseId != null ? String(warehouseId) : String(getDefaultWarehouseId());
        if (getRole && getRole() === 'saadeyat_stock') {
            wid = String(getSaadeyatWarehouseId());
        }
        const cur = safeInt(quantities[wid]);
        let next = cur + safeInt(delta);
        if (next < 0) next = 0;
        quantities[wid] = next;
        // recompute total
        it.quantity = Object.values(quantities).reduce((a, b) => a + safeInt(b), 0);
        it.quantities = quantities;
    }

    

    function isSaadeyatWarehouse(w) {
        const id = String(w && w.id != null ? w.id : '').toLowerCase();
        const name = String(w && w.name != null ? w.name : '').toLowerCase();
        return id === 'saadeyat' || name.includes('saadeyat');
    }

    function refreshWarehouseSettingsUI() {
        const isAdmin = hasPerm('*');
        const list = document.getElementById('warehousesList');
        const nameInput = document.getElementById('newWarehouseName');
        if (!list) return;

        ensureWarehouses();

        list.innerHTML = warehouses.map((w, idx) => {
            const widJs = JSON.stringify(String(w.id));
            const delDisabled = (warehouses.length <= 1 || isSaadeyatWarehouse(w)) ? 'disabled' : '';
            const hint = idx === 0 ? ' <span style="color:#666;font-size:12px;">(default)</span>' : '';
            return `
                <div style="display:flex; gap:8px; align-items:center; margin:6px 0;">
                    <input type="text" value="${String(w.name || '').replace(/"/g,'&quot;')}" 
                           style="flex:1; padding:6px; border:1px solid #ddd; border-radius:4px; font-size:13px;"
                           oninput="updateWarehouseName(${widJs}, this.value)" ${isAdmin ? "" : "disabled"}>
                    <button class="icon-btn delete" title="Delete" type="button" ${delDisabled} ${isAdmin ? "" : "disabled"}
                            onclick="deleteWarehouse(${widJs})">🗑️</button>
                    ${hint}
                </div>
            `;
        }).join('');

        if (nameInput) nameInput.value = '';
    }

    function renderWarehouseQtyFields(item) {
        ensureWarehouses();
        const container = document.getElementById('warehouseQtyFields');
        if (!container) return;

        const { quantities } = ensureItemQuantities(item || {});
        container.innerHTML = (warehouses || []).map(w => {
            const wid = String(w.id);
            const val = safeInt(quantities[wid]);
            return `
                <div style="display:flex; gap:8px; align-items:center; margin:6px 0;">
                    <div style="min-width:160px; font-weight:bold; font-size:13px;">${String(w.name || '')}</div>
                    <input type="number" class="wh-qty" data-wid="${wid}" min="0" value="${val}"
                           style="width:140px;"
                           oninput="updateWarehouseQtyTotalPreview()">
                </div>
            `;
        }).join('');

        // total preview line
        const total = getItemTotalQty(item || {});
        const preview = document.createElement('div');
        preview.id = 'warehouseTotalPreview';
        preview.style.marginTop = '8px';
        preview.style.fontWeight = 'bold';
        preview.textContent = 'Total: ' + total;
        container.appendChild(preview);

        updateWarehouseQtyTotalPreview();
    }

    function updateWarehouseQtyTotalPreview() {
        const container = document.getElementById('warehouseQtyFields');
        const preview = document.getElementById('warehouseTotalPreview');
        if (!container || !preview) return;

        let total = 0;
        container.querySelectorAll('input.wh-qty').forEach(inp => {
            total += safeInt(inp.value);
        });
        preview.textContent = 'Total: ' + total;
    }


    

    function addWarehouse() {
        if (!requireAdminAction()) return;        const input = document.getElementById('newWarehouseName');
        const name = input ? String(input.value || '').trim() : '';
        if (!name) {
            uiError('Please enter a warehouse name.', input);
            return;
        }
        ensureWarehouses();
        warehouses.push({ id: Date.now() + Math.floor(Math.random()*100000), name });
        saveWarehouses();
    }

    function deleteWarehouse(id) {
        if (!requireAdminAction()) return;        ensureWarehouses();
        const target = (warehouses || []).find(w => String(w.id) === String(id));
        if (isSaadeyatWarehouse(target)) {
            uiError('Saadeyat warehouse cannot be deleted.');
            return;
        }
        if (warehouses.length <= 1) {
            uiError('You must keep at least one warehouse.');
            return;
        }

        uiConfirm('Delete this warehouse? Its quantities will be removed from all items.', () => {
            warehouses = warehouses.filter(w => w.id !== id);
            saveWarehouses();
        });
    }

    // Run initial migrations (chunked to avoid UI freeze on large DB)
    function runMigrationsChunked() {
        try { ensureWarehouses(); } catch(e) {}
        let i = 0;
        function step() {
            const end = Math.min(i + 200, items.length);
            for (; i < end; i++) {
                try { ensureItemQuantities(items[i]); } catch(e) {}
            }
            if (i < items.length) {
                setTimeout(step, 0);
            }
        }
        step();
    }
    // Defer to let first paint happen
    setTimeout(runMigrationsChunked, 0);

let editingId = null;
    let currentType = null;

    // search state
    let clientSearchTerm = '';
    let carSearchTerm = '';
    let itemSearchTerm = '';

    // Clients pagination
    let clientPage = 1;
    let clientPageSize = 10;

    // Cars pagination
    let carPage = 1;
    let carPageSize = 10;

    // Items pagination
    let itemPage = 1;
    let itemPageSize = 10;

    // Expenses pagination
    let expensePage = 1;
    let expensePageSize = 10;
    let expenseSearchTerm = '';
    let payrollSearchTerm = '';

    // ======= PERFORMANCE HELPERS =======
    const MAX_ROWS = 10; // ✅ show only first 10 rows (prevents lag)

    // Render-lazy flags (tabs)
var renderedOnce = {
    clients: false,
    cars: false,
    items: false,
    invoices: false,
    suppliers: false,
    employees: false,
    expenses: false
};

    // Fast lookup maps (avoid Array.find in loops)
    var clientById = new Map();
    function rebuildClientIndex() {
        clientById = new Map((clients || []).map(c => [c.id, c]));
    }

var clientCarsSearchIndex = new Map();
function rebuildClientCarsSearchIndex() {
        // Build one searchable string per client from ALL their cars (plate/VIN/chassis/make/model/year)
        clientCarsSearchIndex = new Map();
        try {
            (cars || []).forEach(function(car) {
                if (!car) return;
                const cid = car.clientId;
                if (cid === undefined || cid === null || cid === '') return;

                const parts = [];
                // common fields in your system
                parts.push(car.plate, car.vin, car.make, car.model, car.year);

                // chassis can be stored under different keys depending on older data
                parts.push(car.chassis, car.chassisNb, car.chassisNo, car.chassisNumber);

                const s = parts.filter(function(x){ return x !== undefined && x !== null && String(x).trim() !== ''; })
                               .map(function(x){ return String(x).toLowerCase(); })
                               .join(' ')
                               .trim();

                if (!s) return;

                const prev = clientCarsSearchIndex.get(cid) || '';
                clientCarsSearchIndex.set(cid, (prev ? (prev + ' ') : '') + s);
            });
        } catch(e) {
            console.error(e);
        }
}

function getClientCarsSearchString(clientId) {
    return (clientCarsSearchIndex && clientCarsSearchIndex.get(clientId)) ? String(clientCarsSearchIndex.get(clientId)) : '';
}

var clientCarsLabelMap = new Map();
function rebuildClientCarsLabelMap() {
    clientCarsLabelMap = new Map();
    try {
        (cars || []).forEach(function(car) {
            if (!car) return;
            const cid = car.clientId;
            if (cid === undefined || cid === null || cid === '') return;

            const model = String(car.model || car.make || '').trim();
            const year = String(car.year || '').trim();
            let label = model ? model : 'Car';
            if (year) label = (label + ' ' + year).trim();
            if (!label) return;

            const prev = clientCarsLabelMap.get(cid) || [];
            prev.push(label);
            clientCarsLabelMap.set(cid, prev);
        });
    } catch(e) {
        console.error(e);
    }
}

function getClientCarsLabel(clientId) {
    const list = (clientCarsLabelMap && clientCarsLabelMap.get(clientId)) ? clientCarsLabelMap.get(clientId) : null;
    if (!list || !list.length) return '';
    const seen = {};
    const unique = [];
    list.forEach(function(label) {
        const t = String(label || '').trim();
        if (!t) return;
        if (seen[t]) return;
        seen[t] = true;
        unique.push(t);
    });
    return unique.join(', ');
}

    // Simple debounce (avoid freeze while typing)
    function debounce(fn, wait) {
        let t;
        return function () {
            const ctx = this, args = arguments;
            clearTimeout(t);
            t = setTimeout(function(){ fn.apply(ctx, args); }, wait || 250);
        };
    }

    function limitList(list, searchTerm) {
        // If no search => just first MAX_ROWS (no filtering)
        if (!searchTerm) return (list || []).slice(0, MAX_ROWS);
        // If searching => return only first MAX_ROWS matches (still fast)
        return (list || []).slice(0, MAX_ROWS);
    }

// invoices pagination state
let invoicePage = 1;
let invoicePageSize = 10; // default last 10 invoices per page
let invoiceAPage = 1;
let invoiceAPageSize = 10;
let invoiceSubTab = 'standard';
let itemsSubTab = 'stock';

function isInvoiceA(inv) {
  return inv && String(inv.invoiceType || '').toUpperCase() === 'A';
}

function canUseInvoiceA() {
  try {
    return typeof hasPerm === 'function' ? hasPerm("*") : false;
  } catch (e) {
    return false;
  }
}

function getNextInvoiceANumber() {
  let next = parseInt(dbGetSetting('invoice_a_next_number', ''), 10);
  if (!next || next < 1) {
    let max = 0;
    (invoices || []).forEach(function(inv) {
      if (!isInvoiceA(inv)) return;
      const n = parseInt(inv.invoiceNumber, 10);
      if (!isNaN(n) && n > max) max = n;
    });
    next = max + 1;
  }
  return next;
}

function bumpInvoiceANumber(usedNumber) {
  const next = (parseInt(usedNumber, 10) || 0) + 1;
  dbSetSetting('invoice_a_next_number', next);
}

    // ======= HELPER: INVOICE FINANCIALS =======

    function getInvoiceFinancials(inv) {
        const total = inv && typeof inv.total === 'number' ? inv.total : (inv ? inv.total || 0 : 0);
        let amountPaid;

        if (inv && typeof inv.amountPaid === 'number') {
            amountPaid = inv.amountPaid;
        } else if (inv && inv.paymentStatus === 'paid') {
            amountPaid = total;
        } else {
            amountPaid = 0;
        }

        if (amountPaid < 0) amountPaid = 0;
        if (amountPaid > total) amountPaid = total;

        const remaining = total - amountPaid;
        const status = remaining <= 0 ? 'paid' : 'unpaid';

        return { total, amountPaid, remaining, status };
    }

    // ======= INITIAL RENDER =======
    // ✅ Build indexes then render ONLY the first tab (only when logged in)
    if (getCurrentUser()) {
        try { rebuildClientIndex(); } catch(e) { console.error(e); }
        try { rebuildClientCarsSearchIndex(); } catch(e) { console.error(e); }
        renderedOnce.clients = true;
        renderClients();
        populateReportClientSelect();
        onReportTypeChange(); // set initial filter states
    }

    // ======= TABS =======
    function showTab(tabName, btn) {
        document.querySelectorAll('.tab').forEach(function(t) {
            t.classList.remove('active');
        });
        document.querySelectorAll('.tab-content').forEach(function(c) {
            c.classList.remove('active');
        });
        if (btn) {
            btn.classList.add('active');
        }
        const tab = document.getElementById(tabName);
        if (tab) {
            tab.classList.add('active');
        }
    }
       // ======= TABS =======
function showTab(tabName, btn) {
  // remove active state
  document.querySelectorAll('.tab').forEach(function (t) {
    t.classList.remove('active');
  });
  document.querySelectorAll('.tab-content').forEach(function (c) {
    c.classList.remove('active');
  });

  // hide all pagers (safety)
  document.querySelectorAll('.pager').forEach(function(p){ p.style.display = 'none'; });

  // activate clicked tab button
  if (btn) btn.classList.add('active');

  // activate tab content
  const tab = document.getElementById(tabName);
  if (tab) tab.classList.add('active');

  // show pager for the active tab (if exists)
  try {
    const pager = tab ? tab.querySelector('.pager') : null;
    if (pager) pager.style.display = 'flex';
  } catch(e) {}

  // 🔥 Lazy render heavy tabs (only first time you open them)
  function runOnce(key, fn) {
    if (renderedOnce[key]) return;
    renderedOnce[key] = true;
    setTimeout(function () {
      try { fn(); } catch (e) { console.error(e); }
    }, 0);
  }

  if (tabName === 'clients') {
    runOnce('clients', function () {
      try { rebuildClientIndex(); } catch (e) {}
      try { rebuildClientCarsSearchIndex(); } catch (e) {}
      renderClients();
    });
  } else if (tabName === 'cars') {
    runOnce('cars', renderCars);
  } else if (tabName === 'items') {
    runOnce('items', function () {
      renderItems();
      renderServiceItems();
    });
    setTimeout(function () {
      showItemsSubTab(itemsSubTab || 'stock');
    }, 0);
  } else if (tabName === 'invoices') {
    runOnce('invoices', function () {
      renderInvoices();
      renderInvoiceA();
    });
    setTimeout(function () {
      showInvoiceSubTab(invoiceSubTab || 'standard');
    }, 0);
  } else if (tabName === 'suppliers') {
    runOnce('suppliers', renderSuppliers);
  } else if (tabName === 'employees') {
    runOnce('employees', function () {
      renderEmployees();
      renderPayrollPayments();
    });
  } else if (tabName === 'expenses') {
    runOnce('expenses', renderExpenses);
    // Always refresh totals when switching to Expenses (income/net depends on invoice state)
    setTimeout(function () {
      try { renderExpenses(); } catch (e) {}
    }, 0);
  }
}

function showInvoiceSubTab(type, btn) {
  if (type === 'A' && !canUseInvoiceA()) {
    type = 'standard';
  }
  invoiceSubTab = type;

  document.querySelectorAll('.invoice-subtab').forEach(function(b){ b.classList.remove('active'); });
  if (!btn) {
    const candidates = Array.from(document.querySelectorAll('.invoice-subtab'));
    btn = candidates.find(function(b) {
      const label = String(b.textContent || '').toLowerCase();
      if (type === 'A') return label.includes('invoice a');
      return label === 'invoice';
    }) || null;
  }
  if (btn) btn.classList.add('active');

  document.querySelectorAll('.invoice-subtab-content').forEach(function(c){ c.classList.remove('active'); });
  const standard = document.getElementById('invoiceSubtabStandard');
  const invoiceA = document.getElementById('invoiceSubtabA');
  if (type === 'A') {
    if (invoiceA) invoiceA.classList.add('active');
  } else {
    if (standard) standard.classList.add('active');
  }

  if (type === 'A') renderInvoiceA();
  else renderInvoices();
}

function showItemsSubTab(type, btn) {
  itemsSubTab = type;

  document.querySelectorAll('.items-subtab').forEach(function(b){ b.classList.remove('active'); });
  if (!btn) {
    const candidates = Array.from(document.querySelectorAll('.items-subtab'));
    btn = candidates.find(function(b) {
      const label = String(b.textContent || '').toLowerCase();
      if (type === 'service') return label.includes('non-stock') || label.includes('service');
      return label.includes('stock');
    }) || null;
  }
  if (btn) btn.classList.add('active');

  document.querySelectorAll('.items-subtab-content').forEach(function(c){ c.classList.remove('active'); });
  const stock = document.getElementById('itemsStockSubtab');
  const service = document.getElementById('itemsServiceSubtab');
  const stockPager = document.getElementById('itemsPager');
  const servicePager = document.getElementById('serviceItemsPager');
  if (type === 'service') {
    if (service) service.classList.add('active');
    if (servicePager) servicePager.style.display = 'flex';
    if (stockPager) stockPager.style.display = 'none';
    renderServiceItems();
  } else {
    if (stock) stock.classList.add('active');
    if (stockPager) stockPager.style.display = 'flex';
    if (servicePager) servicePager.style.display = 'none';
    renderItems();
  }
}

    // ======= SEARCH HANDLERS (main tables) =======
    var _clientSearchDebounced = debounce(function (value) {
        clientSearchTerm = (value || '').trim().toLowerCase();
        clientPage = 1;
        renderClients();
    }, 250);

    function onClientSearch(value) {
        _clientSearchDebounced(value);
    }


    // ======= CLIENTS PAGINATION =======
    function setClientPageSize(v) {
        const n = parseInt(v, 10);
        clientPageSize = (isFinite(n) && n > 0) ? n : 10;
        clientPage = 1;
        renderClients();
    }

    function clientPrevPage() {
        if (clientPage > 1) {
            clientPage--;
            renderClients();
        }
    }

    function clientNextPage() {
        const totalPages = getClientsTotalPages();
        if (clientPage < totalPages) {
            clientPage++;
            renderClients();
        }
    }

    function getClientsTotalPages() {
        // recompute based on current search term
        // (same logic as renderClients, including car search)
        try { rebuildClientCarsSearchIndex(); } catch(e) {}
        const total = (clients || []).filter(function(c) {
            if (!clientSearchTerm) return true;
            const name = (c.name || '').toLowerCase();
            const phone = (c.phone || '').toLowerCase();
            const carBlob = getClientCarsSearchString(c.id);
            return name.includes(clientSearchTerm) ||
                   phone.includes(clientSearchTerm) ||
                   (carBlob && carBlob.includes(clientSearchTerm));
        }).length;

        return Math.max(1, Math.ceil(total / clientPageSize));
    }

    
    // ======= CARS PAGINATION =======
    function setCarPageSize(v) {
        const n = parseInt(v, 10);
        carPageSize = (isFinite(n) && n > 0) ? n : 10;
        carPage = 1;
        renderCars();
    }

    function carPrevPage() {
        if (carPage > 1) {
            carPage--;
            renderCars();
        }
    }

    function carNextPage() {
        const totalPages = getCarsTotalPages();
        if (carPage < totalPages) {
            carPage++;
            renderCars();
        }
    }

    function getCarsTotalPages() {
        const total = (cars || []).filter(function(c) {
            if (!carSearchTerm) return true;
            const plate = (c.plate || '').toLowerCase();
            const vin = (c.vin || '').toLowerCase();
            const make = (c.make || '').toLowerCase();
            const model = (c.model || '').toLowerCase();
            const year = (String(c.year || '')).toLowerCase();
            const modelYear = (model + ' ' + year).trim();
            const client = clientById.get(c.clientId);
            const clientName = (client && client.name ? client.name : '').toLowerCase();
            return plate.includes(carSearchTerm) ||
                   vin.includes(carSearchTerm) ||
                   make.includes(carSearchTerm) ||
                   model.includes(carSearchTerm) ||
                   modelYear.includes(carSearchTerm) ||
                   clientName.includes(carSearchTerm);
        }).length;
        return Math.max(1, Math.ceil(total / carPageSize));
    }

    // ======= ITEMS PAGINATION =======
    function setItemPageSize(v) {
        const n = parseInt(v, 10);
        itemPageSize = (isFinite(n) && n > 0) ? n : 10;
        itemPage = 1;
        renderItems();
    }

    function itemPrevPage() {
        if (itemPage > 1) {
            itemPage--;
            renderItems();
        }
    }

    function itemNextPage() {
        const totalPages = getItemsTotalPages();
        if (itemPage < totalPages) {
            itemPage++;
            renderItems();
        }
    }

    function getItemsTotalPages() {
        const total = (items || []).filter(function(i) {
            if (isServiceItem(i)) return false;
            if (!itemSearchTerm) return true;
            const name = (i.name || '').toLowerCase();
            const part = (i.partNumber || '').toLowerCase();
            const bc = (String(i.barcode || '')).toLowerCase();
            return name.includes(itemSearchTerm) || part.includes(itemSearchTerm) || bc.includes(itemSearchTerm);
        }).length;
        return Math.max(1, Math.ceil(total / itemPageSize));
    }
var _carSearchDebounced = debounce(function (value) {
        carSearchTerm = (value || '').trim().toLowerCase();
        carPage = 1;
        renderCars();
    }, 250);

    function onCarSearch(value) {
        _carSearchDebounced(value);
    }

    var _itemSearchDebounced = debounce(function (value) {
        itemSearchTerm = (value || '').trim().toLowerCase();
        itemPage = 1;
        renderItems();
    }, 250);

    function onItemSearch(value) {
        _itemSearchDebounced(value);
    }

    var _serviceItemSearchDebounced = debounce(function (value) {
        serviceItemSearchTerm = (value || '').trim().toLowerCase();
        servicePage = 1;
        renderServiceItems();
    }, 250);

    function onServiceItemSearch(value) {
        _serviceItemSearchDebounced(value);
    }
function focusInvoiceBarcodeInput() {
    const input = document.getElementById('invoice-barcode-input');
    if (input) {
        setTimeout(() => {
            input.focus();
            input.select();
        }, 50);
    }
}
function onInvoiceBarcodeKeydown(e) {
  if (e.key !== 'Enter') return;

  const input = e.target;
  const code = (input.value || '').trim();
  if (!code) return;

  // 1) Find item by barcode
  const item = (items || []).find(i => String(i.barcode || '').trim() === code);
  if (!item) {
    uiError(`Barcode not found: ${code}`);
    input.value = '';
    return;
  }
  if (isServiceItem(item)) {
    uiError(`Barcode belongs to a non-stock item: ${item.name || code}`);
    input.value = '';
    return;
  }

  // 2) Look for existing row already using this item -> qty++
  const rows = Array.from(document.querySelectorAll('.invoice-item'));
  for (const row of rows) {
    const sel = row.querySelector('.invoice-item-select');
    const qtyEl = row.querySelector('.invoice-quantity');

    if (sel && String(sel.value) === String(item.id) && qtyEl) {
      qtyEl.value = (parseInt(qtyEl.value) || 0) + 1;
      calculateTotal();           // your system total function
      input.value = '';
      input.focus();
      return;
    }
  }

  // 3) Not found in rows: put it in the LAST row (or create a row)
  const container = document.getElementById('invoiceItems');
  if (!container) {
    uiError("Invoice items container not found.");
    input.value = '';
    return;
  }

  let lastRow = Array.from(container.querySelectorAll('.invoice-item')).reverse()
    .find(r => r.querySelector('.invoice-item-select'));
  if (!lastRow) {
    // if there are no stock rows at all, create one
    addInvoiceItem();
    lastRow = Array.from(container.querySelectorAll('.invoice-item')).reverse()
      .find(r => r.querySelector('.invoice-item-select'));
  }

  const lastSelect = lastRow ? lastRow.querySelector('.invoice-item-select') : null;
  const lastQty = lastRow ? lastRow.querySelector('.invoice-quantity') : null;

  if (!lastSelect) {
    uiError("Invoice item select not found.");
    input.value = '';
    return;
  }

  // Set item in last row
  lastSelect.value = String(item.id);

  // Trigger the same logic you already use when selecting an item
  // (this will set price/cost/part etc and auto-add a new row if it's the last row)
  onInvoiceItemSelectChange(lastSelect);

  if (lastQty) lastQty.value = 1;

  calculateTotal();
  input.value = '';
  input.focus();
}

    // ======= MODAL OPEN =======
    function openModal(type, id) {
        if (type === 'item' || type === 'serviceItem') {
            if (!requireItemAdminAction()) return;
        } else {
            if (!requireAdminAction()) return;
        }
        if (id === undefined) id = null;
        currentType = type;
        editingId = id;

        const modal = document.getElementById('modal');
        const title = document.getElementById('modalTitle');
        const body = document.getElementById('modalBody');
        const content = modal.querySelector('.modal-content');

// 🔥 IMPORTANT: toggle invoice size
content.classList.remove('invoice-modal');
if (type === 'invoice' || type === 'invoiceA') {
    content.classList.add('invoice-modal');
}


        title.textContent = (id ? 'Edit ' : 'Add ') + type.charAt(0).toUpperCase() + type.slice(1);

        if (type === 'client') {
            const client = id ? clients.find(function(c) { return c.id === id; }) : {};
            body.innerHTML = `
                <div class="form-group">
                    <label>Name</label>
                    <input type="text" id="name" value="${client && client.name ? client.name : ''}" required>
                </div>
                <div class="form-group">
                    <label>Phone</label>
                    <input type="tel" id="phone" value="${client && client.phone ? client.phone : ''}" required>
                </div>
                <div class="form-group">
                    <label>Email</label>
                    <input type="email" id="email" value="${client && client.email ? client.email : ''}">
                </div>
                <div class="form-group">
                    <label>Address</label>
                    <input type="text" id="address" value="${client && client.address ? client.address : ''}">
                </div>
                <div class="modal-footer">
                    <button class="btn btn-primary" onclick="saveClient()">Save</button>
                    <button class="btn" onclick="closeModal()">Cancel</button>
                </div>
            `;
        } else if (type === 'car') {
            const car = id ? cars.find(function(c) { return c.id === id; }) : {};
            const clientOptions = buildClientOptionsLimited(car && car.clientId != null ? car.clientId : null, 20);
body.innerHTML = `
                <div class="form-group">
                    <label>Client</label>
                    <input type="text" id="carClientSearch" placeholder="Search client by name or phone..." oninput="filterCarClientOptions(this.value)">
                    <select id="clientId" onchange="onCarClientSelectChange()" required>
                        <option value="">Select Client</option>
                        ${clientOptions}
                    </select>
                </div>
                <div class="form-group">
                    <label>Make</label>
                    <input type="text" id="make" value="${car && car.make ? car.make : ''}" required>
                </div>
                <div class="form-group">
                    <label>Model</label>
                    <input type="text" id="model" value="${car && car.model ? car.model : ''}" required>
                </div>
                <div class="form-group">
                    <label>Year</label>
                    <input type="text" id="year" value="${car && car.year ? car.year : ''}" required>
                </div>
                <div class="form-group">
                    <label>License Plate</label>
                    <input type="text" id="plate" value="${car && car.plate ? car.plate : ''}" required>
                </div>
                <div class="form-group">
                    <label>VIN</label>
                    <input type="text" id="vin" value="${car && car.vin ? car.vin : ''}">
                </div>
                <div class="modal-footer">
                    <button class="btn btn-primary" onclick="saveCar()">Save</button>
                    <button class="btn" onclick="closeModal()">Cancel</button>
                </div>
            `;
        } else if (type === 'item') {
            const item = id ? items.find(function(i) { return i.id === id; }) : {};
            body.innerHTML = `
                <div class="form-group">
                    <label>Item/Service Name</label>
                    <input type="text" id="itemName" value="${item && item.name ? item.name : ''}" required>
                </div>
                <div class="form-group">
                    <label>Part Number</label>
                    <input type="text" id="itemPartNumber" value="${item && item.partNumber ? item.partNumber : ''}" placeholder="e.g. 123-ABC">
                </div>
                <div class="form-group">
                    <label>Barcode</label>
                    <input type="text" id="itemBarcode" value="${item && item.barcode ? String(item.barcode) : ''}" placeholder="Scan or type barcode">
                    <div style="font-size:12px;color:#666;margin-top:4px;">Tip: click this field then scan with your USB barcode scanner.</div>
                </div>
                <div class="form-group">
                    <label>Location</label>
                    <input type="text" id="itemLocation" value="${item && item.location ? item.location : ''}" placeholder="e.g. Shelf A3">
                </div>
                <div class="form-group">
                    <label>Selling Price</label>
                    <input type="number" step="0.01" id="sellingPrice" value="${item && (typeof item.sellingPrice === 'number' ? item.sellingPrice : (typeof item.price === 'number' ? item.price : ''))}" required>
                </div>
                ${hasPerm("*") ? `
                <div class="form-group">
                    <label>Cost Price (Admin only)</label>
                    <input type="number" step="0.01" id="costPrice" value="${item && typeof item.costPrice === 'number' ? item.costPrice : ''}">
                </div>
                
                <div class="form-group">
                    <label>Tag</label>
                    <select id="itemTagSelect">
                        <option value="">No Tag</option>
                        ${buildFixedTagOptions(item && Array.isArray(item.tags) ? item.tags[0] : (item && item.tags ? item.tags : ''))}
                    </select>
                    <div style="font-size:12px;color:#666;margin-top:4px;">Tags are managed in the Items tab.</div>
                </div>
` : ``}
                <div class="form-group">
                    <label>Quantities per Warehouse</label>
                    <div id="warehouseQtyFields"></div>
                    <div style="font-size:12px; color:#666; margin-top:6px;">
                        Total quantity is auto-calculated from warehouses.
                    </div>
                </div>
                <div class="form-group">
                    <label>Low Stock Alert (Red Flag When Below)</label>
                    <input type="number" id="lowStockThreshold" value="${item && typeof item.lowStockThreshold === 'number' ? item.lowStockThreshold : 5}" min="0">
                </div>
                <div class="form-group">
                    <label>Photo URL</label>
                    <input type="text" id="itemPhotoUrl" value="${item && item.photoUrl ? item.photoUrl : ''}" placeholder="https://...">
                </div>
                <div class="form-group">
                    <label>Description</label>
                    <textarea id="description" rows="3">${item && item.description ? item.description : ''}</textarea>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-primary" onclick="saveItem()">Save</button>
                    <button class="btn" onclick="closeModal()">Cancel</button>
                </div>
            `;
            renderWarehouseQtyFields(item);
        } else if (type === 'serviceItem') {
            const service = id ? serviceItems.find(function(s) { return s.id === id; }) : {};
            body.innerHTML = `
                <div class="form-group">
                    <label>Service Code</label>
                    <input type="text" id="serviceItemCode" value="${service && service.code ? service.code : ''}">
                </div>
                <div class="form-group">
                    <label>Service Name</label>
                    <input type="text" id="serviceItemName" value="${service && service.name ? service.name : ''}" required>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-primary" onclick="saveServiceItem()">Save</button>
                    <button class="btn" onclick="closeModal()">Cancel</button>
                </div>
            `;
        } else if (type === 'supplier') {
            const supplier = id ? suppliers.find(function(s) { return s.id === id; }) : {};
            body.innerHTML = `
                <div class="form-group">
                    <label>Supplier Name</label>
                    <input type="text" id="supplierName" value="${supplier && supplier.name ? supplier.name : ''}" required>
                </div>
                <div class="form-group">
                    <label>Phone</label>
                    <input type="tel" id="supplierPhone" value="${supplier && supplier.phone ? supplier.phone : ''}">
                </div>
                <div class="form-group">
                    <label>Email</label>
                    <input type="email" id="supplierEmail" value="${supplier && supplier.email ? supplier.email : ''}">
                </div>
                <div class="form-group">
                    <label>Company</label>
                    <input type="text" id="supplierCompany" value="${supplier && supplier.company ? supplier.company : ''}">
                </div>
                <div class="form-group">
                    <label>Notes</label>
                    <textarea id="supplierNotes" rows="3">${supplier && supplier.notes ? supplier.notes : ''}</textarea>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-primary" onclick="saveSupplier()">Save</button>
                    <button class="btn" onclick="closeModal()">Cancel</button>
                </div>
            `;
        } else if (type === 'employee') {
            const employee = id ? employees.find(function(e) { return e.id === id; }) : {};
            body.innerHTML = `
                <div class="form-group">
                    <label>Employee Name</label>
                    <input type="text" id="employeeName" value="${employee && employee.name ? employee.name : ''}" required>
                </div>
                <div class="form-group">
                    <label>Phone</label>
                    <input type="tel" id="employeePhone" value="${employee && employee.phone ? employee.phone : ''}">
                </div>
                <div class="form-group">
                    <label>Email</label>
                    <input type="email" id="employeeEmail" value="${employee && employee.email ? employee.email : ''}">
                </div>
                <div class="form-group">
                    <label>Role</label>
                    <input type="text" id="employeeRole" value="${employee && employee.role ? employee.role : ''}" placeholder="Mechanic, Electrician, etc.">
                </div>
                <div class="form-group">
                    <label>Weekly Salary</label>
                    <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                        <input type="number" step="0.01" id="employeeWeeklyUsd" value="${employee && employee.weeklySalaryUsd != null ? employee.weeklySalaryUsd : ''}" placeholder="$">
                        <span style="opacity:0.7;">$</span>
                        <input type="number" step="1" id="employeeWeeklyLbp" value="${employee && employee.weeklySalaryLbp != null ? employee.weeklySalaryLbp : ''}" placeholder="L.L">
                        <span style="opacity:0.7;">L.L</span>
                    </div>
                </div>
                <div class="form-group">
                    <label>Notes</label>
                    <textarea id="employeeNotes" rows="3">${employee && employee.notes ? employee.notes : ''}</textarea>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-primary" onclick="saveEmployee()">Save</button>
                    <button class="btn" onclick="closeModal()">Cancel</button>
                </div>
            `;
        } else if (type === 'payroll') {
            const payroll = id ? payrollPayments.find(function(p) { return p.id === id; }) : {};
            const today = new Date().toISOString().split('T')[0];
            const employeeOptions = (employees || []).map(function(e) {
                return `<option value="${e.id}" ${payroll && String(payroll.employeeId) === String(e.id) ? 'selected' : ''}>${e.name}</option>`;
            }).join('');
            const weeklyEnd = weeklyPayrollContext && weeklyPayrollContext.weekEnding ? weeklyPayrollContext.weekEnding : (payroll && payroll.weekEnding ? payroll.weekEnding : '');
            body.innerHTML = `
                <div class="form-group">
                    <label>Date</label>
                    <input type="date" id="payrollDate" value="${payroll && payroll.date ? payroll.date : (weeklyEnd || today)}" required>
                </div>
                <div class="form-group">
                    <label>Employee</label>
                    <select id="payrollEmployeeId" required onchange="onPayrollEmployeeChange()">
                        <option value="">Select Employee</option>
                        ${employeeOptions}
                    </select>
                </div>
                ${weeklyEnd ? `
                <div class="form-group">
                    <label>Week Ending (Saturday)</label>
                    <input type="date" id="payrollWeekEnding" value="${weeklyEnd}">
                </div>
                ` : `<input type="hidden" id="payrollWeekEnding" value="${weeklyEnd}">`}
                <div class="form-group">
                    <label>Base Salary Paid</label>
                    <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                        <input type="number" step="0.01" id="payrollBaseUsd" value="${payroll && payroll.baseUsd != null ? payroll.baseUsd : ''}" placeholder="$">
                        <span style="opacity:0.7;">$</span>
                        <input type="number" step="1" id="payrollBaseLbp" value="${payroll && payroll.baseLbp != null ? payroll.baseLbp : ''}" placeholder="L.L">
                        <span style="opacity:0.7;">L.L</span>
                    </div>
                </div>
                <div class="form-group">
                    <label>Bonus</label>
                    <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                        <input type="number" step="0.01" id="payrollBonusUsd" value="${payroll && payroll.bonusUsd != null ? payroll.bonusUsd : ''}" placeholder="$">
                        <span style="opacity:0.7;">$</span>
                        <input type="number" step="1" id="payrollBonusLbp" value="${payroll && payroll.bonusLbp != null ? payroll.bonusLbp : ''}" placeholder="L.L">
                        <span style="opacity:0.7;">L.L</span>
                    </div>
                </div>
                <div class="form-group">
                    <label>Notes</label>
                    <textarea id="payrollNotes" rows="3">${payroll && payroll.notes ? payroll.notes : ''}</textarea>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-primary" onclick="savePayrollPayment()">Save</button>
                    <button class="btn" onclick="closeModal()">Cancel</button>
                </div>
            `;
            if (!id) {
                setTimeout(function() {
                    try { onPayrollEmployeeChange(); } catch(e) {}
                }, 0);
            }
        } else if (type === 'expense') {
            const expense = id ? expenses.find(function(e) { return e.id === id; }) : {};
            const today = new Date().toISOString().split('T')[0];
            body.innerHTML = `
                <div class="form-group">
                    <label>Date</label>
                    <input type="date" id="expenseDate" value="${expense && expense.date ? expense.date : today}" required>
                </div>
                <div class="form-group">
                    <label>Category</label>
                    <input type="text" id="expenseCategory" value="${expense && expense.category ? expense.category : ''}" placeholder="Rent, Parts, Fuel..." required>
                </div>
                <div class="form-group">
                    <label>Vendor</label>
                    <input type="text" id="expenseVendor" value="${expense && expense.vendor ? expense.vendor : ''}" placeholder="Supplier or store">
                </div>
                <div class="form-group">
                    <label>Amount</label>
                    <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                        <input type="number" step="0.01" id="expenseAmount" value="${expense && expense.amount != null ? expense.amount : ''}" required>
                        <select id="expenseCurrency">
                            <option value="USD" ${expense && expense.currency === 'USD' ? 'selected' : ''}>$</option>
                            <option value="LBP" ${expense && expense.currency === 'LBP' ? 'selected' : ''}>L.L</option>
                        </select>
                    </div>
                </div>
                <div class="form-group">
                    <label>Payment Method</label>
                    <input type="text" id="expenseMethod" value="${expense && expense.paymentMethod ? expense.paymentMethod : ''}" placeholder="Cash, Bank, Card">
                </div>
                <div class="form-group">
                    <label>Notes</label>
                    <textarea id="expenseNotes" rows="3">${expense && expense.notes ? expense.notes : ''}</textarea>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-primary" onclick="saveExpense()">Save</button>
                    <button class="btn" onclick="closeModal()">Cancel</button>
                </div>
            `;
        } else if (type === 'invoiceA') {
            const today = new Date().toISOString().split('T')[0];
            title.textContent = id ? 'Edit Invoice A' : 'Add Invoice A';
            const invoice = id
                ? invoices.find(function(i) { return i.id === id; })
                : { items: [], date: today, invoiceType: 'A' };

            const clientOptions = buildClientOptionsLimited(invoice && invoice.clientId != null ? invoice.clientId : null, 60);
            const client = invoice && invoice.clientId ? clients.find(function(c) { return c.id === invoice.clientId; }) : null;
            const car = invoice && invoice.carId ? cars.find(function(c) { return c.id === invoice.carId; }) : null;
            const invoiceNumberPreview = invoice && invoice.invoiceNumber ? invoice.invoiceNumber : getNextInvoiceANumber();
            const tvaDefault = (invoice && typeof invoice.tvaDefault === 'boolean')
                ? invoice.tvaDefault
                : ((invoice && Array.isArray(invoice.items) && invoice.items.length > 0)
                    ? invoice.items.every(function(it){ return it && it.tva === true; })
                    : false);

            body.innerHTML = `
                <div class="invoice-a-form">
                    <div class="invoice-a-top">
                        <div class="invoice-a-left">
                            <div class="form-group">
                                <label>Client</label>
                                <div class="invoice-a-client-picker">
                                    <input type="text" id="invoiceAClientSearch" placeholder="Search client by name or phone..."
                                        oninput="filterInvoiceAClientOptions(this.value)" onfocus="filterInvoiceAClientOptions(this.value)" onblur="onClientSearchBlur(this)">
                                    <input type="hidden" id="invoiceAClientId" value="${invoice && invoice.clientId != null ? invoice.clientId : ''}">
                                    <div class="client-dropdown"></div>
                                </div>
                            </div>
                            <div class="form-group">
                                <label>Phone</label>
                                <input type="text" id="invoiceAClientPhone" value="${client && client.phone ? client.phone : ''}" disabled>
                            </div>
                        </div>
                        <div class="invoice-a-right">
                            <div class="form-group">
                                <label>Invoice No</label>
                                <input type="text" id="invoiceANumber" value="${invoiceNumberPreview || ''}" disabled>
                            </div>
                            <div class="form-group">
                                <label>TVA Registration No</label>
                                <input type="text" id="invoiceATvaReg" value="${invoice && invoice.tvaRegNo != null ? invoice.tvaRegNo : getInvoiceTvaRegNo()}">
                            </div>
                        </div>
                    </div>

                    <div class="invoice-a-grid">
                        <div class="form-group">
                            <label>Car (Optional)</label>
                            <input type="text" id="invoiceACarSearch" placeholder="Search car by plate, model, year..." oninput="filterInvoiceACarOptions()">
                            <select id="invoiceACarId" onchange="onInvoiceACarSelectChange(this.value)">
                                <option value="">Select Car</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Registration</label>
                            <input type="text" id="invoiceARegistration" value="${car && car.plate ? car.plate : ''}" disabled>
                        </div>
                        <div class="form-group">
                            <label>Chassis No</label>
                            <input type="text" id="invoiceAChassis" value="${car && car.vin ? car.vin : ''}" disabled>
                        </div>
                        <div class="form-group">
                            <label>Fiscal Reg</label>
                            <input type="text" id="invoiceAFiscalReg" value="${invoice && invoice.fiscalReg ? invoice.fiscalReg : ''}">
                        </div>
                        <div class="form-group">
                            <label>Invoice Date</label>
                            <input type="date" id="invoiceADate" value="${invoice && invoice.date ? invoice.date : today}" required>
                        </div>
                    </div>

                    <div class="invoice-a-tools">
                        <label style="display:flex; align-items:center; gap:6px;">
                            <input type="checkbox" id="invoiceATvaDefault" ${tvaDefault ? 'checked' : ''} onchange="toggleInvoiceATvaDefault(this.checked)">
                            TVA (11%)
                        </label>
                        <button class="btn btn-primary" type="button" onclick="addInvoiceAItem()">+ Add New Item</button>
                        <button class="btn btn-warning" type="button" onclick="addCustomInvoiceAItem()">+ Add Custom Item</button>
                        <button class="btn btn-secondary" type="button" onclick="addServiceInvoiceAItem()">+ Add Service Item</button>
                    </div>

                    <div class="invoice-a-items">
                        <table>
                            <thead>
                                <tr>
                                    <th style="width:30%;">Description</th>
                                    <th style="width:10%;">Price($)</th>
                                    <th style="width:8%;">Qty</th>
                                    <th style="width:8%;">TVA (11%)</th>
                                    <th style="width:12%;">Total($)</th>
                                    <th style="width:14%;">Employee</th>
                                    <th style="width:14%;">Supplier</th>
                                    <th style="width:6%;">Delete</th>
                                </tr>
                            </thead>
                            <tbody id="invoiceAItems"></tbody>
                        </table>
                    </div>

                    <div class="total">Total: $<span id="invoiceATotal">0.00</span></div>
                    <div class="form-group">
                        <label>Amount Paid</label>
                        <input type="number" id="invoiceAAmountPaid" step="0.01" min="0" value="0" oninput="onInvoiceAAmountPaidChange()">
                    </div>
                    <div class="form-group">
                        <label>Remaining</label>
                        <input type="text" id="invoiceARemaining" readonly value="0.00">
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-primary" onclick="saveInvoiceA()">Save</button>
                        <button class="btn" onclick="closeModal()">Cancel</button>
                    </div>
                </div>
            `;

            const amountPaidInput = document.getElementById('invoiceAAmountPaid');
            if (amountPaidInput) {
                let initialPaid = 0;
                if (invoice && invoice.id) {
                    const financials = getInvoiceFinancials(invoice);
                    initialPaid = financials.amountPaid;
                }
                amountPaidInput.value = initialPaid;
            }

            if (invoice && invoice.clientId) {
                const clientIdInput = document.getElementById('invoiceAClientId');
                const clientSearch = document.getElementById('invoiceAClientSearch');
                const cid = String(invoice.clientId);
                if (clientIdInput) clientIdInput.value = cid;
                if (clientSearch) {
                    const cl = (Array.isArray(clients) ? clients : []).find(function(x){ return String(x.id) === cid; });
                    const label = cl ? (cl.phone ? (cl.name + ' - ' + cl.phone) : (cl.name || ('Client #' + cid))) : ('Client #' + cid);
                    clientSearch.value = label;
                    clientSearch.setAttribute('data-client-name', label);
                }
                onInvoiceAClientChange();
                if (invoice.carId) {
                    updateInvoiceACarOptions(invoice.carId);
                }
            } else {
                updateInvoiceACarOptions();
            }

            if (invoice && invoice.items && invoice.items.length > 0) {
                invoice.items.forEach(function(item) {
                    if (item.itemId) {
                        addInvoiceAItem(item);
                    } else if (item.serviceItemId) {
                        addServiceInvoiceAItem(item);
                    } else {
                        addCustomInvoiceAItem(item);
                    }
                });
            }

            if (!invoice.items || invoice.items.length === 0) {
                addInvoiceAItem();
            }

            calculateInvoiceATotal();
        } else if (type === 'invoice') {
            const invoice = id
                ? invoices.find(function(i) { return i.id === id; })
                : { items: [], date: new Date().toISOString().split('T')[0] };

            const clientOptions = buildClientOptionsLimited(invoice && invoice.clientId != null ? invoice.clientId : null, 60);
const tagOptions = getFixedTags().map(function(t) {
                return '<option value="' + String(t).replace(/"/g,'&quot;') + '">' + t + '</option>';
            }).join('');

            body.innerHTML = `
                <div class="form-group">
                    <label>Date</label>
                    <input type="date" id="invoiceDate" value="${invoice.date || ''}" required>
                </div>
                <div class="form-group">
                    <label>Client</label>
                    <div class="invoice-client-picker">
                        <input type="text" id="invoiceClientSearch" placeholder="Search client by name or phone..."
                            oninput="filterInvoiceClientOptions(this.value)" onfocus="filterInvoiceClientOptions(this.value)" onblur="onClientSearchBlur(this)">
                        <input type="hidden" id="invoiceClientId" value="${invoice && invoice.clientId != null ? invoice.clientId : ''}">
                        <div class="client-dropdown"></div>
                    </div>
                </div>
                <div class="form-group">
                    <label>Car (Optional)</label>
                    <input type="text" id="invoiceCarSearch" placeholder="Search car by plate, model, year..." oninput="filterInvoiceCarOptions()">
                    <select id="invoiceCarId" onchange="onInvoiceCarSelectChange(this.value)">
                        <option value="">Select Car</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Tag Filter (optional)</label>
                    <select id="invoiceTagFilter" onchange="onInvoiceTagFilterChange()">
                        <option value="">All Tags</option>
                        ${tagOptions}
                    </select>
                    <div style="font-size:12px;color:#666;margin-top:4px;">Choose a tag to show only matching stock items in the invoice item dropdowns.</div>
                </div>
                
                <div class="form-group">
                    <label>Scan Barcode (optional)</label>
                    <input type="text" id="invoiceBarcodeScan" placeholder="Click here and scan barcode..." onkeydown="onInvoiceBarcodeKeydown(event)" autocomplete="off">
                    <div style="font-size:12px;color:#666;margin-top:4px;">Your USB scanner will type the code then press Enter. This will auto-add the item.</div>
                </div>
                <div class="form-group">
                    <label>Items</label>
                    <div id="invoiceItems" class="invoice-items"></div>
                    <button class="btn btn-primary" type="button" onclick="addInvoiceItem()">+ Add Stock Item</button>
                    <button class="btn btn-warning" type="button" onclick="addCustomInvoiceItem()">+ Add Custom Item</button>
                    <button class="btn btn-secondary" type="button" onclick="addServiceInvoiceItem()">+ Add Service Item</button>
                </div>
                <div class="form-group">
                    <label>Notes</label>
                    <textarea id="notes" rows="3">${invoice && invoice.notes ? invoice.notes : ''}</textarea>
                </div>
                <div class="total">Total: $<span id="invoiceTotal">0.00</span></div>
                <div class="form-group">
                    <label>Amount Paid</label>
                    <input type="number" id="amountPaid" step="0.01" min="0" value="0" oninput="onAmountPaidChange()">
                </div>
                <div class="form-group">
                    <label>Remaining</label>
                    <input type="text" id="remainingDisplay" readonly value="0.00">
                </div>
                <div class="modal-footer">
                    <button class="btn btn-primary" onclick="saveInvoice()">Save</button>
                    <button class="btn" onclick="closeModal()">Cancel</button>
                </div>
            `;

            const amountPaidInput = document.getElementById('amountPaid');
            if (amountPaidInput) {
                let initialPaid = 0;
                if (invoice && invoice.id) {
                    const financials = getInvoiceFinancials(invoice);
                    initialPaid = financials.amountPaid;
                }
                amountPaidInput.value = initialPaid;
            }

            if (invoice && invoice.clientId) {
                const clientIdInput = document.getElementById('invoiceClientId');
                const clientSearch = document.getElementById('invoiceClientSearch');
                const cid = String(invoice.clientId);
                if (clientIdInput) clientIdInput.value = cid;
                if (clientSearch) {
                    const cl = (Array.isArray(clients) ? clients : []).find(function(x){ return String(x.id) === cid; });
                    const label = cl ? (cl.phone ? (cl.name + ' - ' + cl.phone) : (cl.name || ('Client #' + cid))) : ('Client #' + cid);
                    clientSearch.value = label;
                    clientSearch.setAttribute('data-client-name', label);
                }
                if (invoice.carId) {
                    updateCarOptions(invoice.carId);
                } else {
                    updateCarOptions();
                }
            } else {
                updateCarOptions();
            }

            if (invoice && invoice.items && invoice.items.length > 0) {
                invoice.items.forEach(function(item) {
                    if (item.itemId) {
                        addInvoiceItem(item);
                    } else if (item.serviceItemId) {
                        addServiceInvoiceItem(item);
                    } else {
                        addCustomInvoiceItem(item);
                    }
                });
            }

            if (!invoice.items || invoice.items.length === 0) {
                addInvoiceItem();
            }

            calculateTotal();
        }

        if (type === 'invoice') { setTimeout(focusInvoiceBarcodeInput, 60); }
        modal.classList.add('active');
    }

    
function closeAlertModal() {
  const modal = document.getElementById('alertModal');
  if (modal) modal.classList.remove('active');
}

function closeModal() {
    const modal = document.getElementById('modal');
    const content = modal.querySelector('.modal-content');

    modal.classList.remove('active');
    content.classList.remove('invoice-modal'); // 🔥 important

    editingId = null;
    currentType = null;
    weeklyPayrollContext = null;
}


    // ======= SAVE FUNCTIONS =======

    function saveClient() {
        if (!requireAdminAction()) return;        const data = {
            name: document.getElementById('name').value.trim(),
            phone: document.getElementById('phone').value.trim(),
            email: document.getElementById('email').value.trim(),
            address: document.getElementById('address').value.trim()
        };
        
        if (!data.name || !data.phone) {
            uiError('Client name and phone are required.', document.getElementById('name'));
            return;
        }
        
        if (editingId) {
            const index = clients.findIndex(function(c) { return c.id === editingId; });
            clients[index] = { ...clients[index], ...data, id: editingId };
        } else {
            clients.push({ ...data, id: Date.now() });
        }
        
                dbSetAll('clients', clients);
rebuildInvoiceClientCache();
renderClients();
        populateReportClientSelect();
        closeModal();
    }

    function saveCar() {
        if (!requireAdminAction()) return;        const data = {
            clientId: parseInt(document.getElementById('clientId').value),
            make: document.getElementById('make').value.trim(),
            model: document.getElementById('model').value.trim(),
            year: document.getElementById('year').value.trim(),
            plate: document.getElementById('plate').value.trim(),
            vin: document.getElementById('vin').value.trim()
        };
        
        if (!data.clientId || !data.make || !data.model) {
            uiError(
  'Client, make, and model are required.',
  document.getElementById('make')
);
            return;
        }
        
        if (editingId) {
            const index = cars.findIndex(function(c) { return c.id === editingId; });
            cars[index] = { ...cars[index], ...data, id: editingId };
        } else {
            cars.push({ ...data, id: Date.now() });
        }
        
                dbSetAll('cars', cars);
renderCars();
        closeModal();
    }

    function saveItem() {
        if (!requireItemAdminAction()) return;        ensureWarehouses();

        const sellingVal = document.getElementById('sellingPrice').value;
        const costEl = document.getElementById('costPrice');
        const costVal = costEl ? costEl.value : '';

        const tagSelect = document.getElementById('itemTagSelect');
        const tagVal = tagSelect ? String(tagSelect.value || '').trim() : '';
        // Collect per-warehouse quantities from modal inputs
        const quantities = {};
        let totalQty = 0;

        document.querySelectorAll('#warehouseQtyFields input.wh-qty').forEach(function(inp) {
            const wid = String(inp.getAttribute('data-wid'));
            const q = safeInt(inp.value);
            quantities[wid] = q;
            totalQty += q;
        });

        const data = {
            name: document.getElementById('itemName').value.trim(),
            partNumber: document.getElementById('itemPartNumber').value.trim(),
            barcode: (document.getElementById('itemBarcode') ? document.getElementById('itemBarcode').value.trim() : ''),
            location: document.getElementById('itemLocation').value.trim(),

            sellingPrice: parseFloat(sellingVal),
            costPrice: parseFloat(costVal),

            tags: tagVal ? [tagVal] : [],


            // Backwards compatible: "price" is the selling price everywhere else
            price: parseFloat(sellingVal),

            quantities: quantities,             // ✅ per-warehouse
            quantity: totalQty,                 // ✅ cached total for old code/exports
            lowStockThreshold: parseInt(document.getElementById('lowStockThreshold').value) || 5,
            photoUrl: document.getElementById('itemPhotoUrl').value.trim(),
            description: document.getElementById('description').value.trim()
        };

        // ✅ Barcode uniqueness check (recommended)
        const bc = String(data.barcode || '').trim();
        if (bc) {
            const duplicate = (items || []).find(function(it) {
                if (!it) return false;
                if (editingId && it.id === editingId) return false;
                return String(it.barcode || '').trim() === bc;
            });
            if (duplicate) {
                uiError('This barcode is already used by another item: ' + (duplicate.name || duplicate.partNumber || duplicate.id));
                return;
            }
        }


        ensureItemPricing(data);

        ensureItemTags(data);

        if (!data.name || isNaN(data.sellingPrice)) {
            uiError('Item name and selling price are required.', document.getElementById('itemName'));
            return;
        }

        // Non-admins should never set cost
        if (!hasItemAdminAccess()) {
            delete data.costPrice;
            delete data.tags;
        }

        if (editingId) {
            const index = items.findIndex(function(i) { return i.id === editingId; });
            items[index] = { ...items[index], ...data, id: editingId };
            ensureItemQuantities(items[index]);
        } else {
            const newItem = { ...data, id: Date.now() };
            ensureItemQuantities(newItem);
            items.push(newItem);
        }

                dbSetAll('items', items);
        rebuildBarcodeIndex();
renderItems();
        closeModal();
    }

    function saveServiceItem() {
        if (!requireItemAdminAction()) return;

        const code = (document.getElementById('serviceItemCode')?.value || '').trim();
        const name = (document.getElementById('serviceItemName')?.value || '').trim();
        if (!name) {
            uiError('Service name is required.', document.getElementById('serviceItemName'));
            return;
        }

        const data = { name: name, code: code, isService: true };

        if (editingId) {
            const index = items.findIndex(function(i) { return i.id === editingId; });
            if (index !== -1) {
                items[index] = { ...items[index], ...data, id: editingId };
            }
        } else {
            const newItem = {
                ...data,
                id: Date.now(),
                sellingPrice: 0,
                costPrice: 0,
                price: 0,
                quantity: 0,
                quantities: {},
                lowStockThreshold: 0
            };
            ensureItemPricing(newItem);
            ensureItemQuantities(newItem);
            items.push(newItem);
        }

        dbSetAll('items', items);
        syncServiceItemsFromItems();
        renderServiceItems();
        closeModal();
    }

    function saveSupplier() {
        if (!requireAdminAction()) return;        const data = {
            name: document.getElementById('supplierName').value.trim(),
            phone: document.getElementById('supplierPhone').value.trim(),
            email: document.getElementById('supplierEmail').value.trim(),
            company: document.getElementById('supplierCompany').value.trim(),
            notes: document.getElementById('supplierNotes').value.trim()
        };

        if (!data.name) {
            uiError('Supplier name is required.',
  document.getElementById('supplierName')
);
            return;
        }

        if (editingId) {
            const index = suppliers.findIndex(function(s) { return s.id === editingId; });
            suppliers[index] = { ...suppliers[index], ...data, id: editingId };
        } else {
            suppliers.push({ ...data, id: Date.now() });
        }

                dbSetAll('suppliers', suppliers);
renderSuppliers();
        closeModal();
    }

function saveEmployee() {
        if (!requireAdminAction()) return;        const data = {
            name: document.getElementById('employeeName').value.trim(),
            phone: document.getElementById('employeePhone').value.trim(),
            email: document.getElementById('employeeEmail').value.trim(),
            role: document.getElementById('employeeRole').value.trim(),
            weeklySalaryUsd: parseFloat(document.getElementById('employeeWeeklyUsd').value) || 0,
            weeklySalaryLbp: parseFloat(document.getElementById('employeeWeeklyLbp').value) || 0,
            notes: document.getElementById('employeeNotes').value.trim()
        };

        if (!data.name) {
            uiError('Employee name is required.',
  document.getElementById('employeeName')
);

            return;
        }

        if (editingId) {
            const index = employees.findIndex(function(e) { return e.id === editingId; });
            employees[index] = { ...employees[index], ...data, id: editingId };
        } else {
            employees.push({ ...data, id: Date.now() });
        }

        dbSetAll('employees', employees);
renderEmployees();
        closeModal();
    }

    function onPayrollEmployeeChange() {
        const select = document.getElementById('payrollEmployeeId');
        if (!select) return;
        const empId = select.value ? parseInt(select.value, 10) : null;
        if (!empId) return;

        const emp = (employees || []).find(function(e) { return e.id === empId; });
        if (!emp) return;

        const baseUsdInput = document.getElementById('payrollBaseUsd');
        const baseLbpInput = document.getElementById('payrollBaseLbp');

        if (baseUsdInput) baseUsdInput.value = Number(emp.weeklySalaryUsd) || 0;
        if (baseLbpInput) baseLbpInput.value = Number(emp.weeklySalaryLbp) || 0;
    }

    function openPayrollModal() {
        weeklyPayrollContext = null;
        openModal('payroll');
    }

    function openWeeklyPayroll(employeeId) {
        weeklyPayrollContext = {
            employeeId: employeeId,
            weekEnding: weeklyPayrollEndDate || getWeekEndingSaturday(new Date().toISOString().split('T')[0])
        };
        openModal('payroll');
        setTimeout(function() {
            const select = document.getElementById('payrollEmployeeId');
            if (select) {
                select.value = String(employeeId);
                try { onPayrollEmployeeChange(); } catch(e) {}
            }
        }, 0);
    }

    function markWeeklyUnpaid(employeeId) {
        if (!requireAdminAction()) return;
        const weekEnding = weeklyPayrollEndDate || getWeekEndingSaturday(new Date().toISOString().split('T')[0]);
        const target = (payrollPayments || []).find(function(p) {
            return String(p.employeeId) === String(employeeId) && String(p.weekEnding || '') === String(weekEnding);
        });
        if (!target) return;
        uiConfirm('Mark this weekly payment as unpaid? This will remove the saved payment record for this week.', () => {
            const emp = (employees || []).find(function(e) { return String(e.id) === String(employeeId); });
            if (emp) {
                const arr = ensureEmployeePayrollArray(emp).filter(function(p) { return String(p.id) !== String(target.id); });
                emp.payrollPayments = arr;
                dbSetAll('employees', employees);
            }
            rebuildPayrollPaymentsFromEmployees();
            renderPayrollPayments();
            renderWeeklyPayroll();
        });
    }

    function savePayrollPayment() {
        if (!requireAdminAction()) return;

        const date = document.getElementById('payrollDate').value;
        const employeeIdRaw = document.getElementById('payrollEmployeeId').value;
        const employeeId = employeeIdRaw ? parseInt(employeeIdRaw, 10) : null;
        const weekEndingInput = document.getElementById('payrollWeekEnding');
        const weekEndingRaw = weekEndingInput ? weekEndingInput.value : '';
        const weekEnding = weekEndingRaw ? getWeekEndingSaturday(weekEndingRaw) : '';

        const data = {
            date: date,
            employeeId: employeeId,
            baseUsd: parseFloat(document.getElementById('payrollBaseUsd').value) || 0,
            baseLbp: parseFloat(document.getElementById('payrollBaseLbp').value) || 0,
            bonusUsd: parseFloat(document.getElementById('payrollBonusUsd').value) || 0,
            bonusLbp: parseFloat(document.getElementById('payrollBonusLbp').value) || 0,
            weekEnding: weekEnding || '',
            isWeeklyPayment: !!weekEnding,
            notes: document.getElementById('payrollNotes').value.trim()
        };

        if (!data.date || !data.employeeId) {
            uiError('Date and employee are required.');
            return;
        }

        rebuildPayrollPaymentsFromEmployees();
        if (!editingId && data.weekEnding) {
            const exists = (payrollPayments || []).some(function(p) {
                return String(p.employeeId) === String(data.employeeId) && String(p.weekEnding || '') === String(data.weekEnding);
            });
            if (exists) {
                uiError('This employee is already marked Paid for that week.');
                return;
            }
        }

        const emp = (employees || []).find(function(e) { return String(e.id) === String(data.employeeId); });
        if (!emp) {
            uiError('Employee not found.');
            return;
        }
        const arr = ensureEmployeePayrollArray(emp);
        const payload = { ...data };
        delete payload.employeeId;
        if (editingId) {
            const index = arr.findIndex(function(p) { return String(p.id) === String(editingId); });
            if (index !== -1) {
                arr[index] = { ...arr[index], ...payload, id: editingId };
            } else {
                arr.push({ ...payload, id: editingId });
            }
        } else {
            arr.push({ ...payload, id: Date.now() });
        }

        dbSetAll('employees', employees);
        rebuildPayrollPaymentsFromEmployees();
        renderPayrollPayments();
        renderWeeklyPayroll();
        weeklyPayrollContext = null;
        closeModal();
    }

    function saveExpense() {
        if (!requireAdminAction()) return;
        const date = document.getElementById('expenseDate').value;
        const amountRaw = document.getElementById('expenseAmount').value;
        const amount = parseFloat(amountRaw);
        const currency = document.getElementById('expenseCurrency') ? document.getElementById('expenseCurrency').value : 'USD';
        const data = {
            date: date,
            category: document.getElementById('expenseCategory').value.trim(),
            vendor: document.getElementById('expenseVendor').value.trim(),
            amount: amount,
            currency: currency || 'USD',
            paymentMethod: document.getElementById('expenseMethod').value.trim(),
            notes: document.getElementById('expenseNotes').value.trim()
        };

        if (!data.date || !data.category || isNaN(data.amount)) {
            uiError('Date, category, and amount are required.');
            return;
        }

        if (editingId) {
            const index = expenses.findIndex(function(e) { return e.id === editingId; });
            expenses[index] = { ...expenses[index], ...data, id: editingId };
        } else {
            expenses.push({ ...data, id: Date.now() });
        }

        dbSetAll('expenses', expenses);
        renderExpenses();
        closeModal();
    }

    // ======= INVOICE ITEMS UI (per-row searchable dropdown) =======

    function onRowItemSearch(inputEl, skipRefresh) {
        if (!skipRefresh) {
            refreshItemsFromServer().then(function() {
                if (document.body.contains(inputEl)) onRowItemSearch(inputEl, true);
            });
            return;
        }
        refreshItemsFromDb();
        const term = (inputEl.value || '').toLowerCase();
        const row = inputEl.closest('.invoice-item');
        const select = row.querySelector('.invoice-item-select');
        const currentVal = select.value;

        const tagFilter = getInvoiceTagFilterValue();
        const mainWid = getMainWarehouseId();

        const filtered = (items || []).filter(function(i) {
            ensureItemPricing(i);
            ensureItemTags(i);

            const isSelected = currentVal && String(i.id) === String(currentVal);
            if (!isSelected && isServiceItem(i)) return false;

            // Tag filter (if selected) - never hide already-selected item
            if (tagFilter) {
                if (!isSelected && !itemHasTag(i, tagFilter)) return false;
            }

            // Search term filter (name / part #)
            if (term) {
                const name = (i.name || '').toLowerCase();
                const part = (i.partNumber || '').toLowerCase();
                if (!name.includes(term) && !part.includes(term)) return false;
            }

            // Hide zero-stock items unless already selected (editing)
            const mainQty = getWarehouseQty(i, mainWid);
            if (!isSelected && mainQty <= 0) return false;

            return true;
        });

        select.innerHTML =
            '<option value="">Select Item</option>' +
            filtered.map(function(i) {
                const selected = currentVal && String(i.id) === String(currentVal) ? 'selected' : '';
                const mainQty = getWarehouseQty(i, mainWid);
                const labelPart = i.partNumber ? ' (' + i.partNumber + ')' : '';
                const stockPart = ' [Main: ' + mainQty + ']';

                const cost = (typeof i.costPrice === 'number' && !isNaN(i.costPrice)) ? i.costPrice : '';
                const costPretty = cost === '' ? '' : formatCostNumber(cost);

                return '<option value="' + i.id + '" ' +
                    'data-price="' + (typeof i.price === 'number' ? i.price : 0) + '" ' +
                    'data-cost="' + (costPretty !== '' ? costPretty : '') + '" ' +
                    'data-part="' + (i.partNumber || '') + '" ' +
                    selected + '>' +
                    i.name + labelPart + stockPart + ' - ' + (i.price || 0).toFixed(2) +
                '</option>';
            }).join('');

        if (currentVal && filtered.some(function(i) { return String(i.id) === String(currentVal); })) {
            select.value = currentVal;
        }

        if (term && filtered.length > 0) {
            select.size = Math.min(filtered.length + 1, 6);
            select.style.display = 'block';
        } else {
            select.size = 1;
            select.style.display = '';
        }
    

        if (term && filtered.length > 0) {
            select.size = Math.min(filtered.length + 1, 6);
            select.style.display = 'block';
        } else {
            select.size = 1;
            select.style.display = '';
        }
    }

    function addInvoiceItem(item) {
        refreshItemsFromDb();
        ensureWarehouses();
        if (item === undefined) item = null;
        const container = document.getElementById('invoiceItems');

        const selectedItemId = item ? item.itemId : null;

        const mainWid = getMainWarehouseId();

        const tagFilter = getInvoiceTagFilterValue();

        const allOptions = (items || []).filter(function(i) {
                ensureItemTags(i);
                const isSelected = selectedItemId && String(i.id) === String(selectedItemId);
                if (!isSelected && isServiceItem(i)) return false;
                if (!tagFilter) return true;
                if (isSelected) return true;
                return itemHasTag(i, tagFilter);
            })
            .map(function(i) {
                ensureItemPricing(i);
                // Show Main warehouse availability only
                const mainQty = getWarehouseQty(i, mainWid);
                const selected = selectedItemId && i.id === selectedItemId ? true : false;

                // Hide zero-stock items unless they are already selected (editing an existing invoice)
                if (!selected && mainQty <= 0) return '';

                const labelPart = i.partNumber ? ' (' + i.partNumber + ')' : '';
                const stockPart = ' [Main: ' + mainQty + ']';
                return '<option value="' + i.id + '" data-price="' + i.price + '" data-cost="' + (i.costPrice || 0) + '" data-part="' + (i.partNumber || '') + '" ' + (selected ? 'selected' : '') + '>' +
                    i.name + labelPart + stockPart + ' - ' + i.price.toFixed(2) +
                '</option>';
            })
            .filter(Boolean)
            .join('');

        const supplierOptions = suppliers.map(function(s) {
            const selected = item && item.supplierId === s.id ? 'selected' : '';
            return '<option value="' + s.id + '" ' + selected + '>' + s.name + '</option>';
        }).join('');

        const employeeOptions = employees.map(function(e) {
            const selected = item && item.employeeId === e.id ? 'selected' : '';
            return '<option value="' + e.id + '" ' + selected + '>' +
                e.name + (e.role ? ' - ' + e.role : '') +
            '</option>';
        }).join('');
        
        
        const warehouseOptions = (warehouses || []).map(function(w) {
            const selected = item && item.warehouseId === w.id ? 'selected' : '';
            return '<option value="' + w.id + '" ' + selected + '>' + w.name + '</option>';
        }).join('');
const div = document.createElement('div');
        div.className = 'invoice-item';
        div.innerHTML = `
            <input type="text" class="invoice-item-search" placeholder="Search item..." oninput="onRowItemSearch(this)">
            <select class="invoice-item-select" onchange="onInvoiceItemSelectChange(this)">
                <option value="">Select Item</option>
                ${allOptions}
            </select>
            <span class="invoice-part" title="" style="font-size:12px; color:#666; cursor:help; white-space:nowrap;"></span>
            <select class="invoice-supplier-select">
                <option value="">Supplier</option>
                ${supplierOptions}
            </select>
            <select class="invoice-employee-select">
                <option value="">Employee</option>
                ${employeeOptions}
            </select>
            <!-- Invoicing sells ONLY from the Main Warehouse -->
            <input type="number" min="1" value="${item ? item.quantity : 1}" class="invoice-quantity" onchange="calculateTotal()" placeholder="Qty">
            <input type="number" step="0.01" min="0" value="${item ? item.price : 0}" class="invoice-price" onchange="calculateTotal()" placeholder="Price">
            <button class="btn btn-danger btn-small" type="button" onclick="this.parentElement.remove(); calculateTotal()">✕</button>
        `;
        container.appendChild(div);


        if (item && selectedItemId) {
            const selectEl = div.querySelector('.invoice-item-select');
            selectEl.value = String(selectedItemId);
            const priceInput = div.querySelector('.invoice-price');
            const price =
                typeof item.price === 'number'
                    ? item.price
                    : (items.find(function(i) { return i.id === selectedItemId; }) || {}).price || 0;
            priceInput.value = price.toFixed(2);
        }

        calculateTotal();
    }

    // CUSTOM INVOICE ITEM (no stock impact) + supplier + employee
    function addCustomInvoiceItem(item) {
        if (item === undefined) item = null;

        const container = document.getElementById('invoiceItems');

        const supplierOptions = suppliers.map(function(s) {
            const selected = item && item.supplierId === s.id ? "selected" : "";
            return `<option value="${s.id}" ${selected}>${s.name}</option>`;
        }).join("");

        const employeeOptions = employees.map(function(e) {
            const selected = item && item.employeeId === e.id ? "selected" : "";
            return `<option value="${e.id}" ${selected}>${e.name}${e.role ? " - " + e.role : ""}</option>`;
        }).join("");

        const div = document.createElement("div");
        div.className = "invoice-item invoice-item-custom";

        div.innerHTML = `
            <input type="text" class="invoice-custom-name" 
                placeholder="Custom item name" 
                value="${item && item.name ? item.name : ""}">

            <select class="invoice-supplier-select">
                <option value="">Supplier</option>
                ${supplierOptions}
            </select>

            <select class="invoice-employee-select">
                <option value="">Employee</option>
                ${employeeOptions}
            </select>

            <input type="number" min="1" 
                value="${item ? item.quantity : 1}" 
                class="invoice-quantity" 
                onchange="calculateTotal()" 
                placeholder="Qty">

            <input type="number" step="0.01" min="0"
                value="${item ? item.price : 0}" 
                class="invoice-price" 
                onchange="calculateTotal()" 
                placeholder="Price">

            <button class="btn btn-danger btn-small" type="button" 
                onclick="this.parentElement.remove(); calculateTotal()">✕</button>
        `;

        container.appendChild(div);

        // If an item is already selected (editing an invoice), sync part/cost tooltip
        const sel = div.querySelector('.invoice-item-select');
        if (sel && sel.value) {
            updateItemPrice(sel); // also updates part/cost
        }

        calculateTotal();
    }

        // SERVICE INVOICE ITEM (non-stock)
    function addServiceInvoiceItem(item) {
        refreshServiceItemsFromDb();
        if (item === undefined) item = null;

        const container = document.getElementById('invoiceItems');
        if (!container) return;

        const supplierOptions = suppliers.map(function(s) {
            const selected = item && item.supplierId === s.id ? "selected" : "";
            return `<option value="${s.id}" ${selected}>${s.name}</option>`;
        }).join("");

        const employeeOptions = employees.map(function(e) {
            const selected = item && item.employeeId === e.id ? "selected" : "";
            return `<option value="${e.id}" ${selected}>${e.name}${e.role ? " - " + e.role : ""}</option>`;
        }).join("");

        const serviceId = item && item.serviceItemId ? String(item.serviceItemId) : '';
        let serviceLabel = '';
        if (serviceId) {
            const svc = (serviceItems || []).find(function(s) { return String(s.id) === serviceId; });
            if (svc) {
                const code = svc.code || '';
                const name = svc.name || '';
                serviceLabel = code && name ? (code + ' - ' + name) : (code || name);
            } else if (item && item.name) {
                serviceLabel = item.name;
            }
        } else if (item && item.name) {
            serviceLabel = item.name;
        }

        const div = document.createElement("div");
        div.className = "invoice-item invoice-item-service";

        div.innerHTML = `
            <div class="invoice-service-picker">
                <input type="text" class="invoice-service-search" placeholder="Search service..." value="${_esc(serviceLabel)}"
                    oninput="onRowServiceItemSearch(this)" onfocus="onRowServiceItemSearch(this)" onblur="onServiceSearchBlur(this)">
                <input type="hidden" class="invoice-service-id" value="${_esc(serviceId)}">
                <div class="service-dropdown"></div>
            </div>

            <select class="invoice-supplier-select">
                <option value="">Supplier</option>
                ${supplierOptions}
            </select>

            <select class="invoice-employee-select">
                <option value="">Employee</option>
                ${employeeOptions}
            </select>

            <input type="number" min="1" 
                value="${item ? item.quantity : 1}" 
                class="invoice-quantity" 
                onchange="calculateTotal()" 
                placeholder="Qty">

            <input type="number" step="0.01" min="0"
                value="${item ? item.price : 0}" 
                class="invoice-price" 
                onchange="calculateTotal()" 
                placeholder="Price">

            <button class="btn btn-danger btn-small" type="button" 
                onclick="this.parentElement.remove(); calculateTotal()">&#x2716;</button>
        `;

        container.appendChild(div);

        const svcInput = div.querySelector('.invoice-service-search');
        if (svcInput && serviceLabel) svcInput.setAttribute('data-service-name', serviceLabel);

        calculateTotal();
    }

    

    function updateRowPartAndCost(rowEl, selectEl) {
        if (!rowEl || !selectEl) return;
        const partSpan = rowEl.querySelector('.invoice-part');
        if (!partSpan) return;

        const opt = selectEl.options[selectEl.selectedIndex];
        const part = opt ? (opt.getAttribute('data-part') || '') : '';
        const costRaw = opt ? (opt.getAttribute('data-cost') || '') : '';

        partSpan.textContent = part ? '(' + part + ')' : '';
        if (hasPerm("*")) {
            const costNum = parseFloat(costRaw);
            partSpan.title = isNaN(costNum) ? '' : formatCostNumber(costNum);
        } else {
            partSpan.title = '';
        }
    }

function updateItemPrice(selectElement) {
        const row = selectElement.closest('.invoice-item');
        const selectedOption = selectElement.options[selectElement.selectedIndex];
        const price = parseFloat(selectedOption.getAttribute('data-price')) || 0;
        const priceInput = row.querySelector('.invoice-price');
        priceInput.value = price.toFixed(2);

        updateRowPartAndCost(row, selectElement);

        calculateTotal();
    }

    function onInvoiceItemSelectChange(selectElement) {
        if (!selectElement.value) {
            return;
        }

        updateItemPrice(selectElement);

        selectElement.size = 1;
        selectElement.style.display = '';
        const row = selectElement.closest('.invoice-item');
        const searchInput = row.querySelector('.invoice-item-search');
        
        if (searchInput) {
            searchInput.value = '';
        }

        const container = document.getElementById('invoiceItems');
        const rows = container.querySelectorAll('.invoice-item');
        const lastRow = rows[rows.length - 1];

        if (lastRow && lastRow.contains(selectElement)) {
            addInvoiceItem();
        }
    }

    // ==== AMOUNT PAID / REMAINING (decimal + clamped) ====
    function updateRemainingDisplay() {
        const totalEl = document.getElementById('invoiceTotal');
        const amountInput = document.getElementById('amountPaid');
        const remainingInput = document.getElementById('remainingDisplay');

        if (!totalEl || !amountInput || !remainingInput) return;

        const total = parseFloat(totalEl.textContent) || 0;
        const raw = amountInput.value;
        let paid = parseFloat(raw);

        if (isNaN(paid)) {
            paid = 0;
        }

        if (paid < 0) {
            paid = 0;
            amountInput.value = 0;
        } else if (paid > total) {
            paid = total;
            amountInput.value = total;
        }

        const remaining = total - paid;
        remainingInput.value = remaining.toFixed(2);
    }

    function onAmountPaidChange() {
        updateRemainingDisplay();
    }

    function calculateTotal() {
        const itemElements = document.querySelectorAll('.invoice-item');
        let total = 0;
        itemElements.forEach(function(el) {
            const quantity = parseInt(el.querySelector('.invoice-quantity').value) || 0;
            const price = parseFloat(el.querySelector('.invoice-price').value) || 0;
            total += price * quantity;
        });
        const totalEl = document.getElementById('invoiceTotal');
        if (totalEl) {
            totalEl.textContent = total.toFixed(2);
        }
        updateRemainingDisplay();
    }

    // ======= INVOICE A ITEMS + TOTALS =======
    function updateInvoiceARemainingDisplay() {
        const totalEl = document.getElementById('invoiceATotal');
        const amountInput = document.getElementById('invoiceAAmountPaid');
        const remainingInput = document.getElementById('invoiceARemaining');

        if (!totalEl || !amountInput || !remainingInput) return;

        const total = parseFloat(totalEl.textContent) || 0;
        const raw = amountInput.value;
        let paid = parseFloat(raw);

        if (isNaN(paid)) paid = 0;
        if (paid < 0) {
            paid = 0;
            amountInput.value = 0;
        } else if (paid > total) {
            paid = total;
            amountInput.value = total;
        }

        const remaining = total - paid;
        remainingInput.value = remaining.toFixed(2);
    }

    function onInvoiceAAmountPaidChange() {
        updateInvoiceARemainingDisplay();
    }

    function calculateInvoiceATotal() {
        const rows = document.querySelectorAll('.invoice-a-item');
        let total = 0;
        rows.forEach(function(row) {
            const qty = parseInt(row.querySelector('.invoice-a-quantity')?.value) || 0;
            const price = parseFloat(row.querySelector('.invoice-a-price')?.value) || 0;
            const tvaChecked = !!row.querySelector('.invoice-a-tva')?.checked;
            const base = qty * price;
            const tva = tvaChecked ? (base * 0.11) : 0;
            const lineTotal = base + tva;
            const lineEl = row.querySelector('.invoice-a-line-total');
            if (lineEl) lineEl.textContent = lineTotal.toFixed(2);
            total += lineTotal;
        });
        const totalEl = document.getElementById('invoiceATotal');
        if (totalEl) totalEl.textContent = total.toFixed(2);
        updateInvoiceARemainingDisplay();
    }

    function toggleInvoiceATvaDefault(checked) {
        document.querySelectorAll('.invoice-a-tva').forEach(function(chk) {
            chk.checked = !!checked;
        });
        calculateInvoiceATotal();
    }

    function onRowItemSearchA(inputEl, skipRefresh) {
        if (!skipRefresh) {
            refreshItemsFromServer().then(function() {
                if (document.body.contains(inputEl)) onRowItemSearchA(inputEl, true);
            });
            return;
        }
        refreshItemsFromDb();
        const term = (inputEl.value || '').toLowerCase();
        const row = inputEl.closest('.invoice-a-item');
        const select = row.querySelector('.invoice-a-item-select');
        if (!select) return;

        const currentVal = select.value;

        const filtered = (items || []).filter(function(i) {
            ensureItemPricing(i);
            ensureItemTags(i);

            const isSelected = currentVal && String(i.id) === String(currentVal);
            if (!isSelected && isServiceItem(i)) return false;

            if (term) {
                const name = (i.name || '').toLowerCase();
                const part = (i.partNumber || '').toLowerCase();
                if (!name.includes(term) && !part.includes(term)) return false;
            }
            return true;
        });

        select.innerHTML =
            '<option value="">Select Item</option>' +
            filtered.map(function(i) {
                const selected = currentVal && String(i.id) === String(currentVal) ? 'selected' : '';
                const mainQty = getWarehouseQty(i, mainWid);
                const labelPart = i.partNumber ? ' (' + i.partNumber + ')' : '';
                const stockPart = ' [Main: ' + mainQty + ']';
                return '<option value="' + i.id + '" ' +
                    'data-price="' + (typeof i.price === 'number' ? i.price : 0) + '" ' +
                    selected + '>' +
                    i.name + labelPart + stockPart + ' - ' + (i.price || 0).toFixed(2) +
                '</option>';
            }).join('');

        if (currentVal && filtered.some(function(i) { return String(i.id) === String(currentVal); })) {
            select.value = currentVal;
        }

        if (term && filtered.length > 0) {
            select.size = Math.min(filtered.length + 1, 6);
            select.style.display = 'block';
        } else {
            select.size = 1;
            select.style.display = '';
        }
    }

    function addInvoiceAItem(item) {
        refreshItemsFromDb();
        ensureWarehouses();
        if (item === undefined) item = null;

        const container = document.getElementById('invoiceAItems');
        if (!container) return;

        const selectedItemId = item ? item.itemId : null;
        const allOptions = (items || []).filter(function(i) {
                ensureItemPricing(i);
                ensureItemTags(i);
                const isSelected = selectedItemId && String(i.id) === String(selectedItemId);
                if (!isSelected && isServiceItem(i)) return false;
                return true;
            })
            .map(function(i) {
                const selected = selectedItemId && i.id === selectedItemId ? 'selected' : '';
                const labelPart = i.partNumber ? ' (' + i.partNumber + ')' : '';
                const stockPart = '';
                return '<option value="' + i.id + '" data-price="' + i.price + '" ' + selected + '>' +
                    i.name + labelPart + stockPart + ' - ' + i.price.toFixed(2) +
                '</option>';
            })
            .join('');

        const supplierOptions = suppliers.map(function(s) {
            const selected = item && item.supplierId === s.id ? 'selected' : '';
            return '<option value="' + s.id + '" ' + selected + '>' + s.name + '</option>';
        }).join('');

        const employeeOptions = employees.map(function(e) {
            const selected = item && item.employeeId === e.id ? 'selected' : '';
            return '<option value="' + e.id + '" ' + selected + '>' +
                e.name + (e.role ? ' - ' + e.role : '') +
            '</option>';
        }).join('');

        const tvaDefault = !!document.getElementById('invoiceATvaDefault')?.checked;
        const tvaChecked = item && typeof item.tva === 'boolean' ? item.tva : tvaDefault;

        const tr = document.createElement('tr');
        tr.className = 'invoice-a-item';
        tr.innerHTML = `
            <td>
                <input type="text" class="invoice-a-item-search" placeholder="Search item..." oninput="onRowItemSearchA(this)">
                <select class="invoice-a-item-select" onchange="onInvoiceAItemSelectChange(this)">
                    <option value="">Select Item</option>
                    ${allOptions}
                </select>
            </td>
            <td><input type="number" step="0.01" min="0" value="${item ? item.price : 0}" class="invoice-a-price" onchange="calculateInvoiceATotal()"></td>
            <td><input type="number" min="1" value="${item ? item.quantity : 1}" class="invoice-a-quantity" onchange="calculateInvoiceATotal()"></td>
            <td style="text-align:center;"><input type="checkbox" class="invoice-a-tva" ${tvaChecked ? 'checked' : ''} onchange="calculateInvoiceATotal()"></td>
            <td class="invoice-a-line-total">0.00</td>
            <td>
                <select class="invoice-a-employee-select">
                    <option value="">Select Employee</option>
                    ${employeeOptions}
                </select>
            </td>
            <td>
                <select class="invoice-a-supplier-select">
                    <option value="">Select Supplier</option>
                    ${supplierOptions}
                </select>
            </td>
            <td><button class="btn btn-danger btn-small" type="button" onclick="this.closest('tr').remove(); calculateInvoiceATotal()">✖</button></td>
        `;

        container.appendChild(tr);

        if (item && selectedItemId) {
            const selectEl = tr.querySelector('.invoice-a-item-select');
            selectEl.value = String(selectedItemId);
            const priceInput = tr.querySelector('.invoice-a-price');
            const price =
                typeof item.price === 'number'
                    ? item.price
                    : (items.find(function(i) { return i.id === selectedItemId; }) || {}).price || 0;
            priceInput.value = price.toFixed(2);
        }

        calculateInvoiceATotal();
    }

    function addCustomInvoiceAItem(item) {
        if (item === undefined) item = null;
        const container = document.getElementById('invoiceAItems');
        if (!container) return;

        const supplierOptions = suppliers.map(function(s) {
            const selected = item && item.supplierId === s.id ? 'selected' : '';
            return '<option value="' + s.id + '" ' + selected + '>' + s.name + '</option>';
        }).join('');

        const employeeOptions = employees.map(function(e) {
            const selected = item && item.employeeId === e.id ? 'selected' : '';
            return '<option value="' + e.id + '" ' + selected + '>' +
                e.name + (e.role ? ' - ' + e.role : '') +
            '</option>';
        }).join('');

        const tvaDefault = !!document.getElementById('invoiceATvaDefault')?.checked;
        const tvaChecked = item && typeof item.tva === 'boolean' ? item.tva : tvaDefault;

        const tr = document.createElement('tr');
        tr.className = 'invoice-a-item invoice-a-item-custom';
        tr.innerHTML = `
            <td>
                <input type="text" class="invoice-a-custom-name" placeholder="Custom item name" value="${item && item.name ? item.name : ''}">
            </td>
            <td><input type="number" step="0.01" min="0" value="${item ? item.price : 0}" class="invoice-a-price" onchange="calculateInvoiceATotal()"></td>
            <td><input type="number" min="1" value="${item ? item.quantity : 1}" class="invoice-a-quantity" onchange="calculateInvoiceATotal()"></td>
            <td style="text-align:center;"><input type="checkbox" class="invoice-a-tva" ${tvaChecked ? 'checked' : ''} onchange="calculateInvoiceATotal()"></td>
            <td class="invoice-a-line-total">0.00</td>
            <td>
                <select class="invoice-a-employee-select">
                    <option value="">Select Employee</option>
                    ${employeeOptions}
                </select>
            </td>
            <td>
                <select class="invoice-a-supplier-select">
                    <option value="">Select Supplier</option>
                    ${supplierOptions}
                </select>
            </td>
            <td><button class="btn btn-danger btn-small" type="button" onclick="this.closest('tr').remove(); calculateInvoiceATotal()">✖</button></td>
        `;

        container.appendChild(tr);
        calculateInvoiceATotal();
    }

        function addServiceInvoiceAItem(item) {
        refreshServiceItemsFromDb();
        if (item === undefined) item = null;
        const container = document.getElementById('invoiceAItems');
        if (!container) return;

        const supplierOptions = suppliers.map(function(s) {
            const selected = item && item.supplierId === s.id ? 'selected' : '';
            return '<option value="' + s.id + '" ' + selected + '>' + s.name + '</option>';
        }).join('');

        const employeeOptions = employees.map(function(e) {
            const selected = item && item.employeeId === e.id ? 'selected' : '';
            return '<option value="' + e.id + '" ' + selected + '>' +
                e.name + (e.role ? ' - ' + e.role : '') +
            '</option>';
        }).join('');

        const serviceId = item && item.serviceItemId ? String(item.serviceItemId) : '';
        let serviceLabel = '';
        if (serviceId) {
            const svc = (serviceItems || []).find(function(s) { return String(s.id) === serviceId; });
            if (svc) {
                const code = svc.code || '';
                const name = svc.name || '';
                serviceLabel = code && name ? (code + ' - ' + name) : (code || name);
            } else if (item && item.name) {
                serviceLabel = item.name;
            }
        } else if (item && item.name) {
            serviceLabel = item.name;
        }

        const tvaDefault = !!document.getElementById('invoiceATvaDefault')?.checked;
        const tvaChecked = item && typeof item.tva === 'boolean' ? item.tva : tvaDefault;

        const tr = document.createElement('tr');
        tr.className = 'invoice-a-item invoice-a-item-service';
        tr.innerHTML = `
            <td>
                <div class="invoice-a-service-picker">
                    <input type="text" class="invoice-a-service-search" placeholder="Search service..." value="${_esc(serviceLabel)}"
                        oninput="onRowServiceItemSearchA(this)" onfocus="onRowServiceItemSearchA(this)" onblur="onServiceSearchBlur(this)">
                    <input type="hidden" class="invoice-a-service-id" value="${_esc(serviceId)}">
                    <div class="service-dropdown"></div>
                </div>
            </td>
            <td><input type="number" step="0.01" min="0" value="${item ? item.price : 0}" class="invoice-a-price" onchange="calculateInvoiceATotal()"></td>
            <td><input type="number" min="1" value="${item ? item.quantity : 1}" class="invoice-a-quantity" onchange="calculateInvoiceATotal()"></td>
            <td style="text-align:center;"><input type="checkbox" class="invoice-a-tva" ${tvaChecked ? 'checked' : ''} onchange="calculateInvoiceATotal()"></td>
            <td class="invoice-a-line-total">0.00</td>
            <td>
                <select class="invoice-a-employee-select">
                    <option value="">Select Employee</option>
                    ${employeeOptions}
                </select>
            </td>
            <td>
                <select class="invoice-a-supplier-select">
                    <option value="">Select Supplier</option>
                    ${supplierOptions}
                </select>
            </td>
            <td><button class="btn btn-danger btn-small" type="button" onclick="this.closest('tr').remove(); calculateInvoiceATotal()">&#x2716;</button></td>
        `;

        container.appendChild(tr);

        const svcInput = tr.querySelector('.invoice-a-service-search');
        if (svcInput && serviceLabel) svcInput.setAttribute('data-service-name', serviceLabel);

        calculateInvoiceATotal();
    }

    function updateInvoiceAItemPrice(selectElement) {
        const row = selectElement.closest('.invoice-a-item');
        const selectedOption = selectElement.options[selectElement.selectedIndex];
        const price = parseFloat(selectedOption.getAttribute('data-price')) || 0;
        const priceInput = row.querySelector('.invoice-a-price');
        if (priceInput) priceInput.value = price.toFixed(2);
        calculateInvoiceATotal();
    }

    function onInvoiceAItemSelectChange(selectElement) {
        if (!selectElement.value) return;

        updateInvoiceAItemPrice(selectElement);

        selectElement.size = 1;
        selectElement.style.display = '';
        const row = selectElement.closest('.invoice-a-item');
        const searchInput = row.querySelector('.invoice-a-item-search');
        if (searchInput) searchInput.value = '';

        const container = document.getElementById('invoiceAItems');
        const rows = container ? container.querySelectorAll('.invoice-a-item') : [];
        const lastRow = rows[rows.length - 1];
        if (lastRow && lastRow.contains(selectElement)) {
            addInvoiceAItem();
        }
    }

    function updateCarOptions(selectedCarId) {
        if (selectedCarId === undefined) selectedCarId = null;
        const clientIdInput = document.getElementById('invoiceClientId');
        const carSelect = document.getElementById('invoiceCarId');
        if (!clientIdInput || !carSelect) return;

        const carSearchInput = document.getElementById('invoiceCarSearch');
        if (carSearchInput) carSearchInput.value = '';

        const clientIdVal = clientIdInput.value;
        const clientId = clientIdVal ? parseInt(clientIdVal) : null;
        const clientCars = clientId ? cars.filter(function(c) { return c.clientId === clientId; }) : [];

        carSelect.innerHTML = '<option value="">Select Car</option>' + 
            clientCars.map(function(c) {
                return '<option value="' + c.id + '">' + c.year + ' ' + c.make + ' ' + c.model + ' - ' + c.plate + '</option>';
            }).join('');

        if (selectedCarId) {
            carSelect.value = String(selectedCarId);
        }
    }

    // ✅ Auto-select client when a car is selected in invoice
    function onInvoiceCarSelectChange(selectedCarId) {
    const clientIdInput = document.getElementById('invoiceClientId');
    const clientSearch = document.getElementById('invoiceClientSearch');
    const carSelect = document.getElementById('invoiceCarId');
    if (!clientIdInput || !carSelect) return;

    if (!selectedCarId) return;

    // Always compare as string (safe for DB values)
    const car = (Array.isArray(cars) ? cars : []).find(function(c) {
        return String(c.id) === String(selectedCarId);
    });
    if (!car) return;

    if (car.clientId != null) {
        const cid = String(car.clientId);
        clientIdInput.value = cid;
        if (clientSearch) {
            const cl = (Array.isArray(clients) ? clients : []).find(function(x){ return String(x.id) === cid; });
            const label = cl ? (cl.phone ? (cl.name + ' - ' + cl.phone) : (cl.name || ('Client #' + cid))) : ('Client #' + cid);
            clientSearch.value = label;
            clientSearch.setAttribute('data-client-name', label);
        }
    }

    // Refresh car dropdown safely using your optimized filter
    if (typeof filterInvoiceCarOptions === "function") {
        filterInvoiceCarOptions();
        carSelect.value = String(selectedCarId); // keep selected car
    }
}


function onClientSearchBlur(inputEl) {
    const picker = inputEl ? inputEl.closest('.invoice-client-picker, .invoice-a-client-picker') : null;
    const dropdown = picker ? picker.querySelector('.client-dropdown') : null;
    if (!dropdown) return;
    setTimeout(function() {
        dropdown.style.display = 'none';
    }, 120);
}

function onInvoiceClientOptionMouseDown(optionEl) {
    const id = optionEl.getAttribute('data-id') || '';
    const label = optionEl.getAttribute('data-label') || optionEl.textContent || '';

    const inputEl = document.getElementById('invoiceClientSearch');
    const idInput = document.getElementById('invoiceClientId');
    if (idInput) idInput.value = id;
    if (inputEl) {
        inputEl.value = label;
        inputEl.setAttribute('data-client-name', label);
    }

    const picker = inputEl ? inputEl.closest('.invoice-client-picker') : null;
    const dropdown = picker ? picker.querySelector('.client-dropdown') : null;
    if (dropdown) dropdown.style.display = 'none';

    if (typeof updateCarOptions === 'function') updateCarOptions();
}

function onInvoiceAClientOptionMouseDown(optionEl) {
    const id = optionEl.getAttribute('data-id') || '';
    const label = optionEl.getAttribute('data-label') || optionEl.textContent || '';

    const inputEl = document.getElementById('invoiceAClientSearch');
    const idInput = document.getElementById('invoiceAClientId');
    if (idInput) idInput.value = id;
    if (inputEl) {
        inputEl.value = label;
        inputEl.setAttribute('data-client-name', label);
    }

    const picker = inputEl ? inputEl.closest('.invoice-a-client-picker') : null;
    const dropdown = picker ? picker.querySelector('.client-dropdown') : null;
    if (dropdown) dropdown.style.display = 'none';

    if (typeof onInvoiceAClientChange === 'function') onInvoiceAClientChange();
}

function filterInvoiceClientOptions(typed) {
  const inputEl = document.getElementById('invoiceClientSearch');
  const picker = inputEl ? inputEl.closest('.invoice-client-picker') : null;
  const dropdown = picker ? picker.querySelector('.client-dropdown') : null;
  if (!inputEl || !dropdown) return;

  const term = String(
    (typed != null ? typed : (inputEl ? inputEl.value : '')) || ''
  ).toLowerCase().trim();

  try { rebuildInvoiceClientCache(); } catch (e) {}
  const list = (Array.isArray(invoiceClientCache) && invoiceClientCache.length)
    ? invoiceClientCache
    : (clients || []);

  const idInput = document.getElementById('invoiceClientId');
  const prevLabel = inputEl.getAttribute('data-client-name') || '';
  if (idInput) {
    if (prevLabel && prevLabel !== inputEl.value) {
      idInput.value = '';
      inputEl.setAttribute('data-client-name', '');
    } else if (!prevLabel && idInput.value && inputEl.value.trim() === '') {
      idInput.value = '';
    }
  }

  if (!term) {
    dropdown.style.display = 'none';
    return;
  }

  const MAX = 60;
  let shown = 0;
  const filtered = [];
  for (let i = 0; i < list.length && shown < MAX; i++) {
    const c = list[i] || {};
    const name  = String(c.name || '').toLowerCase();
    const phone = String(c.phone || '').toLowerCase();
    if (!term || name.includes(term) || phone.includes(term)) {
      filtered.push(c);
      shown++;
    }
  }

  dropdown.innerHTML = filtered.map(function(c) {
    const label = (c.phone ? (c.name + ' - ' + c.phone) : (c.name || 'Client'));
    const safeLabel = _esc(label);
    return '<div class="client-option" data-id="' + _esc(c.id) + '" data-label="' + safeLabel + '" onmousedown="onInvoiceClientOptionMouseDown(this)">' + safeLabel + '</div>';
  }).join('');

  dropdown.style.display = filtered.length ? 'block' : 'none';
}


function filterInvoiceCarOptions() {
    const input = document.getElementById('invoiceCarSearch');
    const select = document.getElementById('invoiceCarId');
    const clientIdInput = document.getElementById('invoiceClientId');
    if (!input || !select || !clientIdInput) return;

    const term = String(input.value || '').trim().toLowerCase();
    const clientIdVal = clientIdInput.value;
    const clientId = clientIdVal ? parseInt(clientIdVal) : null;

    const currentValue = select.value;

    // Performance: if no client selected AND no search term, don't dump all cars
    if (!clientId && !term) {
        let html = '<option value="">Select Car</option>';
        if (currentValue) {
            const cur = (cars || []).find(function(c){ return String(c.id) === String(currentValue); });
            if (cur) {
                html += '<option value="' + cur.id + '" selected>' +
                    (cur.year || '') + ' ' + (cur.make || '') + ' ' + (cur.model || '') + ' - ' + (cur.plate || '') +
                '</option>';
            }
        } else {
            html += '<option value="" disabled>Type plate / VIN / model to search...</option>';
        }
        select.innerHTML = html;
        select.size = 1;
        select.style.display = '';
        select.onchange = function () { onInvoiceCarSelectChange(this.value); };
        return;
    }

    // base list
    let baseCars = [];
    if (clientId) {
        baseCars = (cars || []).filter(function(c) { return c.clientId === clientId; });
    } else {
        baseCars = cars || [];
    }

    const MAX = 200;
    const filtered = baseCars.filter(function(car) {
        if (!term) return true; // when client is selected, show their cars even without search
        const plate = (car.plate || '').toLowerCase();
        const vin = (car.vin || '').toLowerCase();
        const make = (car.make || '').toLowerCase();
        const model = (car.model || '').toLowerCase();
        const year = String(car.year || '').toLowerCase();
        const modelYear = (make + ' ' + model + ' ' + year).trim();
        return (
            plate.includes(term) ||
            vin.includes(term) ||
            modelYear.includes(term)
        );
    }).slice(0, MAX);

    select.innerHTML =
        '<option value="">Select Car</option>' +
        filtered.map(function(c) {
            return '<option value="' + c.id + '">' +
                (c.year || '') + ' ' + (c.make || '') + ' ' + (c.model || '') + ' - ' + (c.plate || '') +
            '</option>';
        }).join('') +
        ((filtered.length >= MAX) ? '<option value="" disabled>Showing first ' + MAX + ' results...</option>' : '');

    if (currentValue && filtered.some(function(c) { return String(c.id) === currentValue; })) {
        select.value = currentValue;
    }

    if (term && filtered.length > 0) {
        select.size = Math.min(filtered.length + 1, 6);
        select.style.display = 'block';
    } else {
        select.size = 1;
        select.style.display = '';
    }

    select.onchange = function () {
        this.size = 1;
        this.style.display = '';
        onInvoiceCarSelectChange(this.value);
    };
}


function filterInvoiceAClientOptions(typed) {
  const inputEl = document.getElementById('invoiceAClientSearch');
  const picker = inputEl ? inputEl.closest('.invoice-a-client-picker') : null;
  const dropdown = picker ? picker.querySelector('.client-dropdown') : null;
  if (!inputEl || !dropdown) return;

  const term = String(
    (typed != null ? typed : (inputEl ? inputEl.value : '')) || ''
  ).toLowerCase().trim();

  try { rebuildInvoiceClientCache(); } catch (e) {}
  const list = (Array.isArray(invoiceClientCache) && invoiceClientCache.length)
    ? invoiceClientCache
    : (clients || []);

  const idInput = document.getElementById('invoiceAClientId');
  const prevLabel = inputEl.getAttribute('data-client-name') || '';
  if (idInput) {
    if (prevLabel && prevLabel !== inputEl.value) {
      idInput.value = '';
      inputEl.setAttribute('data-client-name', '');
    } else if (!prevLabel && idInput.value && inputEl.value.trim() === '') {
      idInput.value = '';
    }
  }

  if (!term) {
    dropdown.style.display = 'none';
    return;
  }

  const MAX = 60;
  let shown = 0;
  const filtered = [];
  for (let i = 0; i < list.length && shown < MAX; i++) {
    const c = list[i] || {};
    const name  = String(c.name || '').toLowerCase();
    const phone = String(c.phone || '').toLowerCase();
    if (!term || name.includes(term) || phone.includes(term)) {
      filtered.push(c);
      shown++;
    }
  }

  dropdown.innerHTML = filtered.map(function(c) {
    const label = (c.phone ? (c.name + ' - ' + c.phone) : (c.name || 'Client'));
    const safeLabel = _esc(label);
    return '<div class="client-option" data-id="' + _esc(c.id) + '" data-label="' + safeLabel + '" onmousedown="onInvoiceAClientOptionMouseDown(this)">' + safeLabel + '</div>';
  }).join('');

  dropdown.style.display = filtered.length ? 'block' : 'none';
}


function updateInvoiceACarOptions(selectedCarId) {
    if (selectedCarId === undefined) selectedCarId = null;
    const clientIdInput = document.getElementById('invoiceAClientId');
    const carSelect = document.getElementById('invoiceACarId');
    if (!clientIdInput || !carSelect) return;

    const carSearchInput = document.getElementById('invoiceACarSearch');
    if (carSearchInput) carSearchInput.value = '';

    const clientIdVal = clientIdInput.value;
    const clientId = clientIdVal ? parseInt(clientIdVal) : null;
    const clientCars = clientId ? cars.filter(function(c) { return c.clientId === clientId; }) : [];

    carSelect.innerHTML = '<option value="">Select Car</option>' +
        clientCars.map(function(c) {
            return '<option value="' + c.id + '">' + c.year + ' ' + c.make + ' ' + c.model + ' - ' + c.plate + '</option>';
        }).join('');

    if (selectedCarId) {
        carSelect.value = String(selectedCarId);
    }
}


function filterInvoiceACarOptions() {
    const input = document.getElementById('invoiceACarSearch');
    const select = document.getElementById('invoiceACarId');
    const clientIdInput = document.getElementById('invoiceAClientId');
    if (!input || !select || !clientIdInput) return;

    const term = String(input.value || '').trim().toLowerCase();
    const clientIdVal = clientIdInput.value;
    const clientId = clientIdVal ? parseInt(clientIdVal) : null;

    const currentValue = select.value;

    if (!clientId && !term) {
        let html = '<option value="">Select Car</option>';
        if (currentValue) {
            const cur = (cars || []).find(function(c){ return String(c.id) === String(currentValue); });
            if (cur) {
                html += '<option value="' + cur.id + '" selected>' +
                    (cur.year || '') + ' ' + (cur.make || '') + ' ' + (cur.model || '') + ' - ' + (cur.plate || '') +
                '</option>';
            }
        } else {
            html += '<option value="" disabled>Type plate / VIN / model to search...</option>';
        }
        select.innerHTML = html;
        select.size = 1;
        select.style.display = '';
        select.onchange = function () { onInvoiceACarSelectChange(this.value); };
        return;
    }

    let baseCars = [];
    if (clientId) {
        baseCars = (cars || []).filter(function(c) { return c.clientId === clientId; });
    } else {
        baseCars = cars || [];
    }

    const MAX = 200;
    const filtered = baseCars.filter(function(car) {
        if (!term) return true;
        const plate = (car.plate || '').toLowerCase();
        const vin = (car.vin || '').toLowerCase();
        const make = (car.make || '').toLowerCase();
        const model = (car.model || '').toLowerCase();
        const year = String(car.year || '').toLowerCase();
        const modelYear = (make + ' ' + model + ' ' + year).trim();
        return (
            plate.includes(term) ||
            vin.includes(term) ||
            modelYear.includes(term)
        );
    }).slice(0, MAX);

    select.innerHTML =
        '<option value="">Select Car</option>' +
        filtered.map(function(c) {
            return '<option value="' + c.id + '">' +
                (c.year || '') + ' ' + (c.make || '') + ' ' + (c.model || '') + ' - ' + (c.plate || '') +
            '</option>';
        }).join('') +
        ((filtered.length >= MAX) ? '<option value="" disabled>Showing first ' + MAX + ' results...</option>' : '');

    if (currentValue && filtered.some(function(c) { return String(c.id) === currentValue; })) {
        select.value = currentValue;
    }

    if (term && filtered.length > 0) {
        select.size = Math.min(filtered.length + 1, 6);
        select.style.display = 'block';
    } else {
        select.size = 1;
        select.style.display = '';
    }

    select.onchange = function () {
        this.size = 1;
        this.style.display = '';
        onInvoiceACarSelectChange(this.value);
    };
}


function onInvoiceAClientChange() {
    const clientIdInput = document.getElementById('invoiceAClientId');
    const phoneInput = document.getElementById('invoiceAClientPhone');
    if (!clientIdInput) return;

    const clientIdVal = clientIdInput.value;
    const clientId = clientIdVal ? parseInt(clientIdVal) : null;
    const client = clientId ? clients.find(function(c){ return c.id === clientId; }) : null;

    if (phoneInput) phoneInput.value = client && client.phone ? client.phone : '';

    updateInvoiceACarOptions();

    const reg = document.getElementById('invoiceARegistration');
    const chassis = document.getElementById('invoiceAChassis');
    if (reg && !document.getElementById('invoiceACarId')?.value) reg.value = '';
    if (chassis && !document.getElementById('invoiceACarId')?.value) chassis.value = '';
}


function onInvoiceACarSelectChange(selectedCarId) {
    const clientIdInput = document.getElementById('invoiceAClientId');
    const clientSearch = document.getElementById('invoiceAClientSearch');
    const carSelect = document.getElementById('invoiceACarId');
    if (!clientIdInput || !carSelect) return;

    if (!selectedCarId) {
        const reg = document.getElementById('invoiceARegistration');
        const chassis = document.getElementById('invoiceAChassis');
        if (reg) reg.value = '';
        if (chassis) chassis.value = '';
        return;
    }

    const car = (Array.isArray(cars) ? cars : []).find(function(c) {
        return String(c.id) === String(selectedCarId);
    });
    if (!car) return;

    if (car.clientId != null) {
        const cid = String(car.clientId);
        clientIdInput.value = cid;
        if (clientSearch) {
            const cl = (Array.isArray(clients) ? clients : []).find(function(x){ return String(x.id) === cid; });
            const label = cl ? (cl.phone ? (cl.name + ' - ' + cl.phone) : (cl.name || ('Client #' + cid))) : ('Client #' + cid);
            clientSearch.value = label;
            clientSearch.setAttribute('data-client-name', label);
        }
    }

    if (typeof filterInvoiceACarOptions === "function") {
        filterInvoiceACarOptions();
        carSelect.value = String(selectedCarId);
    }

    const reg = document.getElementById('invoiceARegistration');
    const chassis = document.getElementById('invoiceAChassis');
    if (reg) reg.value = car.plate || '';
    if (chassis) chassis.value = car.vin || '';

    const phoneInput = document.getElementById('invoiceAClientPhone');
    if (phoneInput) {
        const cl = (Array.isArray(clients) ? clients : []).find(function(x){ return String(x.id) === String(car.clientId); });
        phoneInput.value = cl && cl.phone ? cl.phone : '';
    }
}



    // ======= SAVE INVOICE (STOCK + CUSTOM ITEMS) =======

    
function openInvoiceSavedModal(invoiceId) {
    const inv = invoices.find(x => x.id === invoiceId);
    if (!inv) return;

    // Keep modal open, but show saved/read-only view
    currentType = 'invoice';
    editingId = invoiceId;

    const modal = document.getElementById('modal');
    const title = document.getElementById('modalTitle');
    const body = document.getElementById('modalBody');

    const client = clients.find(c => c.id === inv.clientId);
    const car = inv.carId ? cars.find(c => c.id === inv.carId) : null;

    const itemsHtml = (inv.items || []).map(line => {
        const item = line.itemId ? items.find(i => i.id === line.itemId) : null;
        const name = line.custom ? (line.customName || line.name || '(Custom)') : (item ? item.name : (line.name || 'Unknown'));
        const qty = safeInt(line.quantity);
        const price = parseFloat(line.price) || 0;
        const total = qty * price;

        const supplier = line.supplierId ? suppliers.find(s => s.id === line.supplierId) : null;
        const employee = line.employeeId ? employees.find(e => e.id === line.employeeId) : null;

        return `
          <tr>
            <td>${name}</td>
            <td>${qty}</td>
            <td>${price.toFixed(2)}</td>
            <td>${total.toFixed(2)}</td>
            <td>${supplier ? supplier.name : ''}</td>
            <td>${employee ? employee.name : ''}</td>
          </tr>
        `;
    }).join('');

    const f = getInvoiceFinancials(inv);

    title.textContent = "Invoice Saved ✅ (View)";

    body.innerHTML = `
        <div class="form-group">
            <label>Client</label>
            <input type="text" value="${client ? client.name : 'N/A'}" disabled>
        </div>
        <div class="form-group">
            <label>Car</label>
            <input type="text" value="${car ? (car.make + ' ' + car.model + (car.plate ? (' - ' + car.plate) : '')) : 'N/A'}" disabled>
        </div>
        <div class="form-group">
            <label>Date</label>
            <input type="text" value="${inv.date || ''}" disabled>
        </div>
        <div class="form-group">
            <label>Notes</label>
            <textarea disabled>${inv.notes || ''}</textarea>
        </div>

        <div style="margin-top:12px; font-weight:700;">Items (sold from MAIN warehouse only)</div>
        <div style="overflow:auto; margin-top:8px;">
          <table class="table">
            <thead>
              <tr>
                <th>Item</th><th>Qty</th><th>Price</th><th>Total</th><th>Supplier</th><th>Employee</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml || `<tr><td colspan="6">No items</td></tr>`}
            </tbody>
          </table>
        </div>

        <div class="form-group" style="margin-top:10px;">
            <label>Invoice Total</label>
            <input type="text" value="${f.total.toFixed(2)}" disabled>
        </div>
        <div class="form-group">
            <label>Amount Paid</label>
            <input type="text" value="${f.amountPaid.toFixed(2)}" disabled>
        </div>
        <div class="form-group">
            <label>Remaining</label>
            <input type="text" value="${f.remaining.toFixed(2)}" disabled>
        </div>

        <div class="modal-footer">
            <button class="icon-btn edit" title="Edit" onclick="openModal(\'invoice\', ${invoiceId})">✏️</button>
            <button class="btn btn-success" onclick="printInvoice(${invoiceId})">Print</button>
            <button class="btn btn-secondary" onclick="closeModal()">Close</button>
        </div>
    `;

    modal.classList.add('active');
}

function openInvoiceASavedModal(invoiceId) {
    const inv = invoices.find(x => x.id === invoiceId);
    if (!inv) return;

    currentType = 'invoiceA';
    editingId = invoiceId;

    const modal = document.getElementById('modal');
    const title = document.getElementById('modalTitle');
    const body = document.getElementById('modalBody');

    const client = clients.find(c => c.id === inv.clientId);
    const car = inv.carId ? cars.find(c => c.id === inv.carId) : null;

    const itemsHtml = (inv.items || []).map(line => {
        const qty = safeInt(line.quantity);
        const price = parseFloat(line.price) || 0;
        const base = qty * price;
        const tva = line.tva ? base * 0.11 : 0;
        const total = base + tva;

        return `
          <tr>
            <td>${escapeHtml(line.name || '')}</td>
            <td>${price.toFixed(2)}</td>
            <td>${qty}</td>
            <td>${tva.toFixed(2)}</td>
            <td>${total.toFixed(2)}</td>
          </tr>
        `;
    }).join('');

    const f = getInvoiceFinancials(inv);

    title.textContent = "Invoice A Saved ✅ (View)";

    body.innerHTML = `
        <div class="form-group">
            <label>Client</label>
            <input type="text" value="${client ? client.name : 'N/A'}" disabled>
        </div>
        <div class="form-group">
            <label>Car</label>
            <input type="text" value="${car ? (car.make + ' ' + car.model + (car.plate ? (' - ' + car.plate) : '')) : 'N/A'}" disabled>
        </div>
        <div class="form-group">
            <label>Date</label>
            <input type="text" value="${inv.date || ''}" disabled>
        </div>
        <div class="form-group">
            <label>Fiscal Reg</label>
            <input type="text" value="${inv.fiscalReg || ''}" disabled>
        </div>

        <div style="margin-top:12px; font-weight:700;">Items</div>
        <div style="overflow:auto; margin-top:8px;">
          <table class="table">
            <thead>
              <tr>
                <th>Description</th><th>Price</th><th>Qty</th><th>TVA(11%)</th><th>Total</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml || `<tr><td colspan="5">No items</td></tr>`}
            </tbody>
          </table>
        </div>

        <div class="form-group" style="margin-top:10px;">
            <label>Invoice Total</label>
            <input type="text" value="${f.total.toFixed(2)}" disabled>
        </div>
        <div class="form-group">
            <label>Amount Paid</label>
            <input type="text" value="${f.amountPaid.toFixed(2)}" disabled>
        </div>
        <div class="form-group">
            <label>Remaining</label>
            <input type="text" value="${f.remaining.toFixed(2)}" disabled>
        </div>

        <div class="modal-footer">
            <button class="icon-btn edit" title="Edit" onclick="openModal('invoiceA', ${invoiceId})">✏️</button>
            <button class="btn btn-success" onclick="printInvoiceA(${invoiceId})">Print</button>
            <button class="btn btn-secondary" onclick="closeModal()">Close</button>
        </div>
    `;

    modal.classList.add('active');
}

function saveInvoice() {
        if (!requireAdminAction()) return;        const clientId = parseInt(document.getElementById('invoiceClientId').value);
        const carIdVal = document.getElementById('invoiceCarId').value;
        const carId = carIdVal ? parseInt(carIdVal) : null;
        const date = document.getElementById('invoiceDate').value;
        const notes = document.getElementById('notes').value;
        
        const invoiceItems = [];
        document.querySelectorAll('.invoice-item').forEach(function(el) {
            const select = el.querySelector('.invoice-item-select');
            const customNameInput = el.querySelector('.invoice-custom-name');
            const serviceIdInput = el.querySelector('.invoice-service-id');
            const serviceSearch = el.querySelector('.invoice-service-search');
            const supplierSelect = el.querySelector('.invoice-supplier-select');
            const employeeSelect = el.querySelector('.invoice-employee-select');
            const warehouseSelect = el.querySelector('.invoice-warehouse-select');
           

            const supplierIdVal = supplierSelect ? supplierSelect.value : '';
            const supplierId = supplierIdVal ? parseInt(supplierIdVal) : null;
            const employeeIdVal = employeeSelect ? employeeSelect.value : '';
            const employeeId = employeeIdVal ? parseInt(employeeIdVal) : null;

            const mainWid = getMainWarehouseId();
            const warehouseId = mainWid;


            const quantity = parseInt(el.querySelector('.invoice-quantity').value) || 0;
            const price = parseFloat(el.querySelector('.invoice-price').value) || 0;

            let itemId = null;
            let name = '';
            let serviceItemId = null;

            if (select && select.value) {
                itemId = parseInt(select.value);
                const item = items.find(function(i) { return i.id === itemId; });
                name = item ? item.name : '';
            } else if (serviceIdInput && serviceIdInput.value) {
                serviceItemId = parseInt(serviceIdInput.value);
                const svc = (serviceItems || []).find(function(s) { return s.id === serviceItemId; });
                name = svc ? svc.name : '';
                if (!name && serviceSearch && serviceSearch.value.trim()) {
                    name = serviceSearch.value.trim();
                }
                if (!name && serviceSearch && serviceSearch.getAttribute('data-service-name')) {
                    name = serviceSearch.getAttribute('data-service-name');
                }
            } else if (serviceSearch && serviceSearch.value.trim()) {
                const raw = serviceSearch.value.trim();
                const term = raw.toLowerCase();
                const svcMatch = (serviceItems || []).find(function(s) {
                    const code = (s.code || '').toLowerCase();
                    const sname = (s.name || '').toLowerCase();
                    const label = code && sname ? (code + ' - ' + sname) : (code || sname);
                    return code === term || sname === term || label.toLowerCase() === term;
                });
                if (svcMatch) {
                    serviceItemId = svcMatch.id;
                    name = svcMatch.name || raw;
                } else {
                    name = raw;
                }
            } else if (customNameInput && customNameInput.value.trim()) {
                name = customNameInput.value.trim();
            }

            if (!name) return;

            invoiceItems.push({
                itemId: itemId || null,
                name: name,
                supplierId: supplierId,
                employeeId: employeeId,
                warehouseId: warehouseId,
                price: price,
                quantity: quantity,
                custom: !itemId,
                serviceItemId: serviceItemId || null
            });
        });
        
        if (!clientId || invoiceItems.length === 0) {
            uiError('Please select a client and add at least one item.', document.getElementById('invoiceClientId'));

            return;
        }
        
        const total = parseFloat(document.getElementById('invoiceTotal').textContent) || 0;
        let amountPaid = parseFloat(document.getElementById('amountPaid').value);
        if (isNaN(amountPaid)) amountPaid = 0;
        if (amountPaid < 0) amountPaid = 0;
        if (amountPaid > total) amountPaid = total;
        const remaining = total - amountPaid;
        const paymentStatus = remaining <= 0 ? 'paid' : 'unpaid';
        const paidAt = paymentStatus === 'paid' ? date : null;

        let savedId = editingId;

        if (editingId) {
            const oldInvoice = invoices.find(function(i) { return i.id === editingId; });
            if (oldInvoice && oldInvoice.items) {
                oldInvoice.items.forEach(function(it) {
                    if (!it.itemId) return;
                    const idx = items.findIndex(function(x) { return x.id === it.itemId; });
                    if (idx !== -1) {
                        adjustItemStock(it.itemId, it.warehouseId || getDefaultWarehouseId(), +it.quantity);
                    }
                });
            }
        }

        // Validate stock from MAIN warehouse only
        const mainWidForInvoice = getMainWarehouseId();
        if (mainWidForInvoice == null) {
            uiError('Main Warehouse is not configured. Please add a Main Warehouse first.');
            return;
        }
        for (const it of invoiceItems) {
            if (!it.itemId) continue; // custom/service lines don't affect stock
            const idx = items.findIndex(function(x) { return x.id === it.itemId; });
            if (idx === -1) continue;
            const availableMain = getWarehouseQty(items[idx], mainWidForInvoice);
            const req = safeInt(it.quantity);
            if (req > availableMain) {
                uiError('Not enough stock in MAIN warehouse for "' + (items[idx].name || it.name) + '". Available: ' + availableMain + ', requested: ' + req + '.');
                return;
            }
        }


        invoiceItems.forEach(function(it) {
            if (!it.itemId) return;
            const idx = items.findIndex(function(i) { return i.id === it.itemId; });
            if (idx !== -1) {
                adjustItemStock(it.itemId, getMainWarehouseId(), -it.quantity);
            }
        });
        
        const data = {
            clientId: clientId,
            carId: carId,
            date: date,
            notes: notes,
            items: invoiceItems,
            total: total,
            amountPaid: amountPaid,
            paymentStatus: paymentStatus,
            paidAt: paidAt
        };
        
        if (editingId) {
            const index = invoices.findIndex(function(i) { return i.id === editingId; });
            invoices[index] = { ...invoices[index], ...data, id: editingId, invoiceNumber: invoices[index].invoiceNumber };
        } else {
            const id = Date.now();
            savedId = id;
            invoices.push({ ...data, id: id });
        }
        

        invoicePage = 1;

                dbSetAll('invoices', invoices);
        dbSetAll('items', items);
renderInvoices();
        renderItems();
        renderClients();
        openInvoiceSavedModal(savedId);
    }

    function saveInvoiceA() {
        if (!requireAdminAction()) return;

        const clientId = parseInt(document.getElementById('invoiceAClientId').value);
        const carIdVal = document.getElementById('invoiceACarId').value;
        const carId = carIdVal ? parseInt(carIdVal) : null;
        const date = document.getElementById('invoiceADate').value;
        const fiscalReg = (document.getElementById('invoiceAFiscalReg')?.value || '').trim();
        const tvaRegNo = (document.getElementById('invoiceATvaReg')?.value || '').trim();
        const tvaDefault = !!document.getElementById('invoiceATvaDefault')?.checked;

        const invoiceItems = [];
        document.querySelectorAll('#invoiceAItems .invoice-a-item').forEach(function(el) {
            const select = el.querySelector('.invoice-a-item-select');
            const customNameInput = el.querySelector('.invoice-a-custom-name');
            const serviceIdInput = el.querySelector('.invoice-a-service-id');
            const serviceSearch = el.querySelector('.invoice-a-service-search');
            const supplierSelect = el.querySelector('.invoice-a-supplier-select');
            const employeeSelect = el.querySelector('.invoice-a-employee-select');

            const supplierIdVal = supplierSelect ? supplierSelect.value : '';
            const supplierId = supplierIdVal ? parseInt(supplierIdVal) : null;
            const employeeIdVal = employeeSelect ? employeeSelect.value : '';
            const employeeId = employeeIdVal ? parseInt(employeeIdVal) : null;

            const mainWid = getMainWarehouseId();
            const warehouseId = mainWid;

            const quantity = parseInt(el.querySelector('.invoice-a-quantity').value) || 0;
            const price = parseFloat(el.querySelector('.invoice-a-price').value) || 0;
            const tva = !!el.querySelector('.invoice-a-tva')?.checked;

            let itemId = null;
            let name = '';
            let serviceItemId = null;

            if (select && select.value) {
                itemId = parseInt(select.value);
                const item = items.find(function(i) { return i.id === itemId; });
                name = item ? item.name : '';
            } else if (serviceIdInput && serviceIdInput.value) {
                serviceItemId = parseInt(serviceIdInput.value);
                const svc = (serviceItems || []).find(function(s) { return s.id === serviceItemId; });
                name = svc ? svc.name : '';
                if (!name && serviceSearch && serviceSearch.value.trim()) {
                    name = serviceSearch.value.trim();
                }
                if (!name && serviceSearch && serviceSearch.getAttribute('data-service-name')) {
                    name = serviceSearch.getAttribute('data-service-name');
                }
            } else if (serviceSearch && serviceSearch.value.trim()) {
                const raw = serviceSearch.value.trim();
                const term = raw.toLowerCase();
                const svcMatch = (serviceItems || []).find(function(s) {
                    const code = (s.code || '').toLowerCase();
                    const sname = (s.name || '').toLowerCase();
                    const label = code && sname ? (code + ' - ' + sname) : (code || sname);
                    return code === term || sname === term || label.toLowerCase() === term;
                });
                if (svcMatch) {
                    serviceItemId = svcMatch.id;
                    name = svcMatch.name || raw;
                } else {
                    name = raw;
                }
            } else if (customNameInput && customNameInput.value.trim()) {
                name = customNameInput.value.trim();
            }

            if (!name) return;

            invoiceItems.push({
                itemId: itemId || null,
                name: name,
                supplierId: supplierId,
                employeeId: employeeId,
                warehouseId: warehouseId,
                price: price,
                quantity: quantity,
                custom: !itemId,
                tva: tva,
                serviceItemId: serviceItemId || null
            });
        });

        if (!clientId || invoiceItems.length === 0) {
            uiError('Please select a client and add at least one item.', document.getElementById('invoiceAClientId'));
            return;
        }

        const total = parseFloat(document.getElementById('invoiceATotal').textContent) || 0;
        let amountPaid = parseFloat(document.getElementById('invoiceAAmountPaid').value);
        if (isNaN(amountPaid)) amountPaid = 0;
        if (amountPaid < 0) amountPaid = 0;
        if (amountPaid > total) amountPaid = total;
        const remaining = total - amountPaid;
        const paymentStatus = remaining <= 0 ? 'paid' : 'unpaid';
        const paidAt = paymentStatus === 'paid' ? date : null;

        let savedId = editingId;

        // Invoice A does NOT affect stock.

        let invoiceNumber = null;
        if (editingId) {
            const existing = invoices.find(function(i) { return i.id === editingId; });
            invoiceNumber = existing && existing.invoiceNumber ? existing.invoiceNumber : null;
        }
        if (!invoiceNumber) {
            invoiceNumber = getNextInvoiceANumber();
            bumpInvoiceANumber(invoiceNumber);
        }

        const data = {
            clientId: clientId,
            carId: carId,
            date: date,
            fiscalReg: fiscalReg,
            tvaRegNo: tvaRegNo,
            tvaDefault: tvaDefault,
            items: invoiceItems,
            total: total,
            amountPaid: amountPaid,
            paymentStatus: paymentStatus,
            paidAt: paidAt,
            invoiceType: 'A',
            invoiceNumber: invoiceNumber
        };

        if (editingId) {
            const index = invoices.findIndex(function(i) { return i.id === editingId; });
            invoices[index] = { ...invoices[index], ...data, id: editingId, invoiceNumber: invoiceNumber };
        } else {
            const id = Date.now();
            savedId = id;
            invoices.push({ ...data, id: id });
        }

        invoiceAPage = 1;
        dbSetAll('invoices', invoices);
        renderInvoiceA();
        renderItems();
        renderClients();
        openInvoiceASavedModal(savedId);
    }

    // ======= DELETE (UPDATED + CALLBACK SUPPORT) =======
function deleteItem(type, id, onDone) {
  if (type === 'item') {
    if (!requireItemAdminAction()) return;
  } else {
    if (!requireAdminAction()) return;
  }

  uiConfirm('Are you sure you want to delete this ' + type + '?', () => {

    if (type === 'client') {
      const hasInvoices = invoices.some(inv => inv.clientId === id);
      const hasCars = cars.some(car => car.clientId === id);

      if (hasInvoices || hasCars) {
        uiError("You can't delete this client.\n\nDelete all invoices and cars first.");
        return;
      }

      clients = clients.filter(c => c.id !== id);
      dbSetAll('clients', clients);
      rebuildInvoiceClientCache();
renderClients();
      populateReportClientSelect();

      if (typeof onDone === 'function') onDone();

    } else if (type === 'car') {
      cars = cars.filter(c => c.id !== id);
      dbSetAll('cars', cars);
      renderCars();

      if (typeof onDone === 'function') onDone();

    } else if (type === 'item') {
      items = items.filter(i => i.id !== id);
      dbSetAll('items', items);
      rebuildBarcodeIndex();
      renderItems();

      if (typeof onDone === 'function') onDone();

    } else if (type === 'supplier') {
      suppliers = suppliers.filter(s => s.id !== id);
      dbSetAll('suppliers', suppliers);
      renderSuppliers();

      if (typeof onDone === 'function') onDone();

    } else if (type === 'serviceItem') {
      items = (items || []).filter(i => String(i.id) !== String(id));
      dbSetAll('items', items);
      syncServiceItemsFromItems();
      renderServiceItems();

      if (typeof onDone === 'function') onDone();

    } else if (type === 'employee') {
      employees = employees.filter(e => e.id !== id);
      dbSetAll('employees', employees);
      renderEmployees();

      if (typeof onDone === 'function') onDone();

    } else if (type === 'payroll') {
      const target = (payrollPayments || []).find(p => String(p.id) === String(id));
      if (target) {
        const emp = (employees || []).find(function(e) { return String(e.id) === String(target.employeeId); });
        if (emp) {
          const arr = ensureEmployeePayrollArray(emp).filter(function(p) { return String(p.id) !== String(target.id); });
          emp.payrollPayments = arr;
          dbSetAll('employees', employees);
        }
      }
      rebuildPayrollPaymentsFromEmployees();
      renderPayrollPayments();

      if (typeof onDone === 'function') onDone();

    } else if (type === 'expense') {
      expenses = expenses.filter(e => e.id !== id);
      dbSetAll('expenses', expenses);
      renderExpenses();

      if (typeof onDone === 'function') onDone();

    } else if (type === 'invoice') {
      const invoice = invoices.find(inv => inv.id === id);
      if (!invoice) return;

      uiChooseInvoiceDelete(option => {
        if (option === 0) return;

        if (option === 1) {
          if (!isInvoiceA(invoice)) {
            invoice.items.forEach(item => {
              if (!item.itemId) return;
              const idx = items.findIndex(i => i.id === item.itemId);
              if (idx !== -1) {
                adjustItemStock(
                  item.itemId,
                  item.warehouseId || getDefaultWarehouseId(),
                  +item.quantity
                );
              }
            });

            // Persist stock updates after restocking
            dbSetAll('items', items);
            renderItems();
          }
        }

        invoices = invoices.filter(inv => inv.id !== id);
        dbSetAll('invoices', invoices);
        renderInvoices();
        renderInvoiceA();
        renderClients();

        // ✅ callback AFTER actual delete + save
        if (typeof onDone === 'function') onDone();
      });
    }

  });
}


function deleteInvoiceFromClientView(invoiceId, clientId) {
  deleteItem('invoice', invoiceId, () => {
    showClientInvoices(clientId);
  });
}
    // ======= PRINT INVOICE (WITH LOGO + HEADER INFO) =======

    function getInvoicePrintStyle() {
        // "bold" = new layout, "classic" = old layout
        const v = dbGetSetting('invoice_print_style', 'bold');
        return (String(v || '').toLowerCase() === 'classic') ? 'classic' : 'bold';
    }

    function buildInvoiceHtmlClassic(invoice, client, car, f, logoHtml, headerHtml) {
        return `
            <html>
            <head>
                <title>Estimate ${invoice.invoiceNumber}</title>
                <style>
                    :root {
                        --ink: #1b2026;
                        --muted: #6a7077;
                        --line: #d9d3c9;
                        --brand: #0f4c5c;
                        --accent: #c97b3a;
                        --success: #1a7f37;
                        --danger: #b42318;
                    }
                    * { box-sizing: border-box; }
                    body { font-family: "Trebuchet MS", "Verdana", sans-serif; color: var(--ink); padding: 26px; }
                    .topbar { height: 6px; background: linear-gradient(90deg, var(--brand), var(--accent)); margin-bottom: 16px; }
                    h1 { margin: 0; font-size: 22px; letter-spacing: 1px; text-transform: uppercase; }
                    .title-row { display: flex; justify-content: space-between; align-items: center; margin: 10px 0 8px; }
                    .badge { border: 1px solid var(--line); border-left: 5px solid var(--accent); padding: 6px 12px; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; background: #faf6ef; }
                    .badge.paid { border-left-color: var(--success); color: var(--success); }
                    .badge.unpaid { border-left-color: var(--danger); color: var(--danger); }
                    .doc-box { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; font-size: 11px; background: #fbf7f0; }
                    .doc-box .label { color: var(--muted); font-size: 10px; letter-spacing: 0.6px; text-transform: uppercase; }

                    table { width: 100%; border-collapse: collapse; margin-top: 12px; border: 1px solid var(--line); }
                    th { background-color: #f7f2ea; color: var(--muted); font-size: 11px; letter-spacing: 0.4px; padding: 8px; text-align: left; border-bottom: 1px solid var(--line); }
                    td { padding: 8px; text-align: left; font-size: 12px; border-bottom: 1px solid var(--line); }
                    tbody tr:nth-child(even) { background: #faf6ef; }
                    .total { font-weight: 700; font-size: 14px; text-align: right; margin-top: 12px; border: 1px solid var(--line); padding: 10px; }

                    .header {
                        display: flex;
                        justify-content: space-between;
                        align-items: flex-start;
                        gap: 20px;
                        border-bottom: 1px solid var(--line);
                        padding-bottom: 10px;
                        margin-bottom: 12px;
                    }
                    .invoice-logo img { max-height: 70px; }
                    .invoice-header-info {
                        text-align: right;
                        font-size: 11px;
                        line-height: 1.4;
                        color: var(--muted);
                    }
                    .meta-grid {
                        display: grid;
                        grid-template-columns: 1fr 1fr;
                        gap: 10px 16px;
                        font-size: 12px;
                        background: #fbf7f0;
                        border: 1px solid var(--line);
                        border-radius: 10px;
                        padding: 10px 12px;
                    }
                    .meta-grid .label { color: var(--muted); font-size: 10px; letter-spacing: 0.6px; text-transform: uppercase; }
                    .footer { margin-top: 12px; font-size: 10px; color: var(--muted); display: flex; justify-content: space-between; }
                </style>
            </head>
            <body>
                <div class="topbar"></div>
                <div class="header">
                    ${logoHtml}
                    <div class="invoice-header-info">
                        ${headerHtml}
                    </div>
                </div>
                <div class="title-row">
                    <h1>Estimate</h1>
                    <div class="badge ${f.status === 'paid' ? 'paid' : 'unpaid'}">${f.status === 'paid' ? 'PAID' : 'UNPAID'}</div>
                </div>
                <div class="meta-grid">
                    <div>
                        <div class="label">Invoice #</div>
                        <div>${escapeHtml(invoice.invoiceNumber || '')}</div>
                    </div>
                    <div>
                        <div class="label">Date</div>
                        <div>${escapeHtml(invoice.date || '')}</div>
                    </div>
                    <div>
                        <div class="label">Client</div>
                        <div>${escapeHtml(client ? client.name : '')}</div>
                    </div>
                    <div>
                        <div class="label">Phone</div>
                        <div>${escapeHtml(client ? client.phone : '')}</div>
                    </div>
                    ${car ? `<div>
                        <div class="label">Vehicle</div>
                        <div>${escapeHtml(car.year + ' ' + car.make + ' ' + car.model + ' - ' + car.plate)}</div>
                    </div>` : '<div></div>'}
                    <div>
                        <div class="label">Amount Paid</div>
                        <div>${f.amountPaid.toFixed(2)}</div>
                    </div>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>Item</th>
                            <th>Quantity</th>
                            <th>Price</th>
                            <th>Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${(Array.isArray(invoice.items) ? invoice.items : []).map(function(item) {
                            const qty = Number(item.quantity) || 0;
                            const price = Number(item.price) || 0;
                            return `
                                <tr>
                                    <td>${escapeHtml(item.name || '')}</td>
                                    <td>${qty}</td>
                                    <td>${price.toFixed(2)}</td>
                                    <td>${(qty * price).toFixed(2)}</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
                <div class="total">TOTAL: ${f.total.toFixed(2)} &nbsp; | &nbsp; Remaining: ${f.remaining.toFixed(2)}</div>
                ${invoice.notes ? `<p><strong>Notes:</strong> ${escapeHtml(invoice.notes)}</p>` : ''}
                <div class="footer">
                    <div>Thank you for your business.</div>
                    <div></div>
                </div>
            </body>
            </html>
        `;
    }

    function buildInvoiceHtmlBold(invoice, client, car, f, logoHtml, headerHtml, headerLines) {
        const statusText = (f.status === 'paid') ? 'PAID' : 'UNPAID';
        const brandTitle = headerLines && headerLines.line1 ? escapeHtml(headerLines.line1) : '';
        return `
            <html>
            <head>
                <title>Invoice ${invoice.invoiceNumber}</title>
                <style>
                    :root {
                        --ink: #1b2026;
                        --muted: #6a7077;
                        --line: #d9d3c9;
                        --brand: #0f4c5c;
                        --accent: #c97b3a;
                        --success: #1a7f37;
                        --danger: #b42318;
                    }
                    * { box-sizing: border-box; }
                    body { font-family: "Trebuchet MS", "Verdana", sans-serif; color: var(--ink); padding: 26px; }
                    .topbar { height: 8px; background: linear-gradient(90deg, var(--brand), var(--accent)); margin-bottom: 16px; }
                    .header { display: flex; justify-content: space-between; gap: 20px; border-bottom: 1px solid var(--line); padding-bottom: 10px; margin-bottom: 12px; }
                    .brand { display: flex; gap: 12px; align-items: center; }
                    .brand .invoice-logo img { max-height: 64px; }
                    .brand-title { font-size: 20px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; }
                    .header-right { text-align: right; font-size: 11px; line-height: 1.4; color: var(--muted); }
                    .doc-box { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; font-size: 11px; background: #fbf7f0; margin-top: 6px; }
                    .doc-box .label { color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; }
                    .doc-box { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; font-size: 11px; background: #fbf7f0; margin-top: 6px; }
                    .doc-box .label { color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; }
                    .title-row { display: flex; justify-content: space-between; align-items: center; margin: 14px 0 6px; }
                    .doc-title { font-size: 22px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; }
                    .badge { border: 1px solid var(--line); border-left: 5px solid var(--accent); padding: 6px 12px; font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: 0.6px; background: #faf6ef; }
                    .badge.paid { border-left-color: var(--success); color: var(--success); }
                    .badge.unpaid { border-left-color: var(--danger); color: var(--danger); }
                    .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 18px; font-size: 12px; background: #fbf7f0; border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
                    .meta .label { color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; }
                    .meta div { font-weight: 600; }
                    table { width: 100%; border-collapse: collapse; margin-top: 16px; border: 1px solid var(--line); }
                    th { text-align: left; font-size: 11px; letter-spacing: 0.6px; color: var(--muted); background: #f7f2ea; padding: 8px 6px; border-bottom: 1px solid var(--line); }
                    td { padding: 8px 6px; font-size: 12px; border-bottom: 1px solid var(--line); }
                    tbody tr:nth-child(even) { background: #faf6ef; }
                    td.num { text-align: right; }
                    .summary { display: grid; grid-template-columns: 1fr 260px; gap: 16px; margin-top: 16px; }
                    .notes { color: var(--muted); font-size: 11px; border: 1px dashed var(--line); padding: 8px; border-radius: 8px; min-height: 42px; }
                    .totals { border: 2px solid var(--brand); padding: 10px 12px; background: #ffffff; }
                    .totals-row { display: flex; justify-content: space-between; margin: 6px 0; font-size: 12px; }
                    .totals-row strong { font-size: 14px; }
                    .footer { margin-top: 12px; font-size: 10px; color: var(--muted); display: flex; justify-content: space-between; }
                </style>
            </head>
            <body>
                <div class="topbar"></div>
                <div class="header">
                    <div class="brand">
                        ${logoHtml}
                        <div class="brand-title">${brandTitle}</div>
                    </div>
                    <div class="header-right">
                        ${headerHtml}
                        <div class="doc-box">
                            <div><span class="label">Invoice #</span><br>${escapeHtml(invoice.invoiceNumber || '')}</div>
                            <div style="margin-top:4px;"><span class="label">Date</span><br>${escapeHtml(invoice.date || '')}</div>
                        </div>
                    </div>
                </div>

                <div class="title-row">
                    <div class="doc-title">ESTIMATE</div>
                    <div class="badge ${f.status === 'paid' ? 'paid' : 'unpaid'}">${statusText}</div>
                </div>

                <div class="meta">
                    <div><span class="label">Date</span><br>${escapeHtml(invoice.date || '')}</div>
                    <div><span class="label">Estimate #</span><br>${escapeHtml(invoice.invoiceNumber || '')}</div>
                    <div><span class="label">Client</span><br>${escapeHtml(client ? client.name : '')}</div>
                    <div><span class="label">Phone</span><br>${escapeHtml(client ? client.phone : '')}</div>
                    ${car ? `<div><span class="label">Vehicle</span><br>${escapeHtml(car.year + ' ' + car.make + ' ' + car.model + ' - ' + car.plate)}</div>` : '<div></div>'}
                </div>

                <table>
                    <thead>
                        <tr>
                            <th style="width:52%;">ITEM</th>
                            <th style="width:12%;">QTY</th>
                            <th style="width:18%;">PRICE</th>
                            <th style="width:18%;" class="num">TOTAL</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${(Array.isArray(invoice.items) ? invoice.items : []).map(function(item) {
                            const qty = Number(item.quantity) || 0;
                            const price = Number(item.price) || 0;
                            return `
                                <tr>
                                    <td>${escapeHtml(item.name || '')}</td>
                                    <td>${qty}</td>
                                    <td>${price.toFixed(2)}</td>
                                    <td class="num">${(qty * price).toFixed(2)}</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>

                <div class="summary">
                    <div class="notes">
                        ${invoice.notes ? `<strong>Notes:</strong> ${escapeHtml(invoice.notes)}` : ''}
                    </div>
                    <div class="totals">
                        <div class="totals-row"><span>Subtotal</span><span>${f.total.toFixed(2)}</span></div>
                        <div class="totals-row"><span>Amount Paid</span><span>${f.amountPaid.toFixed(2)}</span></div>
                        <div class="totals-row"><span>Remaining</span><span>${f.remaining.toFixed(2)}</span></div>
                        <div class="totals-row"><strong>Total</strong><strong>${f.total.toFixed(2)}</strong></div>
                    </div>
                </div>

                <div class="footer">
                    <div>Thank you for your business.</div>
                    <div>${escapeHtml(headerLines.line3 || '')}</div>
                </div>
            </body>
            </html>
        `;
    }

    function buildInvoiceHtmlA(invoice, client, car, f, logoHtml, headerLines) {
        const tvaReg = invoice.tvaRegNo || getInvoiceTvaRegNo();
        const fiscalReg = invoice.fiscalReg || '';
        let subtotal = 0;
        let tvaTotal = 0;

        const rows = (invoice.items || []).map(function(item) {
            const qty = Number(item.quantity) || 0;
            const price = Number(item.price) || 0;
            const base = qty * price;
            const tva = item.tva ? base * 0.11 : 0;
            const total = base + tva;
            subtotal += base;
            tvaTotal += tva;
            return `
                <tr>
                    <td>${escapeHtml(item.name || '')}</td>
                    <td class="num">${price.toFixed(2)}</td>
                    <td class="num">${qty}</td>
                    <td class="num">${tva.toFixed(2)}</td>
                    <td class="num">${total.toFixed(2)}</td>
                </tr>
            `;
        }).join('');

        const totalWithTva = subtotal + tvaTotal;
        const brandTitle = headerLines.line1 ? escapeHtml(headerLines.line1) : '';
        const headerLine2 = headerLines.line2 ? `<div>${escapeHtml(headerLines.line2)}</div>` : '';
        const headerLine3 = headerLines.line3 ? `<div>${escapeHtml(headerLines.line3)}</div>` : '';
        const tvaLine = tvaReg ? `<div>TVA Registration No: ${escapeHtml(tvaReg)}</div>` : '';

        return `
            <html>
            <head>
                <title>Estimate ${invoice.invoiceNumber}</title>
                <style>
                    :root { --ink:#1b2026; --muted:#6a7077; --line:#d9d3c9; --brand:#0f4c5c; --accent:#c97b3a; }
                    * { box-sizing: border-box; }
                    body { font-family: "Trebuchet MS", "Verdana", sans-serif; color: var(--ink); padding: 24px; }
                    .topbar { height: 8px; background: linear-gradient(90deg, var(--brand), var(--accent)); margin-bottom: 14px; }
                    .header { display:flex; justify-content: space-between; gap: 20px; border-bottom: 1px solid var(--line); padding-bottom: 10px; margin-bottom: 12px; }
                    .brand { display:flex; gap: 12px; align-items: center; }
                    .brand .invoice-logo img { max-height: 70px; }
                    .brand-title { font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase; }
                    .header-right { text-align: right; font-size: 11px; line-height: 1.4; color: var(--muted); }
                    .title { text-align:center; font-size: 20px; font-weight: 800; letter-spacing: 1px; margin: 12px 0; text-transform: uppercase; }
                    .meta { display:flex; justify-content: space-between; gap: 20px; font-size: 12px; margin-bottom: 10px; background:#fbf7f0; border:1px solid var(--line); border-radius: 10px; padding: 8px 10px; }
                    .meta .block { line-height: 1.5; }
                    table { width:100%; border-collapse: collapse; margin-top: 10px; border:1px solid var(--line); }
                    th { background:#f7f2ea; text-align:left; color: var(--muted); font-size: 11px; letter-spacing: 0.5px; padding: 7px; border-bottom:1px solid var(--line); }
                    td { padding: 7px; font-size: 12px; border-bottom:1px solid var(--line); }
                    tbody tr:nth-child(even) { background:#faf6ef; }
                    td.num { text-align: right; }
                    .summary { display:grid; grid-template-columns: 1fr 260px; gap: 16px; margin-top: 12px; }
                    .totals { border: 2px solid var(--brand); padding: 10px; font-size: 12px; background: #ffffff; }
                    .totals-row { display:flex; justify-content: space-between; margin: 5px 0; }
                    .totals-row strong { font-size: 14px; }
                    .footer { margin-top: 10px; font-size: 10px; color: var(--muted); display:flex; justify-content: space-between; }
                </style>
            </head>
            <body>
                <div class="topbar"></div>
                <div class="header">
                    <div class="brand">
                        ${logoHtml}
                        <div class="brand-title">${brandTitle}</div>
                    </div>
                    <div class="header-right">
                        ${headerLine2}
                        ${headerLine3}
                        ${tvaLine}
                        <div class="doc-box">
                            <div><span class="label">Invoice #</span><br>${escapeHtml(invoice.invoiceNumber || '')}</div>
                            <div style="margin-top:4px;"><span class="label">Date</span><br>${escapeHtml(invoice.date || '')}</div>
                        </div>
                    </div>
                </div>

                <div class="title">Invoice A</div>

                <div class="meta">
                    <div class="block">
                        <div><strong>To:</strong> ${escapeHtml(client ? client.name : '')}</div>
                        <div>${escapeHtml(client ? client.phone : '')}</div>
                    </div>
                    <div class="block" style="text-align:right;">
                        <div><strong>Invoice No:</strong> ${escapeHtml(invoice.invoiceNumber || '')}</div>
                        <div><strong>Invoice Date:</strong> ${escapeHtml(invoice.date || '')}</div>
                        <div><strong>Fiscal Reg:</strong> ${escapeHtml(fiscalReg)}</div>
                    </div>
                </div>

                <div class="meta">
                    <div class="block"><strong>Registration:</strong> ${escapeHtml(car ? (car.plate || '') : '')}</div>
                    <div class="block" style="text-align:right;"><strong>Chassis No:</strong> ${escapeHtml(car ? (car.vin || '') : '')}</div>
                </div>

                <table>
                    <thead>
                        <tr>
                            <th>Description</th>
                            <th class="num">Price($)</th>
                            <th class="num">Qty</th>
                            <th class="num">TVA(11%)</th>
                            <th class="num">Total($)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows}
                    </tbody>
                </table>

                <div class="summary">
                    <div></div>
                    <div class="totals">
                        <div class="totals-row"><span>Subtotal</span><span>${subtotal.toFixed(2)}</span></div>
                        <div class="totals-row"><span>Amount Paid</span><span>${f.amountPaid.toFixed(2)}</span></div>
                        <div class="totals-row"><span>Remaining</span><span>${f.remaining.toFixed(2)}</span></div>
                        <div class="totals-row"><strong>Total</strong><strong>${(totalWithTva || f.total).toFixed(2)}</strong></div>
                    </div>
                </div>
                <div class="footer">
                    <div>Thank you for your business.</div>
                    <div>${escapeHtml(headerLines.line3 || '')}</div>
                </div>
            </body>
            </html>
        `;
    }

    function printInvoice(id) {
        const invoice = invoices.find(function(i) { return i.id === id; });
        if (!invoice) return;

        const client = clients.find(function(c) { return c.id === invoice.clientId; });
        const car = invoice.carId ? cars.find(function(c) { return c.id === invoice.carId; }) : null;
        const f = getInvoiceFinancials(invoice);

        // Get logo as data URL from storage
        let logoDataUrl = '';
        try {
            logoDataUrl = getLogoDataUrl();
        } catch (e) {
            logoDataUrl = '';
        }
        const logoHtml = logoDataUrl
            ? `<div class="invoice-logo"><img src="${logoDataUrl}" alt="Logo"></div>`
            : `<div class="invoice-logo"></div>`;

        const headerLines = getInvoiceHeaderLines();
        const headerLine1 = headerLines.line1 ? `<div><strong>${escapeHtml(headerLines.line1)}</strong></div>` : '';
        const headerLine2 = headerLines.line2 ? `<div>${escapeHtml(headerLines.line2)}</div>` : '';
        const headerLine3 = headerLines.line3 ? `<div>${escapeHtml(headerLines.line3)}</div>` : '';
        const headerHtml = headerLine1 + headerLine2 + headerLine3;

        const style = getInvoicePrintStyle();
        const html = (style === 'classic')
            ? buildInvoiceHtmlClassic(invoice, client, car, f, logoHtml, headerHtml)
            : buildInvoiceHtmlBold(invoice, client, car, f, logoHtml, headerHtml, headerLines);

        const printWindow = window.open('', '', 'width=900,height=700');
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.print();
    }

    function printInvoiceA(id) {
        const invoice = invoices.find(function(i) { return i.id === id; });
        if (!invoice) return;

        const client = clients.find(function(c) { return c.id === invoice.clientId; });
        const car = invoice.carId ? cars.find(function(c) { return c.id === invoice.carId; }) : null;
        const f = getInvoiceFinancials(invoice);

        let logoDataUrl = '';
        try {
            logoDataUrl = getLogoDataUrl();
        } catch (e) {
            logoDataUrl = '';
        }
        const logoHtml = logoDataUrl
            ? `<div class="invoice-logo"><img src="${logoDataUrl}" alt="Logo"></div>`
            : `<div class="invoice-logo"></div>`;

        const headerLines = getInvoiceHeaderLines();
        const html = buildInvoiceHtmlA(invoice, client, car, f, logoHtml, headerLines);

        const printWindow = window.open('', '', 'width=900,height=700');
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.print();
    }

    // ======= CLIENT BALANCE =======

    function getClientBalance(clientId) {
        const unpaidTotal = invoices
            .filter(function(inv) { return inv.clientId === clientId; })
            .reduce(function(sum, inv) {
                const f = getInvoiceFinancials(inv);
                return sum + f.remaining;
            }, 0);
        return unpaidTotal;
    }
function togglePaymentStatus(invoiceId) {
    const invoice = (Array.isArray(invoices) ? invoices : []).find(function (inv) {
        return String(inv.id) === String(invoiceId);
    });

    if (!invoice) {
        try {
            if (typeof uiError === 'function') uiError('Invoice not found.');
        } catch (e) {}
        return;
    }

    // Get current financial state
    const f = getInvoiceFinancials(invoice);

    const today = new Date().toISOString().split('T')[0];
    // Toggle paid / unpaid
    if (f.status === 'paid') {
        invoice.amountPaid = 0;
        invoice.paidAt = null;
    } else {
        invoice.amountPaid = f.total;
        invoice.paidAt = today;
    }

    // Recompute & store status
    const f2 = getInvoiceFinancials(invoice);
    invoice.paymentStatus = f2.status;
    if (invoice.paymentStatus !== 'paid') {
        invoice.paidAt = null;
    }

    // Persist changes (single-row update to avoid full rewrite)
    try {
        if (window.garageDB && typeof window.garageDB.upsert === 'function') {
            window.garageDB.upsert('invoices', invoice);
        } else if (typeof dbSetAll === 'function') {
            dbSetAll('invoices', invoices);
        } else if (typeof dbPersistAll === 'function') {
            dbPersistAll();
        }
    } catch (e) {}

    // Re-render UI
    renderInvoices();
    renderInvoiceA();
    renderClients();
}

// Bind once: handle Mark Paid/Unpaid buttons via event delegation
if (!window.__togglePaymentHandlerBound) {
    window.__togglePaymentHandlerBound = true;
    document.addEventListener('click', function (e) {
        const btn = e.target.closest('.js-toggle-payment');
        if (!btn) return;
        const id = btn.getAttribute('data-invoice-id');
        togglePaymentStatus(id);
    });
}

function markClientPaid(clientId) {
    const cid = String(clientId || '');
    if (!cid) return;

    const run = function() {
        const today = new Date().toISOString().split('T')[0];
        const updated = [];

        (invoices || []).forEach(function(inv) {
            if (!inv || inv.isPayment) return;
            if (String(inv.clientId || '') !== cid) return;

            const f = getInvoiceFinancials(inv);
            if (f.status === 'paid') return;

            inv.amountPaid = f.total;
            inv.paidAt = today;

            const f2 = getInvoiceFinancials(inv);
            inv.paymentStatus = f2.status;
            if (inv.paymentStatus !== 'paid') inv.paidAt = null;

            updated.push(inv);
        });

        if (updated.length === 0) {
            try { if (typeof uiError === 'function') uiError('No unpaid invoices for this client.'); } catch (e) {}
            return;
        }

        try {
            if (window.garageDB && typeof window.garageDB.upsert === 'function') {
                updated.forEach(function(inv) { window.garageDB.upsert('invoices', inv); });
            } else if (typeof dbSetAll === 'function') {
                dbSetAll('invoices', invoices);
            } else if (typeof dbPersistAll === 'function') {
                dbPersistAll();
            }
        } catch (e) {}

        renderInvoices();
        renderInvoiceA();
        renderClients();
        renderReportClientBalances();
    };

    if (typeof uiConfirm === 'function') {
        uiConfirm('Mark all unpaid invoices as paid for this client?', run);
    } else {
        run();
    }
}

if (!window.__markClientPaidHandlerBound) {
    window.__markClientPaidHandlerBound = true;
    document.addEventListener('click', function(e) {
        const btn = e.target.closest('.js-mark-client-paid');
        if (!btn) return;
        const id = btn.getAttribute('data-client-id');
        markClientPaid(id);
    });
}

    // ======= SHOW CLIENT INVOICES (FROM CLIENT TAB) =======

function showClientInvoices(clientId) {
    const modal = document.getElementById('modal');
    const title = document.getElementById('modalTitle');
    const body = document.getElementById('modalBody');

    const cachedClient = (clients || []).find(function(c) { return c.id === clientId; });
    if (title) title.textContent = 'Invoices - ' + (cachedClient ? cachedClient.name : 'Client');
    if (body) {
        body.innerHTML = `
            <p>Loading invoices...</p>
            <div class="modal-footer">
                <button class="btn" onclick="closeModal()">Close</button>
            </div>
        `;
    }
    if (modal) modal.classList.add('active');

    const render = function() {
        if (modal && !modal.classList.contains('active')) return;
        const client = clients.find(function(c) { return c.id === clientId; });
        const clientInvoices = invoices.filter(function(inv) { return inv.clientId === clientId; });
        const standardInvoices = clientInvoices.filter(function(inv){ return !isInvoiceA(inv) && !inv.isPayment; });
        const invoiceAList = clientInvoices.filter(function(inv){ return isInvoiceA(inv) && !inv.isPayment; });

        title.textContent = 'Invoices - ' + (client ? client.name : 'Client');

        if (clientInvoices.length === 0) {
            body.innerHTML = `
                <p>This client has no invoices yet.</p>
                <div class="modal-footer">
                    <button class="btn" onclick="closeModal()">Close</button>
                </div>
            `;
            return;
        }

        function buildInvoiceRows(list, isA) {
            return list.map(function(inv) {
                const car = inv.carId ? cars.find(function(c) { return c.id === inv.carId; }) : null;
                const f = getInvoiceFinancials(inv);
                const statusClass = f.status === 'paid' ? 'status-paid' : 'status-unpaid';
                const statusText = f.status === 'paid' ? '✓ PAID' : '⏳ UNPAID';
                const printFn = isA ? 'printInvoiceA' : 'printInvoice';
                const editFn = isA ? "openModal('invoiceA'," : "openModal('invoice',";
                const viewFn = isA ? 'openInvoiceASavedModal' : 'openInvoiceSavedModal';
                return `
                    <tr>
                        <td>${inv.invoiceNumber}</td>
                        <td>${inv.date}</td>
                        <td>${car ? (car.make + ' ' + car.model) : 'N/A'}</td>
                        <td>${f.total.toFixed(2)}</td>
                        <td>${f.amountPaid.toFixed(2)}</td>
                        <td>${f.remaining.toFixed(2)}</td>
                        <td class="${statusClass}">${statusText}</td>
                        <td class="actions">
                            <button class="btn btn-secondary btn-small" onclick="${viewFn}(${inv.id})">View</button>
                            <button class="btn btn-success btn-small" onclick="${printFn}(${inv.id})">Print</button>
                            <button class="icon-btn edit" title="Edit" onclick="${editFn} ${inv.id})">✏️</button>
                            <button class="icon-btn delete" title="Delete" onclick="deleteInvoiceFromClientView(${inv.id}, ${clientId})">🗑️</button>
                        </td>
                    </tr>
                `;
            }).join('');
        }

        body.innerHTML = `
            <h4 style="margin:8px 0;">Invoices</h4>
            ${standardInvoices.length === 0 ? `<p>No standard invoices.</p>` : `
            <div style="display:flex; justify-content:flex-end; margin:6px 0 10px;">
                <button class="btn btn-success btn-small" onclick="printAllClientInvoices(${clientId}, 'standard')">Print All Invoices</button>
            </div>
            <table>
                <thead>
                    <tr>
                        <th>Invoice #</th>
                        <th>Date</th>
                        <th>Car</th>
                        <th>Total</th>
                        <th>Paid</th>
                        <th>Remaining</th>
                        <th>Status</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${buildInvoiceRows(standardInvoices, false)}
                </tbody>
            </table>
            `}

            <h4 style="margin:16px 0 8px;">Invoices A</h4>
            ${invoiceAList.length === 0 ? `<p>No Invoice A records.</p>` : `
            <div style="display:flex; justify-content:flex-end; margin:6px 0 10px;">
                <button class="btn btn-success btn-small" onclick="printAllClientInvoices(${clientId}, 'A')">Print All Invoices A</button>
            </div>
            <table>
                <thead>
                    <tr>
                        <th>Invoice #</th>
                        <th>Date</th>
                        <th>Car</th>
                        <th>Total</th>
                        <th>Paid</th>
                        <th>Remaining</th>
                        <th>Status</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${buildInvoiceRows(invoiceAList, true)}
                </tbody>
            </table>
            `}

            <div class="modal-footer">
                <button class="btn" onclick="closeModal()">Close</button>
            </div>
        `;
    };

    const refreshThenRender = function() {
        try {
            if (window.garageDB) {
                clients = window.garageDB.getAll('clients') || clients || [];
                cars = window.garageDB.getAll('cars') || cars || [];
                invoices = window.garageDB.getAll('invoices') || invoices || [];
            }
        } catch (e) {}
        render();
    };

    if (typeof window.__garageRefreshCache === 'function') {
        window.__garageRefreshCache()
            .then(refreshThenRender)
            .catch(refreshThenRender);
        return;
    }

    refreshThenRender();
}

function printAllClientInvoices(clientId, type) {
    const list = (invoices || []).filter(function(inv) {
        if (inv.clientId !== clientId) return false;
        if (type === 'A') return isInvoiceA(inv) && !inv.isPayment;
        if (type === 'standard') return !isInvoiceA(inv) && !inv.isPayment;
        return true;
    });
    if (!list.length) {
        uiError('No invoices to print.');
        return;
    }

    const sorted = list.slice().sort(function(a, b) {
        const aDate = String(a.date || '');
        const bDate = String(b.date || '');
        if (aDate && bDate && aDate !== bDate) return aDate < bDate ? -1 : 1;
        return (a.id || 0) - (b.id || 0);
    });

    function extractPrintParts(html) {
        if (!html) return { styles: '', body: '' };
        const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
        const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        return {
            styles: styleMatch ? styleMatch[1] : '',
            body: bodyMatch ? bodyMatch[1] : html
        };
    }

    const style = getInvoicePrintStyle();
    const styles = new Set();
    const pages = [];

    sorted.forEach(function(inv) {
        const client = clients.find(function(c) { return c.id === inv.clientId; });
        const car = inv.carId ? cars.find(function(c) { return c.id === inv.carId; }) : null;
        const f = getInvoiceFinancials(inv);

        let logoDataUrl = '';
        try { logoDataUrl = getLogoDataUrl(); } catch (e) { logoDataUrl = ''; }
        const logoHtml = logoDataUrl
            ? `<div class="invoice-logo"><img src="${logoDataUrl}" alt="Logo"></div>`
            : `<div class="invoice-logo"></div>`;

        const headerLines = getInvoiceHeaderLines();
        const headerLine1 = headerLines.line1 ? `<div><strong>${escapeHtml(headerLines.line1)}</strong></div>` : '';
        const headerLine2 = headerLines.line2 ? `<div>${escapeHtml(headerLines.line2)}</div>` : '';
        const headerLine3 = headerLines.line3 ? `<div>${escapeHtml(headerLines.line3)}</div>` : '';
        const headerHtml = headerLine1 + headerLine2 + headerLine3;

        const html = isInvoiceA(inv)
            ? buildInvoiceHtmlA(inv, client, car, f, logoHtml, headerLines)
            : (style === 'classic'
                ? buildInvoiceHtmlClassic(inv, client, car, f, logoHtml, headerHtml)
                : buildInvoiceHtmlBold(inv, client, car, f, logoHtml, headerHtml, headerLines));

        const parts = extractPrintParts(html);
        if (parts.styles) styles.add(parts.styles);
        pages.push(parts.body);
    });

    const combinedStyles = Array.from(styles).join('\n');
    const pagesHtml = pages.map(function(body, idx) {
        const breakStyle = (idx === pages.length - 1) ? '' : 'style="page-break-after: always;"';
        return `<div class="print-page" ${breakStyle}>${body}</div>`;
    }).join('');

    const combinedHtml = `
        <html>
        <head>
            <title>Invoices - ${clientId}</title>
            <style>
                .print-page { page-break-after: always; }
                .print-page:last-child { page-break-after: auto; }
            </style>
            <style>${combinedStyles}</style>
        </head>
        <body>
            ${pagesHtml}
        </body>
        </html>
    `;

    const printWindow = window.open('', '', 'width=900,height=700');
    printWindow.document.write(combinedHtml);
    printWindow.document.close();
    printWindow.print();
}

    // ======= SHOW CLIENT CARS (FROM CLIENT TAB) =======

    function showClientCars(clientId) {
        const modal = document.getElementById('modal');
        const title = document.getElementById('modalTitle');
        const body = document.getElementById('modalBody');

        const cachedClient = (clients || []).find(function(c) { return c.id === clientId; });
        if (title) title.textContent = 'Cars - ' + (cachedClient ? cachedClient.name : 'Client');
        if (body) {
            body.innerHTML = `
                <p>Loading cars...</p>
                <div class="modal-footer">
                    <button class="btn" onclick="closeModal()">Close</button>
                </div>
            `;
        }
        if (modal) modal.classList.add('active');

        const render = function() {
            if (modal && !modal.classList.contains('active')) return;
            const client = clients.find(function(c) { return c.id === clientId; });
            const clientCars = cars.filter(function(car) { return car.clientId === clientId; });

            title.textContent = 'Cars - ' + (client ? client.name : 'Client');

            if (clientCars.length === 0) {
                body.innerHTML = `
                    <p>This client has no cars registered.</p>
                    <div class="modal-footer">
                        <button class="btn btn-primary" data-admin-only="1" onclick="addCarForClient(${clientId})">+ Add Car</button>
                        <button class="btn" onclick="closeModal()">Close</button>
                    </div>
                `;
            } else {
                const rows = clientCars.map(function(car) {
                    return `
                        <tr>
                            <td>${car.make}</td>
                            <td>${car.model}</td>
                            <td>${car.year}</td>
                            <td>${car.plate}</td>
                            <td>${car.vin || ''}</td>
                            <td class="actions">
                                <button class="btn btn-success btn-small" onclick="quickInvoiceForCar(${car.id})">Invoice</button>
                                <button class="icon-btn edit" title="Edit" onclick="openModal(\'car\', ${car.id})">✏️</button>
                                <button class="icon-btn delete" title="Delete" onclick="deleteItem(\'car\', ${car.id})">🗑️</button>
                            </td>
                        </tr>
                    `;
                }).join('');

                body.innerHTML = `
                    <table>
                        <thead>
                            <tr>
                                <th>Make</th>
                                <th>Model</th>
                                <th>Year</th>
                                <th>Plate</th>
                                <th>VIN</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows}
                        </tbody>
                    </table>
                    <div class="modal-footer">
                        <button class="btn btn-primary" data-admin-only="1" onclick="addCarForClient(${clientId})">+ Add Car</button>
                        <button class="btn" onclick="closeModal()">Close</button>
                    </div>
                `;
            }

        };

        const refreshThenRender = function() {
            try {
                if (window.garageDB) {
                    clients = window.garageDB.getAll('clients') || clients || [];
                    cars = window.garageDB.getAll('cars') || cars || [];
                }
            } catch (e) {}
            render();
        };

        if (typeof window.__garageRefreshCache === 'function') {
            window.__garageRefreshCache()
                .then(refreshThenRender)
                .catch(refreshThenRender);
            return;
        }

        refreshThenRender();
    }

    // ======= RENDER FUNCTIONS =======

    
function renderClients() {
    try {
        if (window.garageDB) {
            clients = window.garageDB.getAll('clients') || clients || [];
        }
    } catch (e) {}
    try {
        if (window.garageDB) {
            cars = window.garageDB.getAll('cars') || cars || [];
        }
    } catch (e) {}
    try { rebuildClientIndex(); } catch (e) {}
    const tbody = document.querySelector('#clientsTable tbody');

        // filter (search)
        // ✅ also searches in the client's cars: plate / VIN / chassis / make / model / year
        // Make sure car index is fresh (fast enough and avoids missing newly added cars)
        try { rebuildClientCarsSearchIndex(); } catch(e) {}
        try { rebuildClientCarsLabelMap(); } catch(e) {}

        const filtered = (clients || []).filter(function(c) {
            if (!clientSearchTerm) return true;
            const name = (c.name || '').toLowerCase();
            const phone = (c.phone || '').toLowerCase();
            const carBlob = getClientCarsSearchString(c.id); // already lowercased
            return name.includes(clientSearchTerm) ||
                   phone.includes(clientSearchTerm) ||
                   (carBlob && carBlob.includes(clientSearchTerm));
        });
        const sorted = filtered.slice().sort(function(a, b) {
            const aKey = Number((a && (a.createdAt ?? a.updatedAt ?? a.id)) || 0);
            const bKey = Number((b && (b.createdAt ?? b.updatedAt ?? b.id)) || 0);
            if (!Number.isFinite(aKey) && !Number.isFinite(bKey)) return 0;
            if (!Number.isFinite(aKey)) return 1;
            if (!Number.isFinite(bKey)) return -1;
            return bKey - aKey;
        });

        // pagination
        const total = sorted.length;
        const totalPages = Math.max(1, Math.ceil(total / clientPageSize));
        if (clientPage > totalPages) clientPage = totalPages;

        const startIdx = (clientPage - 1) * clientPageSize;
        const pageRows = sorted.slice(startIdx, startIdx + clientPageSize);

        tbody.innerHTML = pageRows.map(function(c) {
            const balance = getClientBalance(c.id);
            const balanceClass = balance > 0 ? 'balance-negative' : 'balance-positive';
            const carLabel = getClientCarsLabel(c.id);
            const safeName = _esc(c.name || '');
            const tooltip = carLabel ? _esc((c.name || '') + ': ' + carLabel) : '';
            const nameHtml = tooltip ? `<span class="client-name" title="${tooltip}">${safeName}</span>` : safeName;
            return `
                <tr>
                    <td>${nameHtml}</td>
                    <td>${c.phone}</td>
                    <td>${c.email || ''}</td>
                    <td>${c.address || ''}</td>
                    <td class="${balanceClass}">
                        ${balance.toFixed(2)}
                        <button class="btn btn-small btn-primary" onclick="showClientInvoices(${c.id})">View Invoices</button>
                    </td>
                    <td class="actions">
                        <button class="icon-btn cars" title="Cars" onclick="showClientCars(${c.id})">🚗</button>
                        ${hasPerm("*") ? `<button class="btn btn-primary btn-small" onclick="addCarForClient(${c.id})">+ Car</button>` : ``}
                        ${hasPerm("*") ? `<button class="btn btn-success btn-small" onclick="quickInvoiceForClient(${c.id})">Invoice</button>` : ``}
                        ${hasPerm("*") ? `<button class="icon-btn edit" title="Edit" onclick="openModal(\'client\', ${c.id})">✏️</button>` : ``}
                        ${hasPerm("*") ? `<button class="icon-btn delete" title="Delete" onclick="deleteItem(\'client\', ${c.id})">🗑️</button>` : ``}
                    </td>
                </tr>
            `;
        }).join('');

        // update pager UI
        const pageInfo = document.getElementById('clientsPageInfo');
        const countInfo = document.getElementById('clientsCountInfo');
        const prevBtn = document.getElementById('clientsPrevBtn');
        const nextBtn = document.getElementById('clientsNextBtn');
        const sizeSel = document.getElementById('clientsPageSize');

        if (pageInfo) pageInfo.textContent = `Page ${clientPage} / ${totalPages}`;
        if (countInfo) {
            const from = total === 0 ? 0 : (startIdx + 1);
            const to = Math.min(startIdx + clientPageSize, total);
            countInfo.textContent = `Showing ${from}-${to} of ${total}`;
        }
        if (prevBtn) prevBtn.disabled = (clientPage <= 1);
        if (nextBtn) nextBtn.disabled = (clientPage >= totalPages);
        if (sizeSel && String(sizeSel.value) !== String(clientPageSize)) sizeSel.value = String(clientPageSize);
    }


    function renderCars() {
  // ✅ Always read latest from DB cache (prevents empty lists if init order changes)
  try { if (window.garageDB) { cars = window.garageDB.getAll('cars') || cars || []; } } catch(e) {}

        const tbody = document.querySelector('#carsTable tbody');

        // filter (search)
        const filtered = (cars || []).filter(function(c) {
            if (!carSearchTerm) return true;
            const plate = (c.plate || '').toLowerCase();
            const vin = (c.vin || '').toLowerCase();
            const make = (c.make || '').toLowerCase();
            const model = (c.model || '').toLowerCase();
            const year = (String(c.year || '')).toLowerCase();
            const modelYear = (model + ' ' + year).trim();
            const client = clientById.get(c.clientId);
            const clientName = (client && client.name ? client.name : '').toLowerCase();

            return plate.includes(carSearchTerm) ||
                   vin.includes(carSearchTerm) ||
                   make.includes(carSearchTerm) ||
                   model.includes(carSearchTerm) ||
                   modelYear.includes(carSearchTerm) ||
                   clientName.includes(carSearchTerm);
        });

        const sorted = filtered.slice().sort(function(a, b) {
            const aKey = Number((a && (a.createdAt ?? a.updatedAt ?? a.id)) || 0);
            const bKey = Number((b && (b.createdAt ?? b.updatedAt ?? b.id)) || 0);
            if (!Number.isFinite(aKey) && !Number.isFinite(bKey)) return 0;
            if (!Number.isFinite(aKey)) return 1;
            if (!Number.isFinite(bKey)) return -1;
            return bKey - aKey;
        });

        // pagination
        const total = sorted.length;
        const totalPages = Math.max(1, Math.ceil(total / carPageSize));
        if (carPage > totalPages) carPage = totalPages;

        const startIdx = (carPage - 1) * carPageSize;
        const pageRows = sorted.slice(startIdx, startIdx + carPageSize);

        tbody.innerHTML = pageRows.map(function(c) {
            const client = clientById.get(c.clientId);
            return `
                <tr>
                    <td>${client ? client.name : 'N/A'}</td>
                    <td>${c.make || ''}</td>
                    <td>${c.model || ''}</td>
                    <td>${c.year || ''}</td>
                    <td>${c.plate || ''}</td>
                    <td>${c.vin || ''}</td>
                    <td class="actions">
                        ${hasPerm("*") ? `<button class="btn btn-success btn-small" onclick="quickInvoiceForCar(${c.id})">Invoice</button>` : ``}
                        ${hasPerm("*") ? `<button class="icon-btn edit" title="Edit" onclick="openModal(\'car\', ${c.id})">✏️</button>` : ``}
                        ${hasPerm("*") ? `<button class="icon-btn delete" title="Delete" onclick="deleteItem(\'car\', ${c.id})">🗑️</button>` : ``}
                    </td>
                </tr>
            `;
        }).join('');

        // pager UI update
        const pageInfo = document.getElementById('carsPageInfo');
        const countInfo = document.getElementById('carsCountInfo');
        const prevBtn = document.getElementById('carsPrevBtn');
        const nextBtn = document.getElementById('carsNextBtn');
        const sizeSel = document.getElementById('carsPageSize');

        if (pageInfo) pageInfo.textContent = `Page ${carPage} / ${totalPages}`;
        if (countInfo) {
            const from = total === 0 ? 0 : (startIdx + 1);
            const to = Math.min(startIdx + carPageSize, total);
            countInfo.textContent = `Showing ${from}-${to} of ${total}`;
        }
        if (prevBtn) prevBtn.disabled = (carPage <= 1);
        if (nextBtn) nextBtn.disabled = (carPage >= totalPages);
        if (sizeSel && String(sizeSel.value) !== String(carPageSize)) sizeSel.value = String(carPageSize);
    }

    // SHOW ITEM IMAGE LARGE IN MODAL
    function showItemImage(url, name) {
        const modal = document.getElementById('modal');
        const title = document.getElementById('modalTitle');
        const body = document.getElementById('modalBody');

        currentType = 'image';
        editingId = null;

        const safeUrl = (url || '').replace(/"/g, '&quot;');
        const safeName = (name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        title.textContent = name || 'Item Image';

        body.innerHTML = `
            <div style="text-align:center;">
                <img src="${safeUrl}" alt="${safeName}"
                     style="max-width:100%; max-height:80vh; border-radius:8px;">
            </div>
            <div class="modal-footer">
                <button class="btn" onclick="closeModal()">Close</button>
            </div>
        `;

        modal.classList.add('active');
    }
function formatMoney(value) {
    const num = Number(value) || 0;
    return num.toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    });
}

function formatLbp(value) {
    const num = Number(value) || 0;
    return num.toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    });
}

function toNum(v) {
    if (v === null || v === undefined || v === '') return 0;
    const n = Number(v);
    return isNaN(n) ? 0 : n;
}

 
function renderItems() {
  // ✅ Always read latest from DB cache
  try {
    if (window.garageDB) {
      items = window.garageDB.getAll('items') || items || [];
    }
  } catch (e) {}

  const tbody = document.querySelector('#itemsTable tbody');
  if (!tbody) return;

  // ---- helpers (safe fallback, prevents errors) ----
  const _toNum = (typeof toNum === 'function')
    ? toNum
    : function(v){ const n = Number(v); return isNaN(n) ? 0 : n; };

  const _formatMoney = (typeof formatMoney === 'function')
    ? formatMoney
    : function(n){
        const x = Number(n);
        if (isNaN(x)) return '0';
        return x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      };

  const _canItemsAdmin = (typeof hasItemAdminAccess === 'function')
    ? hasItemAdminAccess
    : (typeof hasPerm === 'function' ? function(){ return hasPerm("*"); } : function(){ return true; });

  const _safeInt = (typeof safeInt === 'function')
    ? safeInt
    : function(n){ const x = parseInt(n, 10); return isNaN(x) ? 0 : x; };

  const _ensureItemPricing = (typeof ensureItemPricing === 'function')
    ? ensureItemPricing
    : function(it){ return it; };

  const _ensureItemQuantities = (typeof ensureItemQuantities === 'function')
    ? ensureItemQuantities
    : function(it){ return { quantities: (it && it.quantities) || {} }; };

  const _getItemTotalQty = (typeof getItemTotalQty === 'function')
    ? getItemTotalQty
    : function(it){ return _safeInt(it && it.quantity); };

  // escape for HTML attributes
  function escAttr(s) {
    return String(s == null ? '' : s).replace(/"/g, '&quot;');
  }

  // escape for JS string inside onclick='...'
  function escJs(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'");
  }

  // ---- filter (search) ----
  const term = String(itemSearchTerm || '');
  const filtered = (items || []).filter(function(i) {
    if (isServiceItem(i)) return false;
    if (!term) return true;
    const name = (i.name || '').toLowerCase();
    const part = (i.partNumber || '').toLowerCase();
    const loc  = (i.location || '').toLowerCase();
    const bc   = String(i.barcode || '').toLowerCase();
    const desc = (i.description || '').toLowerCase();
    return (
      name.includes(term) ||
      part.includes(term) ||
      loc.includes(term) ||
      bc.includes(term) ||
      desc.includes(term)
    );
  });

  // ---- pagination ----
  const pageSize = (typeof itemPageSize !== 'undefined' ? itemPageSize : 10);
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (typeof itemPage === 'undefined') window.itemPage = 1;
  if (itemPage > totalPages) itemPage = totalPages;
  if (itemPage < 1) itemPage = 1;

  const startIdx = (itemPage - 1) * pageSize;
  const pageRows = filtered.slice(startIdx, startIdx + pageSize);

  tbody.innerHTML = pageRows.map(function(i) {
    _ensureItemPricing(i);

    const selling = _toNum(i.sellingPrice);
    const cost    = _toNum(i.costPrice);

    // ✅ photo (backward compatible fields)
    const imgUrl = String(
      i.image || i.photo || i.photoDataUrl || i.photoUrl || i.imageDataUrl || ''
    ).trim();

    const photoTd = imgUrl
      ? `
        <div class="photo-cell">
          <img class="item-thumb"
               src="${escAttr(imgUrl)}"
               alt="img"
               onclick="${typeof showItemImage === 'function'
                 ? `showItemImage('${escJs(imgUrl)}','${escJs(i.name || '')}')`
                 : ''}">
        </div>`
      : `<div class="photo-cell"></div>`;

    // qty tooltip breakdown (warehouses)
    const { quantities } = _ensureItemQuantities(i);
    const whs = (Array.isArray(window.warehouses) ? warehouses : []);
    const breakdownText = whs.map(w => `${w.name}: ${_safeInt(quantities[String(w.id)])}`).join(' | ');
    const qtyTitle = breakdownText ? `title="${escAttr(breakdownText)}"` : '';

    // low stock
    const minStock = _safeInt(i.minStock || i.lowStockThreshold || 0);
    const qty = _safeInt(_getItemTotalQty(i));
    const isLow = (minStock > 0 && qty <= minStock);
    const lowStockClass = isLow ? 'low-stock' : '';
    const lowCell = minStock ? `${isLow ? '🚩 ' : ''}${minStock}` : '';

    // cost tooltip on part number (admin only)
    const partTitle = _canItemsAdmin() ? `title="${escAttr(cost)}"` : '';

    return `
      <tr class="${lowStockClass}">
        <td>${i.name || ''}</td>
        <td ${partTitle}>${i.partNumber || ''}</td>
        <td>${i.location || ''}</td>
        <td>${_formatMoney(selling)}</td>
        <td>${_canItemsAdmin() ? _formatMoney(cost) : ''}</td>
        <td ${qtyTitle}>${qty}</td>
        <td>${lowCell}</td>
        <td>${photoTd}</td>
        <td>${i.description || ''}</td>
        <td class="actions">
          ${_canItemsAdmin() ? `<button class="icon-btn edit" title="Edit" onclick="openModal(\'item\', ${i.id})">✏️</button>` : ``}
          ${_canItemsAdmin() ? `<button class="icon-btn delete" title="Delete" onclick="deleteItem(\'item\', ${i.id})">🗑️</button>` : ``}
        </td>
      </tr>
    `;
  }).join('');

  // ---- pager UI update ----
  const pageInfo = document.getElementById('itemsPageInfo');
  const countInfo = document.getElementById('itemsCountInfo');
  const prevBtn = document.getElementById('itemsPrevBtn');
  const nextBtn = document.getElementById('itemsNextBtn');
  const sizeSel = document.getElementById('itemsPageSize');

  if (pageInfo) pageInfo.textContent = `Page ${itemPage} / ${totalPages}`;
  if (countInfo) {
    const from = total === 0 ? 0 : (startIdx + 1);
    const to = Math.min(startIdx + pageSize, total);
    countInfo.textContent = `Showing ${from}-${to} of ${total}`;
  }
  if (prevBtn) prevBtn.disabled = (itemPage <= 1);
  if (nextBtn) nextBtn.disabled = (itemPage >= totalPages);
  if (sizeSel && String(sizeSel.value) !== String(pageSize)) sizeSel.value = String(pageSize);
}

function renderServiceItems() {
  try {
    refreshServiceItemsFromDb();
  } catch (e) {}

  const tbody = document.querySelector('#serviceItemsTable tbody');
  if (!tbody) return;

  // Ensure pager exists even if HTML wasn't updated
  let pager = document.getElementById('serviceItemsPager');
  if (!pager) {
    const table = document.getElementById('serviceItemsTable');
    if (table && table.parentElement) {
      pager = document.createElement('div');
      pager.id = 'serviceItemsPager';
      pager.className = 'pager';
      pager.style.cssText = 'display:flex; align-items:center; gap:8px; margin-top:10px; flex-wrap:wrap;';
      pager.innerHTML = `
        <button id="serviceItemsPrevBtn" class="btn btn-small" onclick="servicePrevPage()">â—€ Prev</button>
        <span id="serviceItemsPageInfo" style="font-weight:600;">Page 1</span>
        <button id="serviceItemsNextBtn" class="btn btn-small" onclick="serviceNextPage()">Next â–¶</button>
        <span style="margin-left:12px; opacity:0.8;" id="serviceItemsCountInfo"></span>
        <span style="margin-left:12px;">Per page:</span>
        <select id="serviceItemsPageSize" class="btn btn-small" onchange="setServicePageSize(this.value)">
          <option value="10" selected>10</option>
          <option value="25">25</option>
          <option value="50">50</option>
          <option value="100">100</option>
        </select>
      `;
      table.insertAdjacentElement('afterend', pager);
    }
  }

  const term = String(serviceItemSearchTerm || '').toLowerCase().trim();
  const filtered = (serviceItems || []).filter(function(s) {
    if (!term) return true;
    const name = (s.name || '').toLowerCase();
    const code = (s.code || '').toLowerCase();
    return name.includes(term) || code.includes(term);
  });

  const sorted = filtered.slice().sort(function(a, b) {
    return String(a.name || '').localeCompare(String(b.name || ''));
  });

  const total = sorted.length;
  const pageSize = Math.max(1, parseInt(servicePageSize, 10) || 10);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (servicePage > totalPages) servicePage = totalPages;
  if (servicePage < 1) servicePage = 1;
  const startIdx = (servicePage - 1) * pageSize;
  const paged = sorted.slice(startIdx, startIdx + pageSize);

  const canEdit = (typeof hasItemAdminAccess === 'function') ? hasItemAdminAccess() : true;

  tbody.innerHTML = paged.map(function(s) {
    return `
      <tr>
        <td>${s.code || ''}</td>
        <td>${s.name || ''}</td>
        <td class="actions">
          ${canEdit ? `<button class="icon-btn edit" title="Edit" onclick="openModal('serviceItem', ${s.id})">✏️</button>` : ``}
          ${canEdit ? `<button class="icon-btn delete" title="Delete" onclick="deleteItem('serviceItem', ${s.id})">🗑️</button>` : ``}
        </td>
      </tr>
    `;
  }).join('');

  const pageInfo = document.getElementById('serviceItemsPageInfo');
  const countInfo = document.getElementById('serviceItemsCountInfo');
  const prevBtn = document.getElementById('serviceItemsPrevBtn');
  const nextBtn = document.getElementById('serviceItemsNextBtn');
  const sizeSel = document.getElementById('serviceItemsPageSize');

  if (pageInfo) pageInfo.textContent = `Page ${servicePage} / ${totalPages}`;
  if (countInfo) {
    const from = total === 0 ? 0 : (startIdx + 1);
    const to = Math.min(startIdx + pageSize, total);
    countInfo.textContent = `Showing ${from}-${to} of ${total}`;
  }
  if (prevBtn) prevBtn.disabled = (servicePage <= 1);
  if (nextBtn) nextBtn.disabled = (servicePage >= totalPages);
  if (sizeSel && String(sizeSel.value) !== String(pageSize)) sizeSel.value = String(pageSize);
}

function servicePrevPage() {
  if (servicePage > 1) {
    servicePage -= 1;
    renderServiceItems();
  }
}

function serviceNextPage() {
  servicePage += 1;
  renderServiceItems();
}

function setServicePageSize(val) {
  const next = parseInt(val, 10);
  servicePageSize = Number.isFinite(next) && next > 0 ? next : 10;
  servicePage = 1;
  renderServiceItems();
}


// ======= SERVICE ITEM SEARCH (Invoice rows) =======
function onServiceSearchBlur(inputEl) {
    const picker = inputEl ? inputEl.closest('.invoice-service-picker, .invoice-a-service-picker') : null;
    if (!picker) return;
    const dropdown = picker.querySelector('.service-dropdown');
    if (!dropdown) return;
    setTimeout(function() {
        dropdown.style.display = 'none';
    }, 120);
}

function onServiceOptionMouseDown(optionEl) {
    const picker = optionEl ? optionEl.closest('.invoice-service-picker, .invoice-a-service-picker') : null;
    if (!picker) return;
    const id = optionEl.getAttribute('data-id') || '';
    const label = optionEl.getAttribute('data-label') || optionEl.textContent || '';

    const input = picker.querySelector('.invoice-service-search, .invoice-a-service-search');
    const hidden = picker.querySelector('.invoice-service-id, .invoice-a-service-id');
    if (hidden) hidden.value = id;
    if (input) {
        input.value = label;
        input.setAttribute('data-service-name', label);
    }

    const dropdown = picker.querySelector('.service-dropdown');
    if (dropdown) dropdown.style.display = 'none';
}

function onRowServiceItemSearch(inputEl, skipRefresh) {
    if (!skipRefresh) {
        refreshServiceItemsFromServer().then(function() {
            if (document.body.contains(inputEl)) onRowServiceItemSearch(inputEl, true);
        });
        return;
    }
    refreshServiceItemsFromDb();
    const term = (inputEl.value || '').toLowerCase().trim();
    const picker = inputEl.closest('.invoice-service-picker');
    const dropdown = picker ? picker.querySelector('.service-dropdown') : null;
    if (!dropdown) return;

    const hidden = picker.querySelector('.invoice-service-id');
    const prevLabel = inputEl.getAttribute('data-service-name') || '';
    if (hidden) {
        if (prevLabel && prevLabel !== inputEl.value) {
            hidden.value = '';
            inputEl.setAttribute('data-service-name', '');
        } else if (!prevLabel && hidden.value && inputEl.value.trim() === '') {
            hidden.value = '';
        }
    }

    if (!term) {
        dropdown.style.display = 'none';
        return;
    }

    const currentVal = hidden ? String(hidden.value || '') : '';

    let filtered = (serviceItems || []).filter(function(s) {
        const name = (s.name || '').toLowerCase();
        const code = (s.code || '').toLowerCase();
        return name.includes(term) || code.includes(term);
    });

    if (currentVal && !filtered.some(function(s) { return String(s.id) === String(currentVal); })) {
        const selected = (serviceItems || []).find(function(s) { return String(s.id) === String(currentVal); });
        if (selected) filtered = [selected].concat(filtered);
    }

    filtered = filtered.slice(0, 30);

    dropdown.innerHTML = filtered.map(function(s) {
        const code = s.code || '';
        const name = s.name || '';
        const label = code && name ? (code + ' - ' + name) : (code || name);
        const safeLabel = _esc(label);
        return '<div class="service-option" data-id="' + _esc(s.id) + '" data-label="' + safeLabel + '" onmousedown="onServiceOptionMouseDown(this)">' + safeLabel + '</div>';
    }).join('');

    dropdown.style.display = filtered.length ? 'block' : 'none';
}

function onRowServiceItemSearchA(inputEl, skipRefresh) {
    if (!skipRefresh) {
        refreshServiceItemsFromServer().then(function() {
            if (document.body.contains(inputEl)) onRowServiceItemSearchA(inputEl, true);
        });
        return;
    }
    refreshServiceItemsFromDb();
    const term = (inputEl.value || '').toLowerCase().trim();
    const picker = inputEl.closest('.invoice-a-service-picker');
    const dropdown = picker ? picker.querySelector('.service-dropdown') : null;
    if (!dropdown) return;

    const hidden = picker.querySelector('.invoice-a-service-id');
    const prevLabel = inputEl.getAttribute('data-service-name') || '';
    if (hidden) {
        if (prevLabel && prevLabel !== inputEl.value) {
            hidden.value = '';
            inputEl.setAttribute('data-service-name', '');
        } else if (!prevLabel && hidden.value && inputEl.value.trim() === '') {
            hidden.value = '';
        }
    }

    if (!term) {
        dropdown.style.display = 'none';
        return;
    }

    const currentVal = hidden ? String(hidden.value || '') : '';

    let filtered = (serviceItems || []).filter(function(s) {
        const name = (s.name || '').toLowerCase();
        const code = (s.code || '').toLowerCase();
        return name.includes(term) || code.includes(term);
    });

    if (currentVal && !filtered.some(function(s) { return String(s.id) === String(currentVal); })) {
        const selected = (serviceItems || []).find(function(s) { return String(s.id) === String(currentVal); });
        if (selected) filtered = [selected].concat(filtered);
    }

    filtered = filtered.slice(0, 30);

    dropdown.innerHTML = filtered.map(function(s) {
        const code = s.code || '';
        const name = s.name || '';
        const label = code && name ? (code + ' - ' + name) : (code || name);
        const safeLabel = _esc(label);
        return '<div class="service-option" data-id="' + _esc(s.id) + '" data-label="' + safeLabel + '" onmousedown="onServiceOptionMouseDown(this)">' + safeLabel + '</div>';
    }).join('');

    dropdown.style.display = filtered.length ? 'block' : 'none';
}

// ======= IMPORT ITEMS FROM EXCEL (XLSX/CSV) =======

    function handleItemsExcelImport(event) {
if (!requireImportExcel()) return;
        const file = event.target.files && event.target.files[0];
        if (!file) return;

        if (typeof XLSX === 'undefined') {
            uiError('Excel library is not loaded. Check internet or script URL.');
            return;
        }

        const reader = new FileReader();

        reader.onload = function (e) {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });

                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];

                // Convert to JSON: each row becomes an object using header row names
                const rows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

                if (!rows.length) {
                    uiError('No rows found in the first sheet.');
                    return;
                }
                // Ensure warehouses exist before applying quantities
                ensureWarehouses();

                function normPart(p) {
  return String(p || "").trim().toLowerCase();
}

function findItemIndexByPartNumber(partNumber) {
  const pn = normPart(partNumber);
  if (!pn) return -1;
  return items.findIndex(it => normPart(it.partNumber) === pn);
}

function buildLowerRow(row) {
  const out = {};
  Object.keys(row || {}).forEach(function(k) {
    out[String(k).toLowerCase().trim()] = row[k];
  });
  return out;
}

function getCell(row, rowLower, keys) {
  for (const k of keys) {
    if (row && row[k] !== undefined) return row[k];
    const lk = String(k).toLowerCase().trim();
    if (rowLower && rowLower[lk] !== undefined) return rowLower[lk];
  }
  return undefined;
}

let importedCount = 0;
let mergedCount = 0;
let skippedCount = 0;
let skippedDetails = [];
let importedTags = new Set();

rows.forEach(function (row, idxRow) {
  const rowNum = idxRow + 2; // +2 because row 1 is headers in Excel
  const rowLower = buildLowerRow(row);

  const name = String(getCell(row, rowLower, ['Name', 'Item Name', 'Item']) || '').trim();

  const partNumber = String(getCell(row, rowLower, ['Part Number', 'PartNumber', 'Part #', 'Part']) || '').trim();

  const rawBarcode = getCell(row, rowLower, ['Barcode', 'BARCODE', 'barcode']);
  const barcode = String(rawBarcode || '').trim();

  const rawQtyMain = getCell(row, rowLower, [
    'Main Qty', 'Main Quantity', 'Main', 'Main Stock', 'MainStock', 'Qty Main', 'Quantity Main'
  ]);
  const rawQtySaad = getCell(row, rowLower, [
    'Saadeyat Qty', 'Saadeyat Quantity', 'Saadeyat', 'Saadeyat Stock', 'SaadeyatStock', 'Qty Saadeyat', 'Quantity Saadeyat'
  ]);
  const rawQty = getCell(row, rowLower, ['Quantity', 'Qty']);

  const hasMain = rawQtyMain !== undefined && rawQtyMain !== '';
  const hasSaad = rawQtySaad !== undefined && rawQtySaad !== '';

  let quantityMain = hasMain ? parseInt(rawQtyMain) : NaN;
  let quantitySaad = hasSaad ? parseInt(rawQtySaad) : NaN;

  // Backwards compatibility: if only generic Quantity is provided, treat it as Saadeyat stock
  if (!hasMain && !hasSaad) {
    quantityMain = 0;
    quantitySaad = parseInt(rawQty) || 0;
  } else {
    if (isNaN(quantityMain)) quantityMain = 0;
    if (isNaN(quantitySaad)) quantitySaad = 0;
  }

  // 🚫 Block negative quantities (imports should only ADD stock)
  if (quantityMain < 0 || quantitySaad < 0) {
    skippedCount++;
    skippedDetails.push(`Row ${rowNum}: negative quantity (main=${quantityMain}, saadeyat=${quantitySaad}) for part number "${partNumber || ''}"`);
    return;
  }

  // ✅ must have part number to match/merge
  if (!partNumber) {
    skippedCount++;
    skippedDetails.push(`Row ${rowNum}: missing part number`);
    return;
  }

  // ✅ if match => ONLY add quantities, keep everything else unchanged
  const idx = findItemIndexByPartNumber(partNumber);
  if (idx !== -1) {
    const mainWid = getMainWarehouseId();
    const saadWid = getSaadeyatWarehouseId();
    ensureItemQuantities(items[idx]);
    if (quantityMain) adjustItemStock(items[idx].id, mainWid, quantityMain);
    if (quantitySaad) adjustItemStock(items[idx].id, saadWid, quantitySaad);
    if (tags && tags.length) {
      ensureItemTags(items[idx]);
      const existingTags = Array.isArray(items[idx].tags) ? items[idx].tags : [];
      const mergedTags = [];
      const seenTags = new Set();
      existingTags.concat(tags).forEach(function(t) {
        const val = String(t || '').trim();
        if (!val) return;
        const key = val.toLowerCase();
        if (seenTags.has(key)) return;
        seenTags.add(key);
        mergedTags.push(val);
      });
      items[idx].tags = mergedTags;
    }
    mergedCount++;
    return;
  }

  // Otherwise, create new item (your normal logic)
  const location = String(getCell(row, rowLower, ['Location']) || '').trim();

  const rawSelling = getCell(row, rowLower, ['Selling Price', 'Sale Price', 'Selling', 'Price']);

  const rawCost = getCell(row, rowLower, ['Cost Price', 'Cost']);

  const sellingPrice = parseFloat(rawSelling);
  const costPrice = parseFloat(rawCost);

  // New item must have name + selling + cost
  if (!name || isNaN(sellingPrice) || isNaN(costPrice)) {
    skippedCount++;
    skippedDetails.push(`Row ${rowNum}: missing name or invalid selling/cost price`);
    return;
  }

  const rawLow = getCell(row, rowLower, ['Low Stock Alert', 'LowStock', 'Low Stock']);

  const lowStockThreshold = parseInt(rawLow) || 5;

  const photoUrl = String(getCell(row, rowLower, ['Photo URL', 'Photo']) || '').trim();

  // Barcode: keep only if unique
  let finalBarcode = barcode;
  if (finalBarcode) {
    const exists = (items || []).some(it => String(it.barcode || '').trim() === finalBarcode);
    if (exists) {
      skippedDetails.push(`Row ${rowNum}: barcode "${finalBarcode}" already exists in inventory (imported item will have empty barcode)`);
      finalBarcode = '';
    }
  }

  const description = String(getCell(row, rowLower, ['Description', 'Notes']) || '').trim();

  const rawTags = getCell(row, rowLower, ['Tags', 'Tag', 'Item Tags', 'Item Tag', 'ItemTags']);
  const tags = normalizeTagsInput(rawTags);
  if (tags && tags.length) {
    tags.forEach(function(t) { importedTags.add(t); });
  }

  const mainWid = getMainWarehouseId();
  const saadWid = getSaadeyatWarehouseId();
  const newItem = {
    id: Date.now() + Math.floor(Math.random() * 1000000),
    name,
    partNumber,
    barcode: finalBarcode,
    location,
    sellingPrice,
    costPrice,
    price: sellingPrice,
    quantities: { [String(mainWid)]: quantityMain, [String(saadWid)]: quantitySaad },
    quantity: (quantityMain + quantitySaad),              // ✅ cached total
    lowStockThreshold,
    photoUrl,
    description,
    tags: tags || []
  };
  ensureItemQuantities(newItem);
  items.push(newItem);

  importedCount++;
});

                if (importedTags && importedTags.size > 0) {
                    try {
                        const mergedTags = getFixedTags().concat(Array.from(importedTags));
                        setFixedTags(mergedTags);
                    } catch (e) {}
                }

                if ((importedCount + mergedCount) === 0) {
                    uiError('No valid rows imported. Each row must have a Part Number, and new items must also have Name and Price.');
                    return;
                }

                itemSearchTerm = '';
                dbSetAll('items', items);   // ?o. SAVE IMPORTED ITEMS TO DB
                itemPage = Math.max(1, Math.ceil(items.length / (itemPageSize || 10)));
                renderItems();
                rebuildBarcodeIndex();
                event.target.value = '';
                // Build a single warning/success message
                let msg = `Import done ✅\nNew items: ${importedCount}\nMerged quantities: ${mergedCount}\nSkipped: ${skippedCount}`;

                if (skippedDetails.length) {
                    msg += `\n\n⚠️ Skipped rows:`;
                    const preview = skippedDetails.slice(0, 20);
                    preview.forEach(line => { msg += `\n- ${line}`; });
                    if (skippedDetails.length > 20) {
                        msg += `\n...and ${skippedDetails.length - 20} more`;
                    }
                }

                uiError(msg);

                // Reset file input so we can import the same file again if needed
                event.target.value = '';

                // Reset file input so we can import the same file again if needed
                event.target.value = '';
            } catch (err) {
                console.error(err);
                uiError('Failed to import items: ' + err.message);

            }
        };

        // For Excel files (.xlsx/.xls) we read as ArrayBuffer
        reader.readAsArrayBuffer(file);
    }

      
    function renderSuppliers() {
  // ✅ Always read latest from DB cache (prevents empty lists if init order changes)
  try { if (window.garageDB) { suppliers = window.garageDB.getAll('suppliers') || suppliers || []; } } catch(e) {}

        const tbody = document.querySelector('#suppliersTable tbody');
        tbody.innerHTML = (suppliers || []).slice(0, MAX_ROWS).map(function(s) {
            return `
                <tr>
                    <td>${s.name}</td>
                    <td>${s.phone || ''}</td>
                    <td>${s.email || ''}</td>
                    <td>${s.company || ''}</td>
                    <td>${s.notes || ''}</td>
                    <td class="actions">
                        ${hasPerm("*") ? `<button class="icon-btn edit" title="Edit" onclick="openModal(\'supplier\', ${s.id})">✏️</button>` : ``}
                        ${hasPerm("*") ? `<button class="icon-btn delete" title="Delete" onclick="deleteItem(\'supplier\', ${s.id})">🗑️</button>` : ``}
                    </td>
                </tr>
            `;
        }).join('');
    }

function renderEmployees() {
  // ✅ Always read latest from DB cache (prevents empty lists if init order changes)
  try { if (window.garageDB) { employees = window.garageDB.getAll('employees') || employees || []; } } catch(e) {}

        const tbody = document.querySelector('#employeesTable tbody');
        tbody.innerHTML = (employees || []).slice(0, MAX_ROWS).map(function(e) {
            const weeklyUsd = Number(e.weeklySalaryUsd) || 0;
            const weeklyLbp = Number(e.weeklySalaryLbp) || 0;
            return `
                <tr>
                    <td>${e.name}</td>
                    <td>${e.phone || ''}</td>
                    <td>${e.email || ''}</td>
                    <td>${e.role || ''}</td>
                    <td>${weeklyUsd.toFixed(2)}</td>
                    <td>${formatLbp(weeklyLbp)}</td>
                    <td>${e.notes || ''}</td>
                    <td class="actions">
                        ${hasPerm("*") ? `<button class="icon-btn edit" title="Edit" onclick="openModal(\'employee\', ${e.id})">✏️</button>` : ``}
                        ${hasPerm("*") ? `<button class="icon-btn delete" title="Delete" onclick="deleteItem(\'employee\', ${e.id})">🗑️</button>` : ``}
                    </td>
                </tr>
            `;
        }).join('');

        const totalsEl = document.getElementById('employeesTotals');
        if (totalsEl) {
            let totalUsd = 0;
            let totalLbp = 0;
            (employees || []).forEach(function(e) {
                totalUsd += Number(e.weeklySalaryUsd) || 0;
                totalLbp += Number(e.weeklySalaryLbp) || 0;
            });
            totalsEl.textContent = `Weekly Payroll Total: $${totalUsd.toFixed(2)}   |   L.L ${formatLbp(totalLbp)}`;
        }

        renderWeeklyPayroll();
    }

    function getWeekEndingSaturday(dateStr) {
        const base = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
        if (isNaN(base.getTime())) return '';
        const day = base.getDay(); // 0=Sun, 6=Sat
        const diff = (6 - day + 7) % 7;
        const end = new Date(base);
        end.setDate(base.getDate() + diff);
        return end.toISOString().split('T')[0];
    }

    function setWeeklyPayrollToThisSaturday() {
        const end = getWeekEndingSaturday(new Date().toISOString().split('T')[0]);
        const input = document.getElementById('weeklyPayrollEndDate');
        if (input) input.value = end;
        weeklyPayrollEndDate = end;
        renderWeeklyPayroll();
    }

    function onWeeklyPayrollDateChange(value) {
        weeklyPayrollEndDate = getWeekEndingSaturday(value);
        const input = document.getElementById('weeklyPayrollEndDate');
        if (input) input.value = weeklyPayrollEndDate;
        renderWeeklyPayroll();
    }

    function renderWeeklyPayroll() {
        try { if (window.garageDB) { employees = window.garageDB.getAll('employees') || employees || []; } } catch(e) {}
        rebuildPayrollPaymentsFromEmployees();

        if (!weeklyPayrollEndDate) {
            weeklyPayrollEndDate = getWeekEndingSaturday(new Date().toISOString().split('T')[0]);
            const input = document.getElementById('weeklyPayrollEndDate');
            if (input) input.value = weeklyPayrollEndDate;
        }

        const tbody = document.querySelector('#weeklyPayrollTable tbody');
        if (!tbody) return;

        const paidMap = new Map();
        (payrollPayments || []).forEach(function(p) {
            if (String(p.weekEnding || '') !== String(weeklyPayrollEndDate)) return;
            paidMap.set(String(p.employeeId), p);
        });

        let totalUsd = 0;
        let totalLbp = 0;

        tbody.innerHTML = (employees || []).map(function(e) {
            const paid = paidMap.get(String(e.id));
            const weeklyUsd = Number(e.weeklySalaryUsd) || 0;
            const weeklyLbp = Number(e.weeklySalaryLbp) || 0;
            if (paid) {
                totalUsd += (Number(paid.baseUsd) || 0) + (Number(paid.bonusUsd) || 0);
                totalLbp += (Number(paid.baseLbp) || 0) + (Number(paid.bonusLbp) || 0);
            }
            return `
                <tr>
                    <td>${e.name || ''}</td>
                    <td>${weeklyUsd.toFixed(2)}</td>
                    <td>${formatLbp(weeklyLbp)}</td>
                    <td>${paid ? 'PAID' : 'UNPAID'}</td>
                    <td>
                        ${paid
                            ? `<button class="btn btn-small btn-warning" onclick="markWeeklyUnpaid(${e.id})">Mark Unpaid</button>`
                            : `<button class="btn btn-small btn-success" onclick="openWeeklyPayroll(${e.id})">Mark Paid</button>`
                        }
                    </td>
                </tr>
            `;
        }).join('');

        const totalsEl = document.getElementById('weeklyPayrollTotals');
        if (totalsEl) {
            totalsEl.textContent = `Total Paid (Week Ending ${weeklyPayrollEndDate}): $${totalUsd.toFixed(2)}   |   L.L ${formatLbp(totalLbp)}`;
        }
    }

    function onPayrollSearch(value) {
        payrollSearchTerm = String(value || '').trim().toLowerCase();
        renderPayrollPayments();
    }

    function renderPayrollPayments() {
        try { if (window.garageDB) { employees = window.garageDB.getAll('employees') || employees || []; } } catch(e) {}
        rebuildPayrollPaymentsFromEmployees();

        const tbody = document.querySelector('#payrollTable tbody');
        if (!tbody) return;

        const empById = new Map((employees || []).map(function(e){ return [String(e.id), e]; }));
        const list = (payrollPayments || []).slice().sort(function(a, b) {
            const da = String(a.date || '');
            const db = String(b.date || '');
            if (da !== db) return db.localeCompare(da);
            return (b.id || 0) - (a.id || 0);
        }).filter(function(p) {
            if (!payrollSearchTerm) return true;
            const emp = empById.get(String(p.employeeId)) || {};
            const name = String(emp.name || '').toLowerCase();
            const notes = String(p.notes || '').toLowerCase();
            return name.includes(payrollSearchTerm) || notes.includes(payrollSearchTerm);
        });

        let totalUsd = 0;
        let totalLbp = 0;

        tbody.innerHTML = list.map(function(p) {
            const emp = empById.get(String(p.employeeId)) || {};
            const baseUsd = Number(p.baseUsd) || 0;
            const baseLbp = Number(p.baseLbp) || 0;
            const bonusUsd = Number(p.bonusUsd) || 0;
            const bonusLbp = Number(p.bonusLbp) || 0;
            totalUsd += (baseUsd + bonusUsd);
            totalLbp += (baseLbp + bonusLbp);
            return `
                <tr>
                    <td>${p.date || ''}</td>
                    <td>${emp.name || ''}</td>
                    <td>${baseUsd.toFixed(2)}</td>
                    <td>${formatLbp(baseLbp)}</td>
                    <td>${bonusUsd.toFixed(2)}</td>
                    <td>${formatLbp(bonusLbp)}</td>
                    <td>${p.notes || ''}</td>
                    <td class="actions">
                        ${hasPerm("*") ? `<button class="icon-btn edit" title="Edit" onclick="openModal('payroll', ${p.id})">✏️</button>` : ``}
                        ${hasPerm("*") ? `<button class="icon-btn delete" title="Delete" onclick="deleteItem('payroll', ${p.id})">🗑️</button>` : ``}
                    </td>
                </tr>
            `;
        }).join('');

        const totalsEl = document.getElementById('payrollTotals');
        if (totalsEl) {
            totalsEl.textContent = `Total Paid: $${totalUsd.toFixed(2)}   |   L.L ${formatLbp(totalLbp)}`;
        }
    }

    // ========= INVOICE RENDER WITH PAGINATION =========
    function renderInvoices() {
  // ✅ Always read latest from DB cache (prevents empty lists if init order changes)
  try { if (window.garageDB) { invoices = window.garageDB.getAll('invoices') || invoices || []; } } catch(e) {}

        const tbody = document.querySelector('#invoicesTable tbody');
        const pageInfoEl = document.getElementById('invoicesPageInfo');
        const pageSizeSelect = document.getElementById('invoicesPageSizeSelect');
        const prevBtn = document.getElementById('invoicesPrevPage');
        const nextBtn = document.getElementById('invoicesNextPage');

        const sorted = (invoices || []).filter(function(inv) {
            return !isInvoiceA(inv) && !inv.isPayment;
        }).slice().sort(function(a, b) {
            return b.id - a.id;
        });

        const totalInvoices = sorted.length;
        const pageCount = totalInvoices === 0 ? 1 : Math.ceil(totalInvoices / invoicePageSize);

        if (invoicePage > pageCount) invoicePage = pageCount;
        if (invoicePage < 1) invoicePage = 1;

        const startIndex = (invoicePage - 1) * invoicePageSize;
        const endIndex = startIndex + invoicePageSize;
        const pageItems = sorted.slice(startIndex, endIndex);

        tbody.innerHTML = pageItems.map(function(inv) {
            const client = clients.find(function(c) { return c.id === inv.clientId; });
            const car = inv.carId ? cars.find(function(c) { return c.id === inv.carId; }) : null;
            const f = getInvoiceFinancials(inv);
            const statusClass = f.status === 'paid' ? 'status-paid' : 'status-unpaid';
            const statusText = f.status === 'paid' ? '✓ PAID' : '⏳ UNPAID';
            const safeInvoiceId = String(inv.id).replace(/"/g, "&quot;");
            const statusButton = f.status === 'paid'
                ? `<button class="btn btn-warning btn-small js-toggle-payment" data-invoice-id="${safeInvoiceId}">Mark Unpaid</button>`
                : `<button class="btn btn-success btn-small js-toggle-payment" data-invoice-id="${safeInvoiceId}">Mark Paid</button>`;
            const viewButton = `<button class="btn btn-secondary btn-small" onclick="openInvoiceSavedModal(${inv.id})">View</button>`;
            
            return `
                <tr>
                    <td>${inv.invoiceNumber}</td>
                    <td>${inv.date}</td>
                    <td>${client ? client.name : 'N/A'}</td>
                    <td>${car ? (car.make + ' ' + car.model) : 'N/A'}</td>
                    <td>${f.total.toFixed(2)}</td>
                    <td>${f.amountPaid.toFixed(2)}</td>
                    <td>${f.remaining.toFixed(2)}</td>
                    <td class="${statusClass}">${statusText}</td>
                    <td class="actions">
                        ${hasPerm("*") ? statusButton : ``}
                        ${viewButton}
                        <button class="btn btn-success btn-small" onclick="printInvoice(${inv.id})">Print</button>
                        ${hasPerm("*") ? `<button class="icon-btn edit" title="Edit" onclick="openModal(\'invoice\', ${inv.id})">✏️</button>` : ``}
                        ${hasPerm("*") ? `<button class="icon-btn delete" title="Delete" onclick="deleteItem(\'invoice\', ${inv.id})">🗑️</button>` : ``}
                    </td>
                </tr>
            `;
        }).join('');

        if (pageInfoEl) {
            if (totalInvoices === 0) {
                pageInfoEl.textContent = 'No invoices';
            } else {
                pageInfoEl.textContent = 'Page ' + invoicePage + ' of ' + pageCount + ' (' + totalInvoices + ' total)';
            }
        }
        if (pageSizeSelect && parseInt(pageSizeSelect.value) !== invoicePageSize) {
            pageSizeSelect.value = String(invoicePageSize);
        }
        if (prevBtn) prevBtn.disabled = invoicePage <= 1 || totalInvoices === 0;
        if (nextBtn) nextBtn.disabled = invoicePage >= pageCount || totalInvoices === 0;
    }

    function renderInvoiceA() {
        try { if (window.garageDB) { invoices = window.garageDB.getAll('invoices') || invoices || []; } } catch(e) {}

        const tbody = document.querySelector('#invoiceATable tbody');
        const pageInfoEl = document.getElementById('invoiceAPageInfo');
        const pageSizeSelect = document.getElementById('invoiceAPageSizeSelect');
        const prevBtn = document.getElementById('invoiceAPrevPage');
        const nextBtn = document.getElementById('invoiceANextPage');

        if (!tbody) return;

        const sorted = (invoices || []).filter(function(inv) {
            return isInvoiceA(inv) && !inv.isPayment;
        }).slice().sort(function(a, b) {
            return b.id - a.id;
        });

        const totalInvoices = sorted.length;
        const pageCount = totalInvoices === 0 ? 1 : Math.ceil(totalInvoices / invoiceAPageSize);

        if (invoiceAPage > pageCount) invoiceAPage = pageCount;
        if (invoiceAPage < 1) invoiceAPage = 1;

        const startIndex = (invoiceAPage - 1) * invoiceAPageSize;
        const endIndex = startIndex + invoiceAPageSize;
        const pageItems = sorted.slice(startIndex, endIndex);

        tbody.innerHTML = pageItems.map(function(inv) {
            const client = clients.find(function(c) { return c.id === inv.clientId; });
            const car = inv.carId ? cars.find(function(c) { return c.id === inv.carId; }) : null;
            const f = getInvoiceFinancials(inv);
            const statusClass = f.status === 'paid' ? 'status-paid' : 'status-unpaid';
            const statusText = f.status === 'paid' ? '✓ PAID' : '⏳ UNPAID';
            const safeInvoiceId = String(inv.id).replace(/"/g, "&quot;");
            const statusButton = f.status === 'paid'
                ? `<button class="btn btn-warning btn-small js-toggle-payment" data-invoice-id="${safeInvoiceId}">Mark Unpaid</button>`
                : `<button class="btn btn-success btn-small js-toggle-payment" data-invoice-id="${safeInvoiceId}">Mark Paid</button>`;
            const viewButton = `<button class="btn btn-secondary btn-small" onclick="openInvoiceASavedModal(${inv.id})">View</button>`;

            return `
                <tr>
                    <td>${inv.invoiceNumber || ''}</td>
                    <td>${inv.date || ''}</td>
                    <td>${client ? client.name : 'N/A'}</td>
                    <td>${car ? (car.make + ' ' + car.model) : 'N/A'}</td>
                    <td>${f.total.toFixed(2)}</td>
                    <td>${f.amountPaid.toFixed(2)}</td>
                    <td>${f.remaining.toFixed(2)}</td>
                    <td class="${statusClass}">${statusText}</td>
                    <td class="actions">
                        ${hasPerm("*") ? statusButton : ``}
                        ${viewButton}
                        <button class="btn btn-success btn-small" onclick="printInvoiceA(${inv.id})">Print</button>
                        ${hasPerm("*") ? `<button class="icon-btn edit" title="Edit" onclick="openModal('invoiceA', ${inv.id})">✏️</button>` : ``}
                        ${hasPerm("*") ? `<button class="icon-btn delete" title="Delete" onclick="deleteItem('invoice', ${inv.id})">🗑️</button>` : ``}
                    </td>
                </tr>
            `;
        }).join('');

        if (pageInfoEl) {
            if (totalInvoices === 0) {
                pageInfoEl.textContent = 'No invoices';
            } else {
                pageInfoEl.textContent = 'Page ' + invoiceAPage + ' of ' + pageCount + ' (' + totalInvoices + ' total)';
            }
        }
        if (pageSizeSelect && parseInt(pageSizeSelect.value) !== invoiceAPageSize) {
            pageSizeSelect.value = String(invoiceAPageSize);
        }
        if (prevBtn) prevBtn.disabled = invoiceAPage <= 1 || totalInvoices === 0;
        if (nextBtn) nextBtn.disabled = invoiceAPage >= pageCount || totalInvoices === 0;
    }

    
// ======= QUICK ADD CAR (from Client list / Client cars modal) =======
function addCarForClient(clientId) {
    if (typeof requireAdminAction === 'function' && !requireAdminAction()) return;

    openModal('car');

    // Wait for modal DOM to render then select the client (even if not in first 20)
    setTimeout(function() {
        const cid = String(clientId || '').trim();
        if (!cid) return;

        const clientSelect = document.getElementById('clientId');
        if (clientSelect) {
            const hasOption = Array.from(clientSelect.options || []).some(function(o){ return String(o.value) === cid; });
            if (!hasOption) {
                const cl = (Array.isArray(clients) ? clients : []).find(function(x){ return String(x.id) === cid; });
                const opt = document.createElement('option');
                opt.value = cid;
                opt.textContent = cl ? (cl.name || ('Client #' + cid)) : ('Client #' + cid);
                // Put injected option at top so it's visible even with limited list
                if (clientSelect.firstChild) clientSelect.insertBefore(opt, clientSelect.firstChild.nextSibling);
                else clientSelect.appendChild(opt);
            }
            clientSelect.value = cid;
        }

        // Clear search + keep select compact
        const s = document.getElementById('carClientSearch');
        if (s) s.value = '';
        if (typeof filterCarClientOptions === 'function') filterCarClientOptions();
    }, 40);
}

    function onExpenseSearch(value) {
        expenseSearchTerm = String(value || '').trim().toLowerCase();
        expensePage = 1;
        renderExpenses();
    }

    function setExpensePageSize(value) {
        const newSize = parseInt(value) || 10;
        expensePageSize = newSize;
        expensePage = 1;
        renderExpenses();
    }

    function expensePrevPage() {
        expensePage = Math.max(1, expensePage - 1);
        renderExpenses();
    }

    function expenseNextPage() {
        expensePage += 1;
        renderExpenses();
    }

    function renderExpenses() {
        try {
            if (window.garageDB) {
                expenses = window.garageDB.getAll('expenses') || expenses || [];
            }
        } catch (e) {}

        const tbody = document.querySelector('#expensesTable tbody');
        if (!tbody) return;

        const term = String(expenseSearchTerm || '');
        const filtered = (expenses || []).filter(function(e) {
            if (!term) return true;
            const cat = (e.category || '').toLowerCase();
            const vendor = (e.vendor || '').toLowerCase();
            const notes = (e.notes || '').toLowerCase();
            const method = (e.paymentMethod || '').toLowerCase();
            const curr = (e.currency || '').toLowerCase();
            return cat.includes(term) || vendor.includes(term) || notes.includes(term) || method.includes(term) || curr.includes(term);
        });

        const sorted = filtered.slice().sort(function(a, b) {
            const aKey = String(a.date || '').trim();
            const bKey = String(b.date || '').trim();
            if (aKey && bKey && aKey !== bKey) return aKey < bKey ? 1 : -1;
            const aId = Number((a && a.id) || 0);
            const bId = Number((b && b.id) || 0);
            return bId - aId;
        });

        const total = sorted.length;
        const totalPages = Math.max(1, Math.ceil(total / expensePageSize));
        if (expensePage > totalPages) expensePage = totalPages;
        if (expensePage < 1) expensePage = 1;

        const startIdx = (expensePage - 1) * expensePageSize;
        const pageRows = sorted.slice(startIdx, startIdx + expensePageSize);

        let totalUsd = 0;
        let totalLbp = 0;
        filtered.forEach(function(e) {
            const amount = Number(e.amount) || 0;
            const curr = (e.currency === 'LBP') ? 'LBP' : 'USD';
            if (curr === 'LBP') totalLbp += amount;
            else totalUsd += amount;
        });

        let html = '';
        let currentDate = null;
        let dayUsd = 0;
        let dayLbp = 0;
        function flushDayTotal() {
            if (!currentDate) return;
            html += `
                <tr>
                    <td colspan="3"><strong>${currentDate} Total</strong></td>
                    <td><strong>${dayUsd.toFixed(2)}</strong></td>
                    <td><strong>${formatLbp(dayLbp)}</strong></td>
                    <td colspan="3"></td>
                </tr>
            `;
            dayUsd = 0;
            dayLbp = 0;
        }

        pageRows.forEach(function(e) {
            const dateKey = String(e.date || '').trim() || 'No Date';
            if (currentDate !== dateKey) {
                if (currentDate !== null) flushDayTotal();
                currentDate = dateKey;
            }
            const amount = Number(e.amount) || 0;
            const curr = (e.currency === 'LBP') ? 'LBP' : 'USD';
            if (curr === 'LBP') dayLbp += amount;
            else dayUsd += amount;
            html += `
                <tr>
                    <td>${e.date || ''}</td>
                    <td>${e.category || ''}</td>
                    <td>${e.vendor || ''}</td>
                    <td>${curr === 'LBP' ? formatLbp(amount) : amount.toFixed(2)}</td>
                    <td>${curr === 'USD' ? '$' : 'L.L'}</td>
                    <td>${e.paymentMethod || ''}</td>
                    <td>${e.notes || ''}</td>
                    <td class="actions">
                        ${hasPerm("*") ? `<button class="icon-btn edit" title="Edit" onclick="openModal('expense', ${e.id})">✏️</button>` : ``}
                        ${hasPerm("*") ? `<button class="icon-btn delete" title="Delete" onclick="deleteItem('expense', ${e.id})">🗑️</button>` : ``}
                    </td>
                </tr>
            `;
        });
        flushDayTotal();
        tbody.innerHTML = html;

        const pageInfo = document.getElementById('expensesPageInfo');
        const countInfo = document.getElementById('expensesCountInfo');
        const prevBtn = document.getElementById('expensesPrevBtn');
        const nextBtn = document.getElementById('expensesNextBtn');
        const sizeSel = document.getElementById('expensesPageSize');

        if (pageInfo) pageInfo.textContent = `Page ${expensePage} / ${totalPages}`;
        if (countInfo) {
            const from = total === 0 ? 0 : (startIdx + 1);
            const to = Math.min(startIdx + expensePageSize, total);
            countInfo.textContent = `Showing ${from}-${to} of ${total}`;
        }
        if (prevBtn) prevBtn.disabled = (expensePage <= 1);
        if (nextBtn) nextBtn.disabled = (expensePage >= totalPages);
        if (sizeSel && String(sizeSel.value) !== String(expensePageSize)) sizeSel.value = String(expensePageSize);

        const totalsEl = document.getElementById('expensesTotals');
        if (totalsEl) {
            const rate = getLbpUsdRate();
            const converted = rate ? (totalLbp / rate) : 0;
            const totalCombined = rate ? (totalUsd + converted) : totalUsd;
            const convertedText = rate ? `   |   Total (USD incl. L.L): ${totalCombined.toFixed(2)}` : '';
            const today = new Date().toISOString().split('T')[0];
            let incomeToday = 0;
            (invoices || []).forEach(function(inv) {
                const paidAt = String(inv.paidAt || '').trim();
                if (paidAt !== today) return;
                const f = getInvoiceFinancials(inv);
                if (f.status === 'paid') incomeToday += f.total;
            });
            const netToday = incomeToday - totalCombined;
            totalsEl.textContent = `Total (USD incl. L.L): ${totalCombined.toFixed(2)}   ||   Today Income (USD): ${incomeToday.toFixed(2)}   |   Net Today (USD): ${netToday.toFixed(2)}`;
        }
    }

// ======= CAR MODAL: FAST CLIENT SELECT (limit to 20, search filters full list) =======

function onCarClientSelectChange() {
    const sel = document.getElementById('clientId');
    const inp = document.getElementById('carClientSearch');
    if (inp) inp.value = '';          // clear search after picking
    if (sel) {
        // collapse any expanded list mode
        sel.size = 1;
        sel.style.display = '';
    }
}

function filterCarClientOptions(value) {
    const input  = document.getElementById('carClientSearch');
    const select = document.getElementById('clientId');
    if (!select) return;

    const term = String((value != null ? value : (input && input.value ? input.value : ''))).trim().toLowerCase();
    const currentVal = String(select.value || '').trim();

    const list = (clients || []);
    const MAX = 20;

    // Filter full list when term exists, otherwise show first 20 only
    let filtered = [];
    if (term) {
        filtered = list.filter(function(c){
            const name  = String(c && c.name  ? c.name  : '').toLowerCase();
            const phone = String(c && c.phone ? c.phone : '').toLowerCase();
            return name.includes(term) || phone.includes(term);
        }).slice(0, MAX);
    } else {
        filtered = list.slice(0, MAX);
    }

    let html = '<option value="">Select Client</option>';

    // Keep current selection visible even if not in top 20
    if (currentVal && !filtered.some(function(c){ return String(c.id) === currentVal; })) {
        const cur = (list || []).find(function(c){ return String(c.id) === currentVal; });
        if (cur) {
            const name  = _esc(cur && cur.name ? cur.name : 'Client');
            const phone = _esc(cur && cur.phone ? cur.phone : '');
            const label = phone ? (name + ' - ' + phone) : name;
            html += '<option value="' + String(cur.id) + '" selected>' + label + '</option>';
        } else {
            html += '<option value="' + currentVal + '" selected>Client #' + _esc(currentVal) + '</option>';
        }
    }

    html += filtered.map(function(c){
        const id    = (c && c.id != null) ? String(c.id) : '';
        const name  = _esc(c && c.name ? c.name : 'Client');
        const phone = _esc(c && c.phone ? c.phone : '');
        const label = phone ? (name + ' - ' + phone) : name;
        const selected = (currentVal && id === currentVal) ? 'selected' : '';
        return '<option value="' + id + '" ' + selected + '>' + label + '</option>';
    }).join('');

    select.innerHTML = html;

    // Restore selection (if any) without auto-selecting during search
    if (currentVal) select.value = currentVal;

    // ✅ Auto-open dropdown while typing (but do NOT auto-select)
    // - When term exists: expand list a bit so user sees matches immediately.
    // - When empty: keep it collapsed (normal dropdown).
    const shouldOpen = !!term; // typing -> open
    if (shouldOpen) {
        // show up to 8 rows (or less if fewer options)
        const rows = Math.min(8, Math.max(2, select.options.length));
        select.size = rows;
        select.style.display = 'block';
    } else {
        select.size = 1;
        select.style.display = '';
    }
}


// ======= QUICK INVOICE (from Client/Car lists) =======
function quickInvoiceForClient(clientId) {
    if (typeof requireAdminAction === 'function' && !requireAdminAction()) return;

    openModal('invoice');

    setTimeout(function() {
        const cid = String(clientId || '').trim();
        if (!cid) return;

        const clientIdInput = document.getElementById('invoiceClientId');
        const clientSearch = document.getElementById('invoiceClientSearch');
        if (clientIdInput) clientIdInput.value = cid;
        if (clientSearch) {
            const cl = (Array.isArray(clients) ? clients : []).find(function(x){ return String(x.id) === cid; });
            const label = cl ? (cl.phone ? (cl.name + ' - ' + cl.phone) : (cl.name || ('Client #' + cid))) : ('Client #' + cid);
            clientSearch.value = label;
            clientSearch.setAttribute('data-client-name', label);
        }

        // Refresh car dropdown for this client
        try {
            if (typeof filterInvoiceCarOptions === 'function') filterInvoiceCarOptions();
            else if (typeof updateCarOptions === 'function') updateCarOptions();
        } catch(e){}

        // Focus car search (you usually want to pick the plate fast)
        const carSearch = document.getElementById('invoiceCarSearch');
        if (carSearch) {
            carSearch.value = '';
            carSearch.focus();
        }
    }, 40);
}


function quickInvoiceForCar(carId) {
    if (typeof requireAdminAction === 'function' && !requireAdminAction()) return;

    openModal('invoice');

    setTimeout(function() {
        const car = (Array.isArray(cars) ? cars : []).find(function(x){ return String(x.id) === String(carId); });
        if (!car) return;

        // Set client first (so car list becomes filtered + consistent)
        const cid = String(car.clientId || '').trim();
        const clientIdInput = document.getElementById('invoiceClientId');
        const clientSearch = document.getElementById('invoiceClientSearch');
        if (clientIdInput && cid) {
            clientIdInput.value = cid;
            if (clientSearch) {
                const cl = (Array.isArray(clients) ? clients : []).find(function(x){ return String(x.id) === cid; });
                const label = cl ? (cl.phone ? (cl.name + ' - ' + cl.phone) : (cl.name || ('Client #' + cid))) : ('Client #' + cid);
                clientSearch.value = label;
                clientSearch.setAttribute('data-client-name', label);
            }
        }

        // Refresh dropdown then select car
        try {
            if (typeof filterInvoiceCarOptions === 'function') filterInvoiceCarOptions();
            else if (typeof updateCarOptions === 'function') updateCarOptions();
        } catch(e){}

        const carSelect = document.getElementById('invoiceCarId');
        if (carSelect) {
            carSelect.value = String(car.id);
            if (typeof onInvoiceCarSelectChange === 'function') onInvoiceCarSelectChange(String(car.id));
        }

        const carSearch = document.getElementById('invoiceCarSearch');
        if (carSearch) carSearch.value = '';
    }, 40);
}


function changeInvoicePage(delta) {
        invoicePage += delta;
        renderInvoices();
    }

    function setInvoicePageSize(value) {
        const newSize = parseInt(value) || 10;
        invoicePageSize = newSize;
        invoicePage = 1;
        renderInvoices();
    }

    function changeInvoiceAPage(delta) {
        invoiceAPage += delta;
        renderInvoiceA();
    }

    function setInvoiceAPageSize(value) {
        const newSize = parseInt(value) || 10;
        invoiceAPageSize = newSize;
        invoiceAPage = 1;
        renderInvoiceA();
    }

    // ======= REPORTS =======
    let reportClientBalancePage = 1;
    const reportClientBalancePageSize = 10;

    function changeReportClientBalancePage(delta) {
        reportClientBalancePage = Math.max(1, reportClientBalancePage + delta);
        renderReportClientBalances();
    }

    function populateReportClientSelect() {
        const select = document.getElementById('reportClientId');
        if (!select) return;
        const currentValue = select.value;
        select.innerHTML = '<option value="">All Clients</option>' + clients.map(function(c) {
            return '<option value="' + c.id + '">' + c.name + '</option>';
        }).join('');
        if (currentValue) {
            select.value = currentValue;
        }
    }

    function onReportTypeChange() {
        const type = document.getElementById('reportType').value;
        const startDateInput = document.getElementById('reportStartDate');
        const endDateInput = document.getElementById('reportEndDate');
        const statusSelect = document.getElementById('reportStatus');
        const clientSelect = document.getElementById('reportClientId');

        startDateInput.disabled = false;
        endDateInput.disabled = false;
        statusSelect.disabled = false;
        clientSelect.disabled = false;

        if (type === 'clientBalances') {
            startDateInput.disabled = true;
            endDateInput.disabled = true;
            statusSelect.disabled = true;
            clientSelect.disabled = true;
        } else if (type === 'inventory' || type === 'lowStock' || type === 'inventoryCost' || type === 'weeklyPayroll') {
            startDateInput.disabled = true;
            endDateInput.disabled = true;
            statusSelect.disabled = true;
            clientSelect.disabled = true;
        } else if (type === 'clientHistory') {
            startDateInput.disabled = false;
            endDateInput.disabled = false;
            statusSelect.disabled = false;
            clientSelect.disabled = false;
        } else if (type === 'expenseToday') {
            startDateInput.disabled = true;
            endDateInput.disabled = true;
            statusSelect.disabled = true;
            clientSelect.disabled = true;
        } else if (type === 'incomeToday') {
            startDateInput.disabled = true;
            endDateInput.disabled = true;
            statusSelect.disabled = true;
            clientSelect.disabled = true;
        } else if (type === 'payrollPayments') {
            startDateInput.disabled = false;
            endDateInput.disabled = false;
            statusSelect.disabled = true;
            clientSelect.disabled = true;
        } else if (type === 'salesSummary' || type === 'invoiceList' || type === 'itemSales') {
            clientSelect.disabled = (type === 'salesSummary');
        }
    }

    function filterInvoicesForReport() {
        const start = document.getElementById('reportStartDate').value;
        const end = document.getElementById('reportEndDate').value;
        const status = document.getElementById('reportStatus').value;
        const clientIdStr = document.getElementById('reportClientId').value;
        const clientId = clientIdStr ? parseInt(clientIdStr) : null;

        return invoices.filter(function(inv) {
            const f = getInvoiceFinancials(inv);
            if (clientId && inv.clientId !== clientId) return false;
            if (status !== 'all' && f.status !== status) return false;
            if (start && inv.date < start) return false;
            if (end && inv.date > end) return false;
            return true;
        });
    }

    function generateReport() {
        const type = document.getElementById('reportType').value;
        const reportArea = document.getElementById('reportArea');
        reportArea.innerHTML = '';

        if (type === 'clientBalances') {
            reportClientBalancePage = 1;
            renderReportClientBalances();
        } else if (type === 'salesSummary') {
            renderReportSalesSummary();
        } else if (type === 'itemSales') {
            renderReportItemSales();
        } else if (type === 'topItems') {
            renderReportTopItems();
        } else if (type === 'invoiceList') {
            renderReportInvoiceList();
        } else if (type === 'inventory') {
            renderReportInventory();
        } else if (type === 'inventoryCost') {
            renderReportInventoryCost();
        } else if (type === 'expenseToday') {
            renderReportExpenseToday();
        } else if (type === 'incomeToday') {
            renderReportIncomeToday();
        } else if (type === 'weeklyPayroll') {
            renderReportWeeklyPayroll();
        } else if (type === 'payrollPayments') {
            renderReportPayrollPayments();
        } else if (type === 'lowStock') {
            renderReportLowStock();
        } else if (type === 'clientHistory') {
            renderReportClientHistory();
        }
    }

    function renderReportClientBalances() {
        const reportArea = document.getElementById('reportArea');
        const balanceMap = new Map();
        const paymentMap = new Map();
        (invoices || []).forEach(function(inv) {
            if (inv && inv.isPayment) return;
            const f = getInvoiceFinancials(inv || {});
            if (f.remaining <= 0) return;
            const cid = String(inv.clientId || '');
            if (!cid) return;
            balanceMap.set(cid, (balanceMap.get(cid) || 0) + f.remaining);
        });
        (invoices || []).forEach(function(inv) {
            if (!inv || !inv.isPayment) return;
            if (inv.invoiceId) return;
            const cid = String(inv.clientId || '');
            if (!cid) return;
            const rawAmt = (inv.amount !== undefined && inv.amount !== null) ? inv.amount : (inv.paymentAmount !== undefined && inv.paymentAmount !== null ? inv.paymentAmount : 0);
            const amt = parseFloat(rawAmt) || 0;
            if (!amt) return;
            paymentMap.set(cid, (paymentMap.get(cid) || 0) + amt);
        });

        const rows = clients.map(function(c) {
            const cid = String(c.id);
            const balance = (balanceMap.get(cid) || 0) - (paymentMap.get(cid) || 0);
            if (balance <= 0) return null;
            return `
                <tr>
                    <td>${c.name}</td>
                    <td>${c.phone}</td>
                    <td>${balance.toFixed(2)}</td>
                    <td><button class="btn btn-small btn-success js-mark-client-paid" data-client-id="${c.id}">Mark Paid</button></td>
                </tr>
            `;
        }).filter(Boolean);

        if (!rows.length) {
            reportArea.innerHTML = '<p>No clients with outstanding balances.</p>';
            return;
        }

        const totalRows = rows.length;
        const pageCount = Math.ceil(totalRows / reportClientBalancePageSize) || 1;
        if (reportClientBalancePage > pageCount) reportClientBalancePage = pageCount;
        if (reportClientBalancePage < 1) reportClientBalancePage = 1;

        const startIndex = (reportClientBalancePage - 1) * reportClientBalancePageSize;
        const pageRows = rows.slice(startIndex, startIndex + reportClientBalancePageSize).join('');
        const pagerHtml = totalRows > reportClientBalancePageSize ? `
            <div class="pager report-pager" style="margin-top:10px;">
                <button class="btn btn-small" onclick="changeReportClientBalancePage(-1)" ${reportClientBalancePage <= 1 ? 'disabled' : ''}>Prev</button>
                <span>Page ${reportClientBalancePage} of ${pageCount} (${totalRows} total)</span>
                <button class="btn btn-small" onclick="changeReportClientBalancePage(1)" ${reportClientBalancePage >= pageCount ? 'disabled' : ''}>Next</button>
            </div>
        ` : '';

        reportArea.innerHTML = `
            <h3>Client Balances (Unpaid Only)</h3>
            <table>
                <thead>
                    <tr>
                        <th>Client</th>
                        <th>Phone</th>
                        <th>Unpaid Balance</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${pageRows}
                </tbody>
            </table>
            ${pagerHtml}
        `;
    }

    function renderReportSalesSummary() {
        const reportArea = document.getElementById('reportArea');
        const list = filterInvoicesForReport();
        if (list.length === 0) {
            reportArea.innerHTML = '<p>No invoices found for this filter.</p>';
            return;
        }

        const sumsByDate = {};
        let grandTotal = 0;
        list.forEach(function(inv) {
            const f = getInvoiceFinancials(inv);
            if (!sumsByDate[inv.date]) sumsByDate[inv.date] = 0;
            sumsByDate[inv.date] += f.total;
            grandTotal += f.total;
        });

        const dates = Object.keys(sumsByDate).sort();
        const rows = dates.map(function(d) {
            return `
                <tr>
                    <td>${d}</td>
                    <td>${sumsByDate[d].toFixed(2)}</td>
                </tr>
            `;
        }).join('');

        reportArea.innerHTML = `
            <h3>Sales Summary</h3>
            <div class="report-summary">
                Invoices: ${list.length} &nbsp; | &nbsp; Total: $${grandTotal.toFixed(2)}
            </div>
            <table>
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Total Sales</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
        `;
    }

    // NEW: SALES OF ITEMS REPORT
    function renderReportItemSales() {
        const reportArea = document.getElementById('reportArea');
        const list = filterInvoicesForReport();

        if (list.length === 0) {
            reportArea.innerHTML = '<p>No invoices found for this filter.</p>';
            return;
        }

        const salesMap = {};
        let grandQty = 0;
        let grandTotal = 0;

        list.forEach(function(inv) {
            if (!inv.items) return;

            inv.items.forEach(function(line) {
                const qty = parseInt(line.quantity) || 0;
                const price = parseFloat(line.price) || 0;
                if (qty <= 0) return;

                const lineTotal = qty * price;
                grandQty += qty;
                grandTotal += lineTotal;

                let key;
                if (line.itemId) {
                    key = 'stock-' + line.itemId;
                } else {
                    key = 'custom-' + (line.name || 'Custom Item');
                }

                if (!salesMap[key]) {
                    let stockItem = null;
                    let partNumber = '';
                    let displayName = line.name || '';

                    if (line.itemId) {
                        stockItem = items.find(function(i) { return i.id === line.itemId; });
                        if (stockItem) {
                            if (!displayName) displayName = stockItem.name;
                            partNumber = stockItem.partNumber || '';
                        }
                    }

                    if (!displayName) {
                        displayName = 'Item';
                    }

                    salesMap[key] = {
                        itemId: line.itemId || null,
                        name: displayName,
                        partNumber: partNumber,
                        totalQty: 0,
                        totalSales: 0
                    };
                }

                salesMap[key].totalQty += qty;
                salesMap[key].totalSales += lineTotal;
            });
        });

        const keys = Object.keys(salesMap);
        if (keys.length === 0) {
            reportArea.innerHTML = '<p>No item sales found for this filter.</p>';
            return;
        }

        keys.sort(function(a, b) {
            return salesMap[b].totalSales - salesMap[a].totalSales;
        });

        const rows = keys.map(function(key) {
            const entry = salesMap[key];
            return `
                <tr>
                    <td>${entry.name}</td>
                    <td>${entry.partNumber || ''}</td>
                    <td>${entry.totalQty}</td>
                    <td>${entry.totalSales.toFixed(2)}</td>
                </tr>
            `;
        }).join('');

        reportArea.innerHTML = `
            <h3>Item Sales</h3>
            <div class="report-summary">
                Total quantity sold: ${grandQty}
                &nbsp; | &nbsp;
                Total sales: $${grandTotal.toFixed(2)}
            </div>
            <table>
                <thead>
                    <tr>
                        <th>Item</th>
                        <th>Part #</th>
                        <th>Quantity Sold</th>
                        <th>Total Sales</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
        `;
    }

    // NEW: TOP ITEMS SOLD (sorted by quantity)
    function renderReportTopItems() {
        const reportArea = document.getElementById('reportArea');
        const list = filterInvoicesForReport();

        if (list.length === 0) {
            reportArea.innerHTML = '<p>No invoices found for this filter.</p>';
            return;
        }

        const salesMap = {};
        let grandQty = 0;
        let grandTotal = 0;

        list.forEach(function(inv) {
            if (!inv.items) return;

            inv.items.forEach(function(line) {
                const qty = parseInt(line.quantity) || 0;
                const price = parseFloat(line.price) || 0;
                if (qty <= 0) return;

                const lineTotal = qty * price;
                grandQty += qty;
                grandTotal += lineTotal;

                let key;
                if (line.itemId) {
                    key = 'stock-' + line.itemId;
                } else {
                    key = 'custom-' + (line.name || 'Custom Item');
                }

                if (!salesMap[key]) {
                    let stockItem = null;
                    let partNumber = '';
                    let displayName = line.name || '';

                    if (line.itemId) {
                        stockItem = items.find(function(i) { return i.id === line.itemId; });
                        if (stockItem) {
                            if (!displayName) displayName = stockItem.name;
                            partNumber = stockItem.partNumber || '';
                        }
                    }

                    if (!displayName) {
                        displayName = 'Item';
                    }

                    salesMap[key] = {
                        itemId: line.itemId || null,
                        name: displayName,
                        partNumber: partNumber,
                        totalQty: 0,
                        totalSales: 0
                    };
                }

                salesMap[key].totalQty += qty;
                salesMap[key].totalSales += lineTotal;
            });
        });

        const keys = Object.keys(salesMap);
        if (keys.length === 0) {
            reportArea.innerHTML = '<p>No item sales found for this filter.</p>';
            return;
        }

        keys.sort(function(a, b) {
            return salesMap[b].totalQty - salesMap[a].totalQty;
        });

        const rows = keys.map(function(key) {
            const entry = salesMap[key];
            return `
                <tr>
                    <td>${entry.name}</td>
                    <td>${entry.partNumber || ''}</td>
                    <td>${entry.totalQty}</td>
                    <td>${entry.totalSales.toFixed(2)}</td>
                </tr>
            `;
        }).join('');

        reportArea.innerHTML = `
            <h3>Top Items Sold</h3>
            <div class="report-summary">
                Total quantity sold: ${grandQty}
                &nbsp; | &nbsp;
                Total sales: $${grandTotal.toFixed(2)}
            </div>
            <table>
                <thead>
                    <tr>
                        <th>Item</th>
                        <th>Part #</th>
                        <th>Quantity Sold</th>
                        <th>Total Sales</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
        `;
    }

    function renderReportInvoiceList() {
        const reportArea = document.getElementById('reportArea');
        const list = filterInvoicesForReport();
        if (list.length === 0) {
            reportArea.innerHTML = '<p>No invoices found for this filter.</p>';
            return;
        }

        let grandTotal = 0;

        const rows = list.map(function(inv) {
            const client = clients.find(function(c) { return c.id === inv.clientId; });
            const car = inv.carId ? cars.find(function(c) { return c.id === inv.carId; }) : null;
            const f = getInvoiceFinancials(inv);
            const statusClass = f.status === 'paid' ? 'status-paid' : 'status-unpaid';
            const statusText = f.status === 'paid' ? '✓ PAID' : '⏳ UNPAID';
            grandTotal += f.total;
            return `
                <tr>
                    <td>${inv.invoiceNumber}</td>
                    <td>${inv.date}</td>
                    <td>${client ? client.name : 'N/A'}</td>
                    <td>${car ? (car.make + ' ' + car.model) : 'N/A'}</td>
                    <td>${f.total.toFixed(2)}</td>
                    <td>${f.amountPaid.toFixed(2)}</td>
                    <td>${f.remaining.toFixed(2)}</td>
                    <td class="${statusClass}">${statusText}</td>
                </tr>
            `;
        }).join('');

        reportArea.innerHTML = `
            <h3>Invoice List</h3>
            <div class="report-summary">
                Invoices: ${list.length} &nbsp; | &nbsp; Total: $${grandTotal.toFixed(2)}
            </div>
            <table>
                <thead>
                    <tr>
                        <th>Invoice #</th>
                        <th>Date</th>
                        <th>Client</th>
                        <th>Car</th>
                        <th>Total</th>
                        <th>Paid</th>
                        <th>Remaining</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
        `;
    }

    function renderReportInventory() {
        const reportArea = document.getElementById('reportArea');
        const stockItems = (items || []).filter(function(i) { return !isServiceItem(i); });
        if (stockItems.length === 0) {
            reportArea.innerHTML = '<p>No items in inventory.</p>';
            return;
        }

        const rows = stockItems.map(function(i) {
            const stock = getItemTotalQty(i) || 0;
            const threshold = i.lowStockThreshold || 5;
            const isLowStock = stock <= threshold;
            const flag = isLowStock ? '🚩 ' : '';
            return `
                <tr>
                    <td>${i.name}</td>
                    <td>${i.partNumber || ''}</td>
                    <td>${i.location || ''}</td>
                    <td>${i.price.toFixed(2)}</td>
                    <td>${stock}</td>
                    <td>${threshold}</td>
                    <td>${flag}${i.description || ''}</td>
                </tr>
            `;
        }).join('');

        reportArea.innerHTML = `
            <h3>Inventory</h3>
            <table>
                <thead>
                    <tr>
                        <th>Item</th>
                        <th>Part #</th>
                        <th>Location</th>
                        <th>Price</th>
                        <th>Quantity</th>
                        <th>Low Stock Alert</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
        `;
    }

    // NEW: INVENTORY COST SUMMARY
    function renderReportInventoryCost() {
        const reportArea = document.getElementById('reportArea');
        const canSeeCost = (typeof hasItemAdminAccess === 'function')
            ? hasItemAdminAccess()
            : (typeof hasPerm === 'function' ? hasPerm("*") : false);

        if (!canSeeCost) {
            reportArea.innerHTML = '<p>Access denied. Only Main Admin or Saadeyat Stock can view inventory cost.</p>';
            return;
        }

        const stockItems = (items || []).filter(function(i) { return !isServiceItem(i); });
        if (stockItems.length === 0) {
            reportArea.innerHTML = '<p>No items in inventory.</p>';
            return;
        }

        const qtyFn = (typeof getItemTotalQty === 'function')
            ? getItemTotalQty
            : function(it){ return parseInt(it && it.quantity, 10) || 0; };
        const safeIntLocal = (typeof safeInt === 'function')
            ? safeInt
            : function(n){ const x = parseInt(n, 10); return isNaN(x) ? 0 : x; };

        let totalQty = 0;
        let totalCost = 0;

        const rows = stockItems.map(function(i) {
            const qty = safeIntLocal(qtyFn(i));
            const cost = parseFloat(i.costPrice || i.cost || i.cost_price || 0) || 0;
            const line = cost * qty;
            totalQty += qty;
            totalCost += line;
            return `
                <tr>
                    <td>${i.name || ''}</td>
                    <td>${i.partNumber || ''}</td>
                    <td>${cost.toFixed(2)}</td>
                    <td>${qty}</td>
                    <td>${line.toFixed(2)}</td>
                </tr>
            `;
        }).join('');

        reportArea.innerHTML = `
            <h3>Inventory Cost Summary</h3>
            <div class="report-summary">
                Total quantity: ${totalQty}
                &nbsp; | &nbsp;
                Total cost: $${totalCost.toFixed(2)}
            </div>
            <div style="margin:10px 0;">
                <button class="btn btn-secondary print-btn" type="button" onclick="printReportArea()">Print</button>
            </div>
            <table>
                <thead>
                    <tr>
                        <th>Item</th>
                        <th>Part #</th>
                        <th>Cost Price</th>
                        <th>Quantity</th>
                        <th>Total Cost</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
        `;
    }

    // NEW: TODAY EXPENSES TOTAL (USD/LBP)
    function renderReportExpenseToday() {
        const reportArea = document.getElementById('reportArea');
        const today = new Date().toISOString().split('T')[0];

        const list = (expenses || []).filter(function(e) {
            return String(e.date || '').trim() === today;
        });

        if (list.length === 0) {
            reportArea.innerHTML = `<p>No expenses found for today (${today}).</p>`;
            return;
        }

        let totalUsd = 0;
        let totalLbp = 0;
        list.forEach(function(e) {
            const amount = Number(e.amount) || 0;
            const curr = (e.currency === 'LBP') ? 'LBP' : 'USD';
            if (curr === 'LBP') totalLbp += amount;
            else totalUsd += amount;
        });

        reportArea.innerHTML = `
            <h3>Today Expenses Total</h3>
            <div class="report-summary">
                Date: ${today}
                &nbsp; | &nbsp;
                Total (USD): ${totalUsd.toFixed(2)}
                &nbsp; | &nbsp;
                Total (L.L): ${formatLbp(totalLbp)}
                ${getLbpUsdRate() ? `&nbsp; | &nbsp; Total (USD incl. L.L): ${(totalUsd + (totalLbp / getLbpUsdRate())).toFixed(2)}` : ''}
            </div>
        `;
    }

    // NEW: TODAY INCOME (PAID INVOICES ONLY)
    function renderReportIncomeToday() {
        const reportArea = document.getElementById('reportArea');
        const today = new Date().toISOString().split('T')[0];

        const list = (invoices || []).filter(function(inv) {
            return String(inv.paidAt || '').trim() === today;
        });

        if (list.length === 0) {
            reportArea.innerHTML = `<p>No invoices found for today (${today}).</p>`;
            return;
        }

        let totalIncome = 0;
        let paidCount = 0;
        list.forEach(function(inv) {
            const f = getInvoiceFinancials(inv);
            if (f.status === 'paid') {
                totalIncome += f.total;
                paidCount += 1;
            }
        });

        reportArea.innerHTML = `
            <h3>Today Income (Paid Invoices)</h3>
            <div class="report-summary">
                Paid Date: ${today}
                &nbsp; | &nbsp;
                Paid invoices: ${paidCount}
                &nbsp; | &nbsp;
                Total income: $${totalIncome.toFixed(2)}
            </div>
        `;
    }

    // NEW: WEEKLY PAYROLL (USD + L.L)
    function renderReportWeeklyPayroll() {
        const reportArea = document.getElementById('reportArea');

        if (!employees || employees.length === 0) {
            reportArea.innerHTML = '<p>No employees found.</p>';
            return;
        }

        let totalUsd = 0;
        let totalLbp = 0;

        const rows = employees.map(function(e) {
            const usd = Number(e.weeklySalaryUsd) || 0;
            const lbp = Number(e.weeklySalaryLbp) || 0;
            totalUsd += usd;
            totalLbp += lbp;
            return `
                <tr>
                    <td>${e.name || ''}</td>
                    <td>${e.role || ''}</td>
                    <td>${usd.toFixed(2)}</td>
                    <td>${formatLbp(lbp)}</td>
                </tr>
            `;
        }).join('');

        reportArea.innerHTML = `
            <h3>Weekly Payroll</h3>
            <div class="report-summary">
                Total weekly payroll: $${totalUsd.toFixed(2)} &nbsp; | &nbsp; L.L ${formatLbp(totalLbp)}
            </div>
            <table>
                <thead>
                    <tr>
                        <th>Employee</th>
                        <th>Role</th>
                        <th>Weekly Salary ($)</th>
                        <th>Weekly Salary (L.L)</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
        `;
    }

    // NEW: PAYROLL PAYMENTS REPORT
    function renderReportPayrollPayments() {
        const reportArea = document.getElementById('reportArea');
        const start = document.getElementById('reportStartDate').value;
        const end = document.getElementById('reportEndDate').value;

        try { if (window.garageDB) { employees = window.garageDB.getAll('employees') || employees || []; } } catch(e) {}
        rebuildPayrollPaymentsFromEmployees();

        if (!payrollPayments || payrollPayments.length === 0) {
            reportArea.innerHTML = '<p>No payroll payments found.</p>';
            return;
        }

        const empById = new Map((employees || []).map(function(e){ return [String(e.id), e]; }));
        const list = payrollPayments.filter(function(p) {
            const d = String(p.date || '');
            if (start && d < start) return false;
            if (end && d > end) return false;
            return true;
        }).sort(function(a, b) {
            const da = String(a.date || '');
            const db = String(b.date || '');
            if (da !== db) return db.localeCompare(da);
            return (b.id || 0) - (a.id || 0);
        });

        if (list.length === 0) {
            reportArea.innerHTML = '<p>No payroll payments found for this date range.</p>';
            return;
        }

        let totalUsd = 0;
        let totalLbp = 0;

        const rows = list.map(function(p) {
            const emp = empById.get(String(p.employeeId)) || {};
            const baseUsd = Number(p.baseUsd) || 0;
            const baseLbp = Number(p.baseLbp) || 0;
            const bonusUsd = Number(p.bonusUsd) || 0;
            const bonusLbp = Number(p.bonusLbp) || 0;
            totalUsd += (baseUsd + bonusUsd);
            totalLbp += (baseLbp + bonusLbp);
            return `
                <tr>
                    <td>${p.date || ''}</td>
                    <td>${emp.name || ''}</td>
                    <td>${baseUsd.toFixed(2)}</td>
                    <td>${formatLbp(baseLbp)}</td>
                    <td>${bonusUsd.toFixed(2)}</td>
                    <td>${formatLbp(bonusLbp)}</td>
                    <td>${p.notes || ''}</td>
                </tr>
            `;
        }).join('');

        reportArea.innerHTML = `
            <h3>Payroll Payments</h3>
            <div class="report-summary">
                Date range: ${start || 'All'} to ${end || 'All'}
                &nbsp; | &nbsp;
                Total paid: $${totalUsd.toFixed(2)} &nbsp; | &nbsp; L.L ${formatLbp(totalLbp)}
            </div>
            <table>
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Employee</th>
                        <th>Base ($)</th>
                        <th>Base (L.L)</th>
                        <th>Bonus ($)</th>
                        <th>Bonus (L.L)</th>
                        <th>Notes</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
        `;
    }

    let __printSetupDone = false;
    function printReportArea() {
        try {
            if (!__printSetupDone) {
                __printSetupDone = true;
                window.addEventListener('afterprint', () => {
                    document.body.classList.remove('print-report');
                });
            }
            document.body.classList.add('print-report');
            window.print();
        } catch (e) {}
    }

    function renderReportLowStock() {
        const reportArea = document.getElementById('reportArea');
        const lowItems = items.filter(function(i) {
            if (isServiceItem(i)) return false;
            const stock = getItemTotalQty(i) || 0;
            const threshold = i.lowStockThreshold || 5;
            return stock <= threshold;
        });

        if (lowItems.length === 0) {
            reportArea.innerHTML = '<p>No low stock items. You\'re good 👍</p>';
            return;
        }

        const rows = lowItems.map(function(i) {
            const stock = getItemTotalQty(i) || 0;
            const threshold = i.lowStockThreshold || 5;
            return `
                <tr>
                    <td>${i.name}</td>
                    <td>${i.partNumber || ''}</td>
                    <td>${i.location || ''}</td>
                    <td>${i.price.toFixed(2)}</td>
                    <td style="color:red;font-weight:bold;">${stock}</td>
                    <td>${threshold}</td>
                    <td>${i.description || ''}</td>
                </tr>
            `;
        }).join('');

        reportArea.innerHTML = `
            <h3>Low Stock Items</h3>
            <table>
                <thead>
                    <tr>
                        <th>Item</th>
                        <th>Part #</th>
                        <th>Location</th>
                        <th>Price</th>
                        <th>Quantity</th>
                        <th>Low Stock Alert</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
        `;
    }

    function renderReportClientHistory() {
        const reportArea = document.getElementById('reportArea');
        const clientIdStr = document.getElementById('reportClientId').value;
        if (!clientIdStr) {
            reportArea.innerHTML = '<p>Please select a client for Client History report.</p>';
            return;
        }
        const clientId = parseInt(clientIdStr);

        const list = filterInvoicesForReport().filter(function(inv) {
            return inv.clientId === clientId;
        });

        const client = clients.find(function(c) { return c.id === clientId; });

        if (list.length === 0) {
            reportArea.innerHTML = '<p>No invoices found for this client with the selected filters.</p>';
            return;
        }

        let totalPaid = 0;
        let totalUnpaid = 0;

        list.forEach(function(inv) {
            const f = getInvoiceFinancials(inv);
            totalPaid += f.amountPaid;
            totalUnpaid += f.remaining;
        });

        const rows = list.map(function(inv) {
            const car = inv.carId ? cars.find(function(c) { return c.id === inv.carId; }) : null;
            const f = getInvoiceFinancials(inv);
            const statusClass = f.status === 'paid' ? 'status-paid' : 'status-unpaid';
            const statusText = f.status === 'paid' ? '✓ PAID' : '⏳ UNPAID';
            return `
                <tr>
                    <td>${inv.invoiceNumber}</td>
                    <td>${inv.date}</td>
                    <td>${car ? (car.make + ' ' + car.model) : 'N/A'}</td>
                    <td>${f.total.toFixed(2)}</td>
                    <td>${f.amountPaid.toFixed(2)}</td>
                    <td>${f.remaining.toFixed(2)}</td>
                    <td class="${statusClass}">${statusText}</td>
                </tr>
            `;
        }).join('');

        reportArea.innerHTML = `
            <h3>Client History - ${client ? client.name : 'Client'}</h3>
            <div class="report-summary">
                Invoices: ${list.length} &nbsp; | &nbsp;
                Paid: $${totalPaid.toFixed(2)} &nbsp; | &nbsp;
                Unpaid: $${totalUnpaid.toFixed(2)}
            </div>
            <table>
                <thead>
                    <tr>
                        <th>Invoice #</th>
                        <th>Date</th>
                        <th>Car</th>
                        <th>Total</th>
                        <th>Paid</th>
                        <th>Remaining</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
        `;
    }




