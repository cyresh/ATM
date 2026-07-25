/* ============================================================
   Auditor Task Manager — Local Database Layer
   Storage engine: localStorage (reliable offline, works even when
   the file is opened directly on a phone — no server required).
   Same async-style API as before so app.js is unaffected.
   ============================================================ */

const DB_KEY = "atm_db_v1";

const STORES = {
  clients: "clients",
  taskTypes: "taskTypes",
  clientTasks: "clientTasks",
  subtasks: "subtasks",
  categories: "categories",
  profile: "profile",       // single-record store keyed by "key"="main"
  settings: "settings", // keyed by "key", not "id"
};

function _load() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn("DB load failed, reinitializing", e);
  }
  return {
    clients: [],
    taskTypes: [],
    clientTasks: [],
    subtasks: [],
    categories: [],
    profile: [],
    settings: [],
    _counters: { clients: 1, taskTypes: 1, clientTasks: 1, subtasks: 1, categories: 1 },
  };
}

function _save(data) {
  localStorage.setItem(DB_KEY, JSON.stringify(data));
}

function _nextId(data, storeName) {
  if (!data._counters) data._counters = {};
  const next = data._counters[storeName] || 1;
  data._counters[storeName] = next + 1;
  return next;
}

const DB = {
  get(storeName, key) {
    const data = _load();
    const arr = data[storeName] || [];
    const keyField = (storeName === STORES.settings || storeName === STORES.profile) ? "key" : "id";
    const found = arr.find((row) => row[keyField] === key);
    return Promise.resolve(found);
  },

  getAll(storeName) {
    const data = _load();
    return Promise.resolve((data[storeName] || []).slice());
  },

  put(storeName, value) {
    const data = _load();
    if (!data[storeName]) data[storeName] = [];
    const keyField = (storeName === STORES.settings || storeName === STORES.profile) ? "key" : "id";

    if (value[keyField] === undefined || value[keyField] === null) {
      value[keyField] = _nextId(data, storeName);
    }

    const idx = data[storeName].findIndex((row) => row[keyField] === value[keyField]);
    if (idx >= 0) {
      data[storeName][idx] = value;
    } else {
      data[storeName].push(value);
    }
    _save(data);
    return Promise.resolve(value[keyField]);
  },

  delete(storeName, key) {
    const data = _load();
    const keyField = (storeName === STORES.settings || storeName === STORES.profile) ? "key" : "id";
    data[storeName] = (data[storeName] || []).filter((row) => row[keyField] !== key);
    _save(data);
    return Promise.resolve();
  },

  count(storeName) {
    const data = _load();
    return Promise.resolve((data[storeName] || []).length);
  },
};

/* ------------------------------------------------------------
   Default categories + task taxonomy (confirmed spec) — seeded
   once on first launch. Editable in Settings (Stage 2).
   ------------------------------------------------------------ */
const DEFAULT_CATEGORIES = [
  { name: "Income Tax", default_due_rule: "" },
  { name: "GST", default_due_rule: "" },
  { name: "DGFT", default_due_rule: "" },
  { name: "FSSAI", default_due_rule: "" },
  { name: "Bank", default_due_rule: "" },
  { name: "Firm", default_due_rule: "" },
];

const DEFAULT_TASK_TYPES = [
  { name: "ITR", category: "Income Tax", sub_type: "N/TA", frequency: "Yearly", one_time: false },
  { name: "TDS Payment", category: "Income Tax", sub_type: "", frequency: "M/Q/Y", one_time: false },
  { name: "TDS Return", category: "Income Tax", sub_type: "", frequency: "Q/Y", one_time: false },
  { name: "GSTR1", category: "GST", sub_type: "", frequency: "Monthly", one_time: false },
  { name: "GSTR3B", category: "GST", sub_type: "", frequency: "Monthly", one_time: false },
  { name: "GSTR9", category: "GST", sub_type: "", frequency: "Yearly", one_time: false },
  { name: "GSTR9C", category: "GST", sub_type: "", frequency: "Yearly", one_time: false },
  { name: "LUT", category: "GST", sub_type: "", frequency: "Yearly", one_time: false },
  { name: "ITC04", category: "GST", sub_type: "", frequency: "Quarterly/Half-Yearly", one_time: false },
  { name: "IEC Applying", category: "DGFT", sub_type: "", frequency: "One-time", one_time: true },
  { name: "IEC Renewal", category: "DGFT", sub_type: "", frequency: "Yearly", one_time: false },
  { name: "FSSAI License Renewal", category: "FSSAI", sub_type: "", frequency: "Yearly", one_time: false },
  { name: "Bank Loan", category: "Bank", sub_type: "", frequency: "Renewal", one_time: false },
  { name: "Bank Stock Statement", category: "Bank", sub_type: "", frequency: "M/Q/Y", one_time: false },
  { name: "Firm Renewal", category: "Firm", sub_type: "", frequency: "Yearly", one_time: false },
];

const DEFAULT_SETTINGS = [
  { key: "pin_code", value: "1234" },
  { key: "pin_enabled", value: true },
  { key: "biometric_enabled", value: false },
  { key: "biometric_credential_id", value: null },
  { key: "font_size", value: "medium" },
  { key: "app_version", value: "0.8.0 (Stage 8)" },
  { key: "seeded", value: false },
];

async function seedIfNeeded() {
  const seededRow = await DB.get(STORES.settings, "seeded");
  if (seededRow && seededRow.value === true) return;

  for (const s of DEFAULT_SETTINGS) {
    const existing = await DB.get(STORES.settings, s.key);
    if (!existing) await DB.put(STORES.settings, s);
  }

  const catCount = await DB.count(STORES.categories);
  if (catCount === 0) {
    for (const c of DEFAULT_CATEGORIES) await DB.put(STORES.categories, c);
  }

  const taskCount = await DB.count(STORES.taskTypes);
  if (taskCount === 0) {
    for (const t of DEFAULT_TASK_TYPES) await DB.put(STORES.taskTypes, t);
  }

  await DB.put(STORES.settings, { key: "seeded", value: true });
  await setSetting("app_version", "0.8.0 (Stage 8)");
}

async function getSetting(key, fallback = null) {
  const row = await DB.get(STORES.settings, key);
  return row ? row.value : fallback;
}

async function setSetting(key, value) {
  return DB.put(STORES.settings, { key, value });
}

async function getProfile() {
  const row = await DB.get(STORES.profile, "main");
  return row ? row.value : { name: "", firm_name: "", phone: "", email: "", logo: null };
}

async function setProfile(profileData) {
  return DB.put(STORES.profile, { key: "main", value: profileData });
}
