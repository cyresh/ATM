/* ============================================================
   Auditor Task Manager — App Shell
   Stage 1: navigation, PIN lock, biometric hook, settings wiring
   ============================================================ */

const VIEW_TITLES = {
  dashboard: "Dashboard",
  clients: "Clients",
  tasks: "Tasks",
  priority: "Priority",
  settings: "Settings",
  taskEditor: "Task Types",
  categoryEditor: "Categories",
};

let navHistory = ["dashboard"];

function showView(name, pushHistory = true, titleOverride = null) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.getElementById("view-" + name).classList.add("active");
  document.getElementById("viewTitle").textContent = titleOverride || VIEW_TITLES[name] || name;
  const isTab = !!document.querySelector(`.navbtn[data-view="${name}"]`);
  if (isTab) {
    document.querySelectorAll(".navbtn").forEach((b) => {
      b.classList.toggle("active", b.dataset.view === name);
    });
  }
  if (pushHistory) {
    if (navHistory[navHistory.length - 1] !== name) navHistory.push(name);
  }
  document.getElementById("views").scrollTop = 0;
}

function initNav() {
  document.querySelectorAll(".navbtn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      showView(btn.dataset.view);
      if (btn.dataset.view === "clients") {
        await renderClientCategoryFilters();
        await renderClientList();
      } else if (btn.dataset.view === "tasks") {
        await renderTaskTypeGroups();
      } else if (btn.dataset.view === "priority") {
        await renderPriorityTab();
      }
    });
  });
  document.getElementById("homeBtn").addEventListener("click", () => {
    navHistory = ["dashboard"];
    showView("dashboard", false);
  });
  document.getElementById("backBtn").addEventListener("click", async () => {
    if (navHistory.length > 1) {
      navHistory.pop();
      const target = navHistory[navHistory.length - 1];
      showView(target, false);
      if (target === "clients") await renderClientList();
      else if (target === "clientDetail") await renderClientDetail();
      else if (target === "clientTaskDetail") await renderClientTaskDetail();
      else if (target === "tasks") await renderTaskTypeGroups();
      else if (target === "taskClients") await renderTaskClientList();
      else if (target === "priority") await renderPriorityTab();
    }
  });
}

/* ------------------------------------------------------------
   PIN lock screen
   ------------------------------------------------------------ */
let currentPinEntry = "";

function updatePinDots(containerId, length) {
  const dots = document.querySelectorAll(`#${containerId} .pin-dot`);
  dots.forEach((d, i) => d.classList.toggle("filled", i < length));
}

function shakeDots(containerId) {
  const el = document.getElementById(containerId);
  el.classList.add("shake");
  setTimeout(() => el.classList.remove("shake"), 350);
}

async function attemptUnlock() {
  const storedPin = await getSetting("pin_code", "1234");
  if (currentPinEntry === storedPin) {
    document.getElementById("lockscreen").classList.add("hidden");
    currentPinEntry = "";
    updatePinDots("pinDots", 0);
    document.getElementById("lockError").textContent = "";
  } else {
    document.getElementById("lockError").textContent = "Incorrect PIN";
    shakeDots("pinDots");
    setTimeout(() => {
      currentPinEntry = "";
      updatePinDots("pinDots", 0);
    }, 300);
  }
}

function initKeypad(keypadId, dotsId, maxLen, onComplete) {
  let entryRef = { value: "" };
  document.getElementById(keypadId).querySelectorAll(".key").forEach((key) => {
    key.addEventListener("click", () => {
      const k = key.dataset.k;
      if (k === "del") {
        entryRef.value = entryRef.value.slice(0, -1);
      } else if (entryRef.value.length < maxLen) {
        entryRef.value += k;
      }
      updatePinDots(dotsId, entryRef.value.length);
      if (entryRef.value.length === maxLen) {
        const finalVal = entryRef.value;
        onComplete(finalVal, () => {
          entryRef.value = "";
          updatePinDots(dotsId, 0);
        });
      }
    });
  });
  return entryRef;
}

async function showLockScreenIfNeeded() {
  const pinEnabled = await getSetting("pin_enabled", true);
  const lockEl = document.getElementById("lockscreen");
  if (!pinEnabled) {
    lockEl.classList.add("hidden");
    return;
  }
  lockEl.classList.remove("hidden");
  currentPinEntry = "";
  updatePinDots("pinDots", 0);

  const bioEnabled = await getSetting("biometric_enabled", false);
  const bioBtn = document.getElementById("bioUnlockBtn");
  if (bioEnabled && window.PublicKeyCredential) {
    bioBtn.classList.remove("hidden");
  } else {
    bioBtn.classList.add("hidden");
  }
}

function initLockScreen() {
  initKeypad("keypad", "pinDots", 4, (val) => {
    currentPinEntry = val;
    attemptUnlock();
  });

  document.getElementById("bioUnlockBtn").addEventListener("click", async () => {
    const ok = await tryBiometricUnlock();
    if (ok) {
      document.getElementById("lockscreen").classList.add("hidden");
    } else {
      document.getElementById("lockError").textContent = "Fingerprint not recognized — use PIN";
    }
  });
}

/* ------------------------------------------------------------
   Biometric (WebAuthn platform authenticator)
   ------------------------------------------------------------ */
function randomChallenge() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return arr;
}

async function registerBiometric() {
  if (!window.PublicKeyCredential) {
    alert("Biometric unlock isn't supported on this device.");
    return false;
  }
  try {
    const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    if (!available) {
      alert("No fingerprint/face unlock is set up on this device.");
      return false;
    }
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: randomChallenge(),
        rp: { name: "Auditor Task Manager" },
        user: {
          id: randomChallenge(),
          name: "auditor",
          displayName: "Auditor",
        },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
        timeout: 60000,
      },
    });
    const credId = btoa(String.fromCharCode(...new Uint8Array(cred.rawId)));
    await setSetting("biometric_credential_id", credId);
    await setSetting("biometric_enabled", true);
    return true;
  } catch (err) {
    console.error("Biometric registration failed", err);
    return false;
  }
}

async function tryBiometricUnlock() {
  try {
    const credIdStr = await getSetting("biometric_credential_id", null);
    const opts = {
      challenge: randomChallenge(),
      timeout: 60000,
      userVerification: "required",
    };
    if (credIdStr) {
      const raw = Uint8Array.from(atob(credIdStr), (c) => c.charCodeAt(0));
      opts.allowCredentials = [{ id: raw, type: "public-key" }];
    }
    const assertion = await navigator.credentials.get({ publicKey: opts });
    return !!assertion;
  } catch (err) {
    console.error("Biometric unlock failed", err);
    return false;
  }
}

/* ------------------------------------------------------------
   Settings tab wiring
   ------------------------------------------------------------ */
async function initSettings() {
  const pinToggle = document.getElementById("pinToggle");
  const bioToggle = document.getElementById("bioToggle");
  const bioSub = document.getElementById("bioSub");
  const aboutText = document.getElementById("aboutText");

  pinToggle.checked = await getSetting("pin_enabled", true);
  bioToggle.checked = await getSetting("biometric_enabled", false);
  const version = await getSetting("app_version", "0.1.0");
  aboutText.textContent = `Version ${version}`;

  if (!window.PublicKeyCredential) {
    bioSub.textContent = "Not supported on this device";
    bioToggle.disabled = true;
  }

  pinToggle.addEventListener("change", async () => {
    await setSetting("pin_enabled", pinToggle.checked);
    if (!pinToggle.checked) {
      bioToggle.checked = false;
      await setSetting("biometric_enabled", false);
    }
  });

  bioToggle.addEventListener("change", async () => {
    if (bioToggle.checked) {
      const pinEnabled = await getSetting("pin_enabled", true);
      if (!pinEnabled) {
        alert("Turn on PIN lock first — biometric unlock needs PIN as a fallback.");
        bioToggle.checked = false;
        return;
      }
      const ok = await registerBiometric();
      bioToggle.checked = ok;
      if (!ok) alert("Couldn't set up fingerprint unlock. Try again.");
    } else {
      await setSetting("biometric_enabled", false);
    }
  });

  document.getElementById("changePinLink").addEventListener("click", openChangePinModal);
}

/* ------------------------------------------------------------
   Change PIN modal
   ------------------------------------------------------------ */
function openChangePinModal() {
  document.getElementById("changePinModal").classList.remove("hidden");
  updatePinDots("newPinDots", 0);
  document.getElementById("changePinError").textContent = "";
}

function closeChangePinModal() {
  document.getElementById("changePinModal").classList.add("hidden");
}

function initChangePinModal() {
  initKeypad("changeKeypad", "newPinDots", 4, async (val, reset) => {
    await setSetting("pin_code", val);
    document.getElementById("changePinError").style.color = "var(--good)";
    document.getElementById("changePinError").textContent = "PIN updated";
    setTimeout(() => {
      closeChangePinModal();
      document.getElementById("changePinError").style.color = "var(--bad)";
    }, 700);
  });
  document.getElementById("cancelChangePin").addEventListener("click", closeChangePinModal);
}

/* ------------------------------------------------------------
   Stage 2 — Task & Category Editor
   ------------------------------------------------------------ */
let editingTaskId = null;
let editingCategoryId = null;

async function loadCategories() {
  const cats = await DB.getAll(STORES.categories);
  return cats.sort((a, b) => a.name.localeCompare(b.name));
}

async function loadTaskTypes() {
  const tasks = await DB.getAll(STORES.taskTypes);
  return tasks.sort((a, b) => a.name.localeCompare(b.name));
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

async function renderTaskEditor() {
  const [tasks, categories] = await Promise.all([loadTaskTypes(), loadCategories()]);
  const container = document.getElementById("taskGroups");

  if (tasks.length === 0) {
    container.innerHTML = `<div class="empty-state">No task types yet. Tap "+ Add Task Type" to create one.</div>`;
    return;
  }

  const byCategory = {};
  tasks.forEach((t) => {
    const cat = t.category || "Uncategorized";
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(t);
  });

  const orderedCatNames = [
    ...categories.map((c) => c.name).filter((n) => byCategory[n]),
    ...Object.keys(byCategory).filter((n) => !categories.some((c) => c.name === n)),
  ];

  let html = "";
  orderedCatNames.forEach((catName) => {
    html += `<div class="group-header">${escapeHtml(catName)}</div>`;
    byCategory[catName].forEach((t) => {
      const bits = [];
      if (t.frequency) bits.push(t.frequency);
      if (t.sub_type) bits.push(t.sub_type);
      html += `
        <div class="list-row" data-task-id="${t.id}">
          <div class="list-row-main">
            <div class="list-row-title">${escapeHtml(t.name)}</div>
            <div class="list-row-sub">
              ${bits.map((b) => `<span class="badge">${escapeHtml(b)}</span>`).join("")}
              ${t.one_time ? `<span class="badge onetime">One-time</span>` : ""}
            </div>
          </div>
          <button class="row-edit-btn" data-edit-task="${t.id}">&#9998;</button>
        </div>`;
    });
  });
  container.innerHTML = html;

  container.querySelectorAll("[data-edit-task]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.editTask);
      const task = tasks.find((t) => t.id === id);
      openTaskModal(task);
    });
  });
}

async function populateCategoryDropdown() {
  const categories = await loadCategories();
  const select = document.getElementById("taskCategoryInput");
  select.innerHTML = categories.map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join("");
  return categories;
}

async function openTaskModal(task) {
  editingTaskId = task ? task.id : null;
  document.getElementById("taskModalTitle").textContent = task ? "Edit Task Type" : "Add Task Type";
  document.getElementById("taskModalError").textContent = "";
  await populateCategoryDropdown();

  document.getElementById("taskNameInput").value = task ? task.name : "";
  document.getElementById("taskCategoryInput").value = task ? task.category : "";
  document.getElementById("taskSubTypeInput").value = task ? task.sub_type || "" : "";
  document.getElementById("taskFrequencyInput").value = task ? task.frequency || "" : "";
  document.getElementById("taskOneTimeInput").checked = task ? !!task.one_time : false;
  document.getElementById("deleteTaskModal").style.display = task ? "block" : "none";

  document.getElementById("taskModal").classList.remove("hidden");
}

function closeTaskModal() {
  document.getElementById("taskModal").classList.add("hidden");
  editingTaskId = null;
}

async function saveTaskFromModal() {
  const name = document.getElementById("taskNameInput").value.trim();
  const category = document.getElementById("taskCategoryInput").value;
  const sub_type = document.getElementById("taskSubTypeInput").value.trim();
  const frequency = document.getElementById("taskFrequencyInput").value.trim();
  const one_time = document.getElementById("taskOneTimeInput").checked;

  if (!name) {
    document.getElementById("taskModalError").textContent = "Task name is required";
    return;
  }
  if (!category) {
    document.getElementById("taskModalError").textContent = "Add a category first";
    return;
  }

  const record = { name, category, sub_type, frequency, one_time };
  if (editingTaskId) record.id = editingTaskId;
  await DB.put(STORES.taskTypes, record);
  closeTaskModal();
  await renderTaskEditor();
}

async function deleteTaskFromModal() {
  if (!editingTaskId) return;
  if (!confirm("Delete this task type? This won't remove tasks already assigned to clients.")) return;
  await DB.delete(STORES.taskTypes, editingTaskId);
  closeTaskModal();
  await renderTaskEditor();
}

async function renderCategoryEditor() {
  const categories = await loadCategories();
  const container = document.getElementById("categoryList");

  if (categories.length === 0) {
    container.innerHTML = `<div class="empty-state">No categories yet. Tap "+ Add Category" to create one.</div>`;
    return;
  }

  container.innerHTML = categories.map((c) => `
    <div class="list-row" data-cat-id="${c.id}">
      <div class="list-row-main">
        <div class="list-row-title">${escapeHtml(c.name)}</div>
        <div class="list-row-sub">${c.default_due_rule ? escapeHtml(c.default_due_rule) : "No default due-date rule set"}</div>
      </div>
      <button class="row-edit-btn" data-edit-cat="${c.id}">&#9998;</button>
    </div>
  `).join("");

  container.querySelectorAll("[data-edit-cat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.editCat);
      const cat = categories.find((c) => c.id === id);
      openCategoryModal(cat);
    });
  });
}

function openCategoryModal(category) {
  editingCategoryId = category ? category.id : null;
  document.getElementById("categoryModalTitle").textContent = category ? "Edit Category" : "Add Category";
  document.getElementById("categoryModalError").textContent = "";
  document.getElementById("categoryNameInput").value = category ? category.name : "";
  document.getElementById("categoryDueRuleInput").value = category ? category.default_due_rule || "" : "";
  document.getElementById("deleteCategoryModal").style.display = category ? "block" : "none";
  document.getElementById("categoryModal").classList.remove("hidden");
}

function closeCategoryModal() {
  document.getElementById("categoryModal").classList.add("hidden");
  editingCategoryId = null;
}

async function saveCategoryFromModal() {
  const name = document.getElementById("categoryNameInput").value.trim();
  const default_due_rule = document.getElementById("categoryDueRuleInput").value.trim();

  if (!name) {
    document.getElementById("categoryModalError").textContent = "Category name is required";
    return;
  }

  const categories = await loadCategories();
  const clash = categories.find((c) => c.name.toLowerCase() === name.toLowerCase() && c.id !== editingCategoryId);
  if (clash) {
    document.getElementById("categoryModalError").textContent = "A category with this name already exists";
    return;
  }

  let oldName = null;
  if (editingCategoryId) {
    const existing = categories.find((c) => c.id === editingCategoryId);
    oldName = existing ? existing.name : null;
  }

  const record = { name, default_due_rule };
  if (editingCategoryId) record.id = editingCategoryId;
  await DB.put(STORES.categories, record);

  // if renamed, cascade the new name onto task types that referenced the old one
  if (oldName && oldName !== name) {
    const tasks = await loadTaskTypes();
    for (const t of tasks) {
      if (t.category === oldName) {
        t.category = name;
        await DB.put(STORES.taskTypes, t);
      }
    }
  }

  closeCategoryModal();
  await renderCategoryEditor();
}

async function deleteCategoryFromModal() {
  if (!editingCategoryId) return;
  const categories = await loadCategories();
  const cat = categories.find((c) => c.id === editingCategoryId);
  const tasks = await loadTaskTypes();
  const inUse = tasks.some((t) => t.category === cat.name);
  if (inUse) {
    document.getElementById("categoryModalError").textContent =
      "Can't delete — task types still use this category. Reassign or delete them first.";
    return;
  }
  if (!confirm("Delete this category?")) return;
  await DB.delete(STORES.categories, editingCategoryId);
  closeCategoryModal();
  await renderCategoryEditor();
}

function initTaskCategoryEditors() {
  document.getElementById("manageTasksLink").addEventListener("click", async () => {
    showView("taskEditor");
    await renderTaskEditor();
  });
  document.getElementById("manageCategoriesLink").addEventListener("click", async () => {
    showView("categoryEditor");
    await renderCategoryEditor();
  });

  document.getElementById("addTaskBtn").addEventListener("click", () => openTaskModal(null));
  document.getElementById("cancelTaskModal").addEventListener("click", closeTaskModal);
  document.getElementById("saveTaskModal").addEventListener("click", saveTaskFromModal);
  document.getElementById("deleteTaskModal").addEventListener("click", deleteTaskFromModal);

  document.getElementById("addCategoryBtn").addEventListener("click", () => openCategoryModal(null));
  document.getElementById("cancelCategoryModal").addEventListener("click", closeCategoryModal);
  document.getElementById("saveCategoryModal").addEventListener("click", saveCategoryFromModal);
  document.getElementById("deleteCategoryModal").addEventListener("click", deleteCategoryFromModal);
}

/* ------------------------------------------------------------
   Profile — auditor/firm details for share/export screens
   ------------------------------------------------------------ */
let pendingLogoDataUrl = null;

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function initProfile() {
  const profile = await getProfile();
  document.getElementById("profileNameInput").value = profile.name || "";
  document.getElementById("profileFirmInput").value = profile.firm_name || "";
  document.getElementById("profilePhoneInput").value = profile.phone || "";
  document.getElementById("profileEmailInput").value = profile.email || "";
  pendingLogoDataUrl = profile.logo || null;

  const preview = document.getElementById("profileLogoPreview");
  if (pendingLogoDataUrl) {
    preview.src = pendingLogoDataUrl;
    preview.style.display = "block";
  }

  document.getElementById("profileLogoInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 1024 * 1024) {
      alert("Please choose an image smaller than 1MB.");
      e.target.value = "";
      return;
    }
    pendingLogoDataUrl = await fileToDataUrl(file);
    preview.src = pendingLogoDataUrl;
    preview.style.display = "block";
  });

  document.getElementById("saveProfileBtn").addEventListener("click", async () => {
    const profileData = {
      name: document.getElementById("profileNameInput").value.trim(),
      firm_name: document.getElementById("profileFirmInput").value.trim(),
      phone: document.getElementById("profilePhoneInput").value.trim(),
      email: document.getElementById("profileEmailInput").value.trim(),
      logo: pendingLogoDataUrl,
    };
    await setProfile(profileData);
    const msg = document.getElementById("profileSavedMsg");
    msg.textContent = "Profile saved";
    setTimeout(() => { msg.textContent = ""; }, 1800);
  });
}

/* ------------------------------------------------------------
   Stage 3 — Client Import (CSV template download + upload)
   ------------------------------------------------------------ */
const IMPORT_HEADERS = [
  "Client Name", "Category", "PAN", "GSTIN", "Priority", "Awaiting Client Data", "Notes",
];

function csvEscape(val) {
  const s = String(val ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadTemplate() {
  const exampleRow = ["Rajesh Traders", "GST, Income Tax", "ABCDE1234F", "33ABCDE1234F1Z5", "P2", "N", ""];
  const csv = [IMPORT_HEADERS, exampleRow].map((row) => row.map(csvEscape).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "client-import-template.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Minimal RFC4180-ish CSV parser: handles quoted fields, commas and
// newlines inside quotes, and escaped double-quotes ("").
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  // normalize line endings, strip BOM
  text = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function getCurrentFY() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1; // 1-12
  return m >= 4 ? `${y}-${String(y + 1).slice(-2)}` : `${y - 1}-${String(y).slice(-2)}`;
}

function getLastFY() {
  const cur = getCurrentFY();
  const startYear = parseInt(cur.split("-")[0], 10) - 1;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

async function assignTasksForClient(client, categoryNames, allTaskTypes, fy) {
  const existingClientTasks = await DB.getAll(STORES.clientTasks);
  let created = 0;
  for (const catName of categoryNames) {
    const matchingTasks = allTaskTypes.filter(
      (t) => t.category.trim().toLowerCase() === catName.trim().toLowerCase()
    );
    for (const task of matchingTasks) {
      const already = existingClientTasks.some(
        (ct) => ct.client_id === client.id && ct.task_id === task.id && ct.year === fy
      );
      if (already) continue;
      await DB.put(STORES.clientTasks, {
        client_id: client.id,
        task_id: task.id,
        year: fy,
        due_date: null,
        status: "pending",
        completed_date: null,
      });
      created++;
    }
  }
  return created;
}

async function importClientsFromCSV(file) {
  const summaryEl = document.getElementById("importSummary");
  summaryEl.textContent = "Importing...";

  const text = await file.text();
  const rows = parseCSV(text);
  if (rows.length < 2) {
    summaryEl.textContent = "No data rows found in the file.";
    return;
  }

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name) => header.indexOf(name.toLowerCase());
  const idxName = col("Client Name");
  const idxCategory = col("Category");
  const idxPAN = col("PAN");
  const idxGSTIN = col("GSTIN");
  const idxPriority = col("Priority");
  const idxAwaiting = col("Awaiting Client Data");
  const idxNotes = col("Notes");

  if (idxName === -1 || idxCategory === -1) {
    summaryEl.textContent = "File must include 'Client Name' and 'Category' columns matching the template.";
    return;
  }

  const [existingClients, allCategories, allTaskTypes] = await Promise.all([
    DB.getAll(STORES.clients),
    loadCategories(),
    loadTaskTypes(),
  ]);
  const knownCategoryNames = new Set(allCategories.map((c) => c.name.toLowerCase()));
  const fy = getCurrentFY();

  let createdCount = 0, updatedCount = 0, tasksCreated = 0;
  const unknownCategories = new Set();

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const name = (r[idxName] || "").trim();
    if (!name) continue;
    const categoryRaw = (r[idxCategory] || "").trim();
    const categoryNames = categoryRaw.split(",").map((c) => c.trim()).filter(Boolean);
    categoryNames.forEach((c) => { if (!knownCategoryNames.has(c.toLowerCase())) unknownCategories.add(c); });

    const priority = idxPriority !== -1 ? (r[idxPriority] || "").trim() : "";
    const awaitingRaw = idxAwaiting !== -1 ? (r[idxAwaiting] || "").trim().toUpperCase() : "N";

    const clientData = {
      name,
      category: categoryNames.join(", "),
      priority_level: priority || null,
      awaiting_data: awaitingRaw === "Y",
      pan: idxPAN !== -1 ? (r[idxPAN] || "").trim() : "",
      gstin: idxGSTIN !== -1 ? (r[idxGSTIN] || "").trim() : "",
      notes: idxNotes !== -1 ? (r[idxNotes] || "").trim() : "",
    };

    const existing = existingClients.find((c) => c.name.trim().toLowerCase() === name.toLowerCase());
    let client;
    if (existing) {
      client = { ...existing, ...clientData, id: existing.id };
      await DB.put(STORES.clients, client);
      updatedCount++;
    } else {
      const newId = await DB.put(STORES.clients, clientData);
      client = { ...clientData, id: newId };
      existingClients.push(client);
      createdCount++;
    }

    tasksCreated += await assignTasksForClient(client, categoryNames, allTaskTypes, fy);
  }

  let msg = `Imported: ${createdCount} new client${createdCount === 1 ? "" : "s"}, ${updatedCount} updated, ${tasksCreated} task${tasksCreated === 1 ? "" : "s"} assigned for FY ${fy}.`;
  if (unknownCategories.size > 0) {
    msg += ` Note: category not set up yet — ${[...unknownCategories].join(", ")} (add in Manage Categories, then re-upload).`;
  }
  summaryEl.textContent = msg;
}

function initClientImport() {
  document.getElementById("downloadTemplateBtn").addEventListener("click", downloadTemplate);
  document.getElementById("importFileInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      await importClientsFromCSV(file);
    } catch (err) {
      console.error("Import failed", err);
      document.getElementById("importSummary").textContent = "Import failed — check the file matches the template format.";
    }
    e.target.value = "";
  });
}

/* ------------------------------------------------------------
   Stage 4 — Clients tab: list, detail, tasks, subtasks
   ------------------------------------------------------------ */
let currentClientId = null;
let currentClientYear = null;
let currentClientTaskId = null;
let clientCategoryFilter = "all";
let clientStatusFilter = "all";
let editingSubtaskId = null;

async function loadClients() {
  const arr = await DB.getAll(STORES.clients);
  return arr.sort((a, b) => a.name.localeCompare(b.name));
}

async function renderClientCategoryFilters() {
  const categories = await loadCategories();
  const container = document.getElementById("clientCategoryFilters");
  let html = `<button class="chip ${clientCategoryFilter === "all" ? "active" : ""}" data-cat-filter="all">All Categories</button>`;
  categories.forEach((c) => {
    html += `<button class="chip ${clientCategoryFilter === c.name ? "active" : ""}" data-cat-filter="${escapeHtml(c.name)}">${escapeHtml(c.name)}</button>`;
  });
  container.innerHTML = html;
  container.querySelectorAll("[data-cat-filter]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      clientCategoryFilter = btn.dataset.catFilter;
      await renderClientCategoryFilters();
      await renderClientList();
    });
  });
}

async function renderClientList() {
  const [clients, allClientTasks] = await Promise.all([loadClients(), DB.getAll(STORES.clientTasks)]);
  const fy = getCurrentFY();
  const searchText = document.getElementById("clientSearchInput").value.trim().toLowerCase();
  const container = document.getElementById("clientListContainer");

  const rows = clients
    .filter((c) => {
      if (searchText && !c.name.toLowerCase().includes(searchText)) return false;
      if (clientCategoryFilter !== "all") {
        const cats = (c.category || "").split(",").map((s) => s.trim().toLowerCase());
        if (!cats.includes(clientCategoryFilter.toLowerCase())) return false;
      }
      return true;
    })
    .map((c) => {
      const tasksForYear = allClientTasks.filter((ct) => ct.client_id === c.id && ct.year === fy);
      const total = tasksForYear.length;
      const completed = tasksForYear.filter((ct) => ct.status === "completed").length;
      return { client: c, total, completed };
    })
    .filter(({ total, completed }) => {
      if (clientStatusFilter === "pending") return total === 0 || completed < total;
      if (clientStatusFilter === "completed") return total > 0 && completed === total;
      return true;
    });

  if (rows.length === 0) {
    container.innerHTML = `<div class="empty-state">${
      clients.length === 0
        ? "No clients yet. Import them from Settings \u2192 Client Import."
        : "No clients match your search/filters."
    }</div>`;
    return;
  }

  container.innerHTML = rows
    .map(({ client, total, completed }) => {
      const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
      const cats = (client.category || "").split(",").map((s) => s.trim()).filter(Boolean);
      const badges = cats.map((c) => `<span class="badge">${escapeHtml(c)}</span>`).join("");
      const prio = client.priority_level ? `<span class="badge onetime">${escapeHtml(client.priority_level)}</span>` : "";
      const awaitBadge = client.awaiting_data
        ? `<span class="badge" style="color:var(--bad);">Awaiting Data</span>`
        : "";
      return `
        <div class="list-row clickable-row" data-client-id="${client.id}">
          <div class="list-row-main">
            <div class="list-row-title">${escapeHtml(client.name)}</div>
            <div class="list-row-sub">${badges}${prio}${awaitBadge}</div>
            <div class="list-row-sub" style="margin-top:6px;">${
              total > 0 ? `${completed}/${total} done (FY ${fy})` : "No tasks assigned"
            }</div>
            <div class="mini-progress"><div class="mini-progress-fill" style="width:${pct}%;"></div></div>
          </div>
        </div>`;
    })
    .join("");

  container.querySelectorAll("[data-client-id]").forEach((row) => {
    row.addEventListener("click", () => openClientDetail(Number(row.dataset.clientId)));
  });
}

function openClientDetail(id) {
  currentClientId = id;
  currentClientYear = getCurrentFY();
  showView("clientDetail", true);
  renderClientDetail();
}

async function renderClientDetail() {
  const client = await DB.get(STORES.clients, currentClientId);
  if (!client) {
    showView("clients", false);
    await renderClientList();
    return;
  }
  document.getElementById("viewTitle").textContent = client.name;

  const cats = (client.category || "").split(",").map((s) => s.trim()).filter(Boolean);
  const badges = cats.map((c) => `<span class="badge">${escapeHtml(c)}</span>`).join("");
  const extra = [];
  if (client.pan) extra.push(`PAN: ${escapeHtml(client.pan)}`);
  if (client.gstin) extra.push(`GSTIN: ${escapeHtml(client.gstin)}`);
  document.getElementById("clientDetailHeader").innerHTML = `
    <div class="name">${escapeHtml(client.name)}</div>
    <div style="margin-top:6px;">${badges}</div>
    ${extra.length ? `<div class="sub">${extra.join(" &middot; ")}</div>` : ""}
  `;

  const priorities = ["P1", "P2", "P3", "P4"];
  const priorityHtml = priorities
    .map((p) => `<button class="priority-chip ${client.priority_level === p ? "active" : ""}" data-priority="${p}">${p}</button>`)
    .join("");
  const awaitHtml = `<button class="awaiting-chip ${client.awaiting_data ? "active" : ""}" id="awaitingChipBtn">Awaiting Client Data</button>`;
  document.getElementById("clientPriorityRow").innerHTML = priorityHtml + awaitHtml;

  document.querySelectorAll("#clientPriorityRow [data-priority]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const p = btn.dataset.priority;
      client.priority_level = client.priority_level === p ? null : p;
      await DB.put(STORES.clients, client);
      renderClientDetail();
    });
  });
  document.getElementById("awaitingChipBtn").addEventListener("click", async () => {
    client.awaiting_data = !client.awaiting_data;
    await DB.put(STORES.clients, client);
    renderClientDetail();
  });

  const curFY = getCurrentFY();
  const lastFY = getLastFY();
  if (!currentClientYear) currentClientYear = curFY;
  document.getElementById("clientYearTabs").innerHTML = `
    <button class="year-tab ${currentClientYear === curFY ? "active" : ""}" data-year="${curFY}">FY ${curFY}</button>
    <button class="year-tab ${currentClientYear === lastFY ? "active" : ""}" data-year="${lastFY}">FY ${lastFY}</button>
  `;
  document.querySelectorAll("#clientYearTabs [data-year]").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentClientYear = btn.dataset.year;
      renderClientDetail();
    });
  });

  await renderClientDetailTasks(client);
}

async function renderClientDetailTasks(client) {
  const [clientTasks, taskTypes] = await Promise.all([DB.getAll(STORES.clientTasks), loadTaskTypes()]);
  const forYear = clientTasks.filter((ct) => ct.client_id === client.id && ct.year === currentClientYear);
  const container = document.getElementById("clientDetailTasks");

  if (forYear.length === 0) {
    container.innerHTML = `<div class="empty-state">No tasks for FY ${escapeHtml(currentClientYear)}.</div>`;
    return;
  }

  const rows = forYear
    .map((ct) => ({ ct, tt: taskTypes.find((t) => t.id === ct.task_id) }))
    .filter((r) => r.tt)
    .sort((a, b) => {
      const aDone = a.ct.status === "completed", bDone = b.ct.status === "completed";
      if (aDone !== bDone) return aDone ? 1 : -1;
      return a.tt.name.localeCompare(b.tt.name);
    });

  container.innerHTML = rows
    .map(({ ct, tt }) => {
      const bits = [];
      if (tt.frequency) bits.push(tt.frequency);
      if (tt.sub_type) bits.push(tt.sub_type);
      if (ct.due_date) bits.push("Due " + ct.due_date);
      const done = ct.status === "completed";
      return `
        <div class="task-card">
          <div class="task-card-main clickable-row" data-open-task="${ct.id}">
            <div class="task-card-title">${escapeHtml(tt.name)}${tt.one_time ? ' <span class="badge onetime">One-time</span>' : ""}</div>
            <div class="task-card-sub">${escapeHtml(bits.join(" \u00b7 "))}</div>
          </div>
          <button class="tick-btn ${done ? "done" : ""}" data-toggle-task="${ct.id}">&#10003;</button>
        </div>`;
    })
    .join("");

  container.querySelectorAll("[data-toggle-task]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await toggleClientTaskStatus(Number(btn.dataset.toggleTask));
      await renderClientDetailTasks(client);
    });
  });
  container.querySelectorAll("[data-open-task]").forEach((el) => {
    el.addEventListener("click", () => openClientTaskDetail(Number(el.dataset.openTask)));
  });
}

async function toggleClientTaskStatus(clientTaskId) {
  const ct = await DB.get(STORES.clientTasks, clientTaskId);
  if (!ct) return;
  if (ct.status === "completed") {
    ct.status = "pending";
    ct.completed_date = null;
  } else {
    ct.status = "completed";
    ct.completed_date = new Date().toISOString();
  }
  await DB.put(STORES.clientTasks, ct);
}

function openClientTaskDetail(clientTaskId) {
  currentClientTaskId = clientTaskId;
  showView("clientTaskDetail", true);
  renderClientTaskDetail();
}

async function renderClientTaskDetail() {
  const ct = await DB.get(STORES.clientTasks, currentClientTaskId);
  if (!ct) {
    showView("clients", false);
    await renderClientList();
    return;
  }
  const [tt, client] = await Promise.all([DB.get(STORES.taskTypes, ct.task_id), DB.get(STORES.clients, ct.client_id)]);
  document.getElementById("viewTitle").textContent = tt ? tt.name : "Task";

  const done = ct.status === "completed";
  document.getElementById("taskDetailHeader").innerHTML = `
    <div class="name">${escapeHtml(tt ? tt.name : "")}</div>
    <div class="sub">${escapeHtml(client ? client.name : "")} &middot; FY ${escapeHtml(ct.year)}</div>
    <div style="margin-top:14px; display:flex; align-items:center; gap:12px;">
      <button class="tick-btn ${done ? "done" : ""}" id="taskDetailTickBtn">&#10003;</button>
      <span style="font-size:.9em; color:var(--text-dim);">${done ? "Marked complete" : "Tap to mark complete"}</span>
    </div>
  `;
  document.getElementById("taskDetailTickBtn").addEventListener("click", async () => {
    await toggleClientTaskStatus(ct.id);
    renderClientTaskDetail();
  });

  const dueInput = document.getElementById("taskDueDateInput");
  dueInput.value = ct.due_date || "";
  dueInput.onchange = async (e) => {
    ct.due_date = e.target.value || null;
    await DB.put(STORES.clientTasks, ct);
  };

  await renderSubtasksList(ct.id);
}

async function renderSubtasksList(clientTaskId) {
  const all = await DB.getAll(STORES.subtasks);
  const subtasks = all
    .filter((s) => s.parent_task_id === clientTaskId)
    .sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""));
  const container = document.getElementById("taskDetailSubtasks");

  if (subtasks.length === 0) {
    container.innerHTML = `<div class="empty-state">No subtasks yet.</div>`;
  } else {
    container.innerHTML = subtasks
      .map((s) => {
        const done = s.status === "completed";
        return `
          <div class="subtask-row">
            <div class="task-card-main clickable-row" data-edit-subtask="${s.id}">
              <div class="task-card-title">${escapeHtml(s.name)}</div>
              <div class="task-card-sub">${s.due_date ? "Due " + escapeHtml(s.due_date) : "No due date"}</div>
            </div>
            <button class="tick-btn ${done ? "done" : ""}" data-toggle-subtask="${s.id}">&#10003;</button>
          </div>`;
      })
      .join("");
  }

  container.querySelectorAll("[data-toggle-subtask]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.toggleSubtask);
      const s = await DB.get(STORES.subtasks, id);
      s.status = s.status === "completed" ? "pending" : "completed";
      await DB.put(STORES.subtasks, s);
      await renderSubtasksList(clientTaskId);
    });
  });
  container.querySelectorAll("[data-edit-subtask]").forEach((el) => {
    el.addEventListener("click", async () => {
      const id = Number(el.dataset.editSubtask);
      const s = await DB.get(STORES.subtasks, id);
      openSubtaskModal(s);
    });
  });
}

function openSubtaskModal(subtask) {
  editingSubtaskId = subtask ? subtask.id : null;
  document.getElementById("subtaskModalTitle").textContent = subtask ? "Edit Subtask" : "Add Subtask";
  document.getElementById("subtaskModalError").textContent = "";
  document.getElementById("subtaskNameInput").value = subtask ? subtask.name : "";
  document.getElementById("subtaskDueDateInput").value = subtask ? subtask.due_date || "" : "";
  document.getElementById("deleteSubtaskModal").style.display = subtask ? "block" : "none";
  document.getElementById("subtaskModal").classList.remove("hidden");
}

function closeSubtaskModal() {
  document.getElementById("subtaskModal").classList.add("hidden");
  editingSubtaskId = null;
}

async function saveSubtaskFromModal() {
  const name = document.getElementById("subtaskNameInput").value.trim();
  const due_date = document.getElementById("subtaskDueDateInput").value || null;
  if (!name) {
    document.getElementById("subtaskModalError").textContent = "Subtask name is required";
    return;
  }
  const parentClientTask = await DB.get(STORES.clientTasks, currentClientTaskId);
  const record = {
    name,
    due_date,
    parent_task_id: currentClientTaskId,
    client_id: parentClientTask.client_id,
    status: "pending",
  };
  if (editingSubtaskId) {
    const existing = await DB.get(STORES.subtasks, editingSubtaskId);
    record.id = editingSubtaskId;
    record.status = existing.status;
  }
  await DB.put(STORES.subtasks, record);
  closeSubtaskModal();
  await renderSubtasksList(currentClientTaskId);
}

async function deleteSubtaskFromModal() {
  if (!editingSubtaskId) return;
  if (!confirm("Delete this subtask?")) return;
  await DB.delete(STORES.subtasks, editingSubtaskId);
  closeSubtaskModal();
  await renderSubtasksList(currentClientTaskId);
}

function initClientsTab() {
  document.getElementById("clientSearchInput").addEventListener("input", renderClientList);
  document.querySelectorAll("#clientStatusFilters [data-status-filter]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      document.querySelectorAll("#clientStatusFilters .chip").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      clientStatusFilter = btn.dataset.statusFilter;
      await renderClientList();
    });
  });

  document.getElementById("addSubtaskBtn").addEventListener("click", () => openSubtaskModal(null));
  document.getElementById("cancelSubtaskModal").addEventListener("click", closeSubtaskModal);
  document.getElementById("saveSubtaskModal").addEventListener("click", saveSubtaskFromModal);
  document.getElementById("deleteSubtaskModal").addEventListener("click", deleteSubtaskFromModal);
}

/* ------------------------------------------------------------
   Stage 5 — Tasks tab: cross-client view, bulk complete, assign
   ------------------------------------------------------------ */
let currentTaskTypeId = null;
let taskClientYear = null;
let taskSelectMode = false;
let taskSelectedIds = new Set();

async function renderTaskTypeGroups() {
  const [taskTypes, categories, clientTasks] = await Promise.all([
    loadTaskTypes(), loadCategories(), DB.getAll(STORES.clientTasks),
  ]);
  const searchText = document.getElementById("taskSearchInput").value.trim().toLowerCase();
  const fy = getCurrentFY();
  const container = document.getElementById("taskTypeGroups");

  const filtered = taskTypes.filter((t) => !searchText || t.name.toLowerCase().includes(searchText));
  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state">No task types match.</div>`;
    return;
  }

  const byCategory = {};
  filtered.forEach((t) => {
    const cat = t.category || "Uncategorized";
    (byCategory[cat] = byCategory[cat] || []).push(t);
  });
  const orderedCats = [
    ...categories.map((c) => c.name).filter((n) => byCategory[n]),
    ...Object.keys(byCategory).filter((n) => !categories.some((c) => c.name === n)),
  ];

  let html = "";
  orderedCats.forEach((catName) => {
    html += `<div class="group-header">${escapeHtml(catName)}</div>`;
    byCategory[catName].forEach((t) => {
      const forYear = clientTasks.filter((ct) => ct.task_id === t.id && ct.year === fy);
      const total = forYear.length;
      const completed = forYear.filter((ct) => ct.status === "completed").length;
      const bits = [];
      if (t.frequency) bits.push(t.frequency);
      if (t.sub_type) bits.push(t.sub_type);
      html += `
        <div class="list-row clickable-row" data-task-type-id="${t.id}">
          <div class="list-row-main">
            <div class="list-row-title">${escapeHtml(t.name)}${t.one_time ? ' <span class="badge onetime">One-time</span>' : ""}</div>
            <div class="list-row-sub">${bits.map((b) => `<span class="badge">${escapeHtml(b)}</span>`).join("")}</div>
            <div class="list-row-sub" style="margin-top:6px;">${
              total > 0 ? `${completed}/${total} done (FY ${fy})` : "No clients assigned yet"
            }</div>
          </div>
        </div>`;
    });
  });
  container.innerHTML = html;
  container.querySelectorAll("[data-task-type-id]").forEach((row) => {
    row.addEventListener("click", () => openTaskClientList(Number(row.dataset.taskTypeId)));
  });
}

function openTaskClientList(taskTypeId) {
  currentTaskTypeId = taskTypeId;
  taskClientYear = getCurrentFY();
  taskSelectMode = false;
  taskSelectedIds = new Set();
  showView("taskClients", true);
  renderTaskClientList();
}

async function renderTaskClientList() {
  const tt = await DB.get(STORES.taskTypes, currentTaskTypeId);
  if (!tt) {
    showView("tasks", false);
    await renderTaskTypeGroups();
    return;
  }
  document.getElementById("viewTitle").textContent = tt.name;

  document.getElementById("taskClientsHeader").innerHTML = `
    <div class="name">${escapeHtml(tt.name)}</div>
    <div class="sub">${escapeHtml(tt.category)}${tt.frequency ? " &middot; " + escapeHtml(tt.frequency) : ""}</div>
  `;

  const curFY = getCurrentFY();
  const lastFY = getLastFY();
  if (!taskClientYear) taskClientYear = curFY;
  document.getElementById("taskClientsYearTabs").innerHTML = `
    <button class="year-tab ${taskClientYear === curFY ? "active" : ""}" data-year="${curFY}">FY ${curFY}</button>
    <button class="year-tab ${taskClientYear === lastFY ? "active" : ""}" data-year="${lastFY}">FY ${lastFY}</button>
  `;
  document.querySelectorAll("#taskClientsYearTabs [data-year]").forEach((btn) => {
    btn.addEventListener("click", () => {
      taskClientYear = btn.dataset.year;
      taskSelectMode = false;
      taskSelectedIds = new Set();
      renderTaskClientList();
    });
  });

  const selectBtn = document.getElementById("toggleSelectModeBtn");
  selectBtn.textContent = taskSelectMode ? "Cancel Select" : "Select Multiple";
  selectBtn.onclick = () => {
    taskSelectMode = !taskSelectMode;
    taskSelectedIds = new Set();
    renderTaskClientListRows();
    updateBulkBar();
  };
  document.getElementById("assignMoreClientsBtn").onclick = openAssignClientsModal;

  await renderTaskClientListRows();
  updateBulkBar();
}

async function renderTaskClientListRows() {
  const [clientTasks, clients] = await Promise.all([DB.getAll(STORES.clientTasks), loadClients()]);
  const rows = clientTasks
    .filter((ct) => ct.task_id === currentTaskTypeId && ct.year === taskClientYear)
    .map((ct) => ({ ct, client: clients.find((c) => c.id === ct.client_id) }))
    .filter((r) => r.client)
    .sort((a, b) => {
      const aDone = a.ct.status === "completed", bDone = b.ct.status === "completed";
      if (aDone !== bDone) return aDone ? 1 : -1;
      return a.client.name.localeCompare(b.client.name);
    });

  const container = document.getElementById("taskClientsList");
  if (rows.length === 0) {
    container.innerHTML = `<div class="empty-state">No clients have this task for FY ${escapeHtml(taskClientYear)} yet. Use "+ Assign Clients" to add some.</div>`;
    return;
  }

  container.innerHTML = rows
    .map(({ ct, client }) => {
      const done = ct.status === "completed";
      const checkbox = taskSelectMode
        ? `<input type="checkbox" class="task-select-checkbox" data-ct-id="${ct.id}" ${taskSelectedIds.has(ct.id) ? "checked" : ""}>`
        : "";
      return `
        <div class="task-card">
          ${checkbox}
          <div class="task-card-main">
            <div class="task-card-title">${escapeHtml(client.name)}</div>
            <div class="task-card-sub">${ct.due_date ? "Due " + escapeHtml(ct.due_date) : "No due date"}</div>
          </div>
          <button class="tick-btn ${done ? "done" : ""}" data-toggle-ct="${ct.id}">&#10003;</button>
        </div>`;
    })
    .join("");

  container.querySelectorAll("[data-toggle-ct]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await toggleClientTaskStatus(Number(btn.dataset.toggleCt));
      await renderTaskClientListRows();
    });
  });
  container.querySelectorAll(".task-select-checkbox").forEach((cb) => {
    cb.addEventListener("change", () => {
      const id = Number(cb.dataset.ctId);
      if (cb.checked) taskSelectedIds.add(id);
      else taskSelectedIds.delete(id);
      updateBulkBar();
    });
  });
}

function updateBulkBar() {
  const btn = document.getElementById("bulkCompleteBtn");
  if (taskSelectMode && taskSelectedIds.size > 0) {
    btn.style.display = "block";
    btn.textContent = `Mark ${taskSelectedIds.size} Selected Complete`;
  } else {
    btn.style.display = "none";
  }
}

async function openAssignClientsModal() {
  const [clients, clientTasks] = await Promise.all([loadClients(), DB.getAll(STORES.clientTasks)]);
  const alreadyIds = new Set(
    clientTasks.filter((ct) => ct.task_id === currentTaskTypeId && ct.year === taskClientYear).map((ct) => ct.client_id)
  );
  const eligible = clients.filter((c) => !alreadyIds.has(c.id));
  const container = document.getElementById("assignClientsList");
  document.getElementById("assignClientsError").textContent = "";

  if (eligible.length === 0) {
    container.innerHTML = `<div class="empty-state">All clients already have this task for FY ${escapeHtml(taskClientYear)}.</div>`;
  } else {
    container.innerHTML = eligible
      .map(
        (c) => `
      <label class="checkbox-row">
        <input type="checkbox" class="assign-client-checkbox" value="${c.id}">
        <span>${escapeHtml(c.name)}</span>
      </label>`
      )
      .join("");
  }
  document.getElementById("assignClientsModal").classList.remove("hidden");
}

function closeAssignClientsModal() {
  document.getElementById("assignClientsModal").classList.add("hidden");
}

async function saveAssignClients() {
  const checked = Array.from(document.querySelectorAll(".assign-client-checkbox:checked")).map((cb) => Number(cb.value));
  if (checked.length === 0) {
    document.getElementById("assignClientsError").textContent = "Select at least one client";
    return;
  }
  for (const clientId of checked) {
    await DB.put(STORES.clientTasks, {
      client_id: clientId,
      task_id: currentTaskTypeId,
      year: taskClientYear,
      due_date: null,
      status: "pending",
      completed_date: null,
    });
  }
  closeAssignClientsModal();
  await renderTaskClientListRows();
}

function initTasksTab() {
  document.getElementById("taskSearchInput").addEventListener("input", renderTaskTypeGroups);

  document.getElementById("bulkCompleteBtn").addEventListener("click", async () => {
    for (const id of taskSelectedIds) {
      const ct = await DB.get(STORES.clientTasks, id);
      if (!ct) continue;
      ct.status = "completed";
      ct.completed_date = new Date().toISOString();
      await DB.put(STORES.clientTasks, ct);
    }
    taskSelectMode = false;
    taskSelectedIds = new Set();
    await renderTaskClientList();
  });

  document.getElementById("cancelAssignClients").addEventListener("click", closeAssignClientsModal);
  document.getElementById("saveAssignClients").addEventListener("click", saveAssignClients);
}

/* ------------------------------------------------------------
   Stage 6 — Priority tab: P1–P4, Awaiting Data, Unassigned
   ------------------------------------------------------------ */
const PRIORITY_LEVELS = ["P1", "P2", "P3", "P4"];

function priorityRowHtml(client, statsFn, showArrows) {
  const { total, completed } = statsFn(client);
  const cats = (client.category || "").split(",").map((s) => s.trim()).filter(Boolean);
  const badges = cats.map((c) => `<span class="badge">${escapeHtml(c)}</span>`).join("");
  const isP1 = client.priority_level === "P1";
  const isUnassigned = !client.priority_level;
  const arrowsHtml = showArrows
    ? `
      <div class="priority-arrows">
        <button class="priority-arrow-btn" data-promote="${client.id}" ${isP1 ? "disabled" : ""} title="Raise priority">&#9650;</button>
        <button class="priority-arrow-btn" data-demote="${client.id}" ${isUnassigned ? "disabled" : ""} title="Lower priority">&#9660;</button>
      </div>`
    : "";
  return `
    <div class="list-row">
      <div class="list-row-main clickable-row" data-open-client="${client.id}">
        <div class="list-row-title">${escapeHtml(client.name)}</div>
        <div class="list-row-sub">${badges}${client.awaiting_data ? '<span class="badge" style="color:var(--bad);">Awaiting Data</span>' : ""}</div>
        <div class="list-row-sub" style="margin-top:6px;">${
          total > 0 ? `${completed}/${total} done (FY ${getCurrentFY()})` : "No tasks assigned"
        }</div>
      </div>
      ${arrowsHtml}
    </div>`;
}

async function renderPriorityTab() {
  const [clients, clientTasks] = await Promise.all([loadClients(), DB.getAll(STORES.clientTasks)]);
  const fy = getCurrentFY();
  const container = document.getElementById("priorityGroups");

  const statsFn = (client) => {
    const forYear = clientTasks.filter((ct) => ct.client_id === client.id && ct.year === fy);
    const total = forYear.length;
    const completed = forYear.filter((ct) => ct.status === "completed").length;
    return { total, completed };
  };

  let html = "";

  PRIORITY_LEVELS.forEach((level) => {
    const group = clients.filter((c) => c.priority_level === level).sort((a, b) => a.name.localeCompare(b.name));
    html += `<div class="group-header">${level} (${group.length})</div>`;
    html += group.length
      ? group.map((c) => priorityRowHtml(c, statsFn, true)).join("")
      : `<div class="empty-state">No clients at ${level}.</div>`;
  });

  const awaitingClients = clients.filter((c) => c.awaiting_data).sort((a, b) => a.name.localeCompare(b.name));
  html += `<div class="group-header">Awaiting Client Data (${awaitingClients.length})</div>`;
  if (awaitingClients.length === 0) {
    html += `<div class="empty-state">No clients waiting on data.</div>`;
  } else {
    html += awaitingClients
      .map((c) => {
        const cats = (c.category || "").split(",").map((s) => s.trim()).filter(Boolean);
        const badges = cats.map((cc) => `<span class="badge">${escapeHtml(cc)}</span>`).join("");
        const prioBadge = c.priority_level ? `<span class="badge onetime">${escapeHtml(c.priority_level)}</span>` : "";
        return `
          <div class="list-row">
            <div class="list-row-main clickable-row" data-open-client="${c.id}">
              <div class="list-row-title">${escapeHtml(c.name)}</div>
              <div class="list-row-sub">${badges}${prioBadge}</div>
            </div>
            <button class="btn secondary" style="width:auto; padding:8px 12px; font-size:.8em;" data-clear-awaiting="${c.id}">Data Received</button>
          </div>`;
      })
      .join("");
  }

  const unassigned = clients.filter((c) => !c.priority_level).sort((a, b) => a.name.localeCompare(b.name));
  html += `
    <div class="group-header collapsible-header" id="unassignedToggle">
      <span>Unassigned (${unassigned.length})</span>
      <span id="unassignedChevron">&#8250;</span>
    </div>
    <div id="unassignedList" style="display:none;">
      ${unassigned.length ? unassigned.map((c) => priorityRowHtml(c, statsFn, true)).join("") : `<div class="empty-state">All clients have a priority set.</div>`}
    </div>
  `;

  container.innerHTML = html;

  container.querySelectorAll("[data-open-client]").forEach((el) => {
    el.addEventListener("click", () => openClientDetail(Number(el.dataset.openClient)));
  });
  container.querySelectorAll("[data-promote]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await changeClientPriority(Number(btn.dataset.promote), -1);
      await renderPriorityTab();
    });
  });
  container.querySelectorAll("[data-demote]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await changeClientPriority(Number(btn.dataset.demote), 1);
      await renderPriorityTab();
    });
  });
  container.querySelectorAll("[data-clear-awaiting]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const client = await DB.get(STORES.clients, Number(btn.dataset.clearAwaiting));
      client.awaiting_data = false;
      await DB.put(STORES.clients, client);
      await renderPriorityTab();
    });
  });

  const toggleBtn = document.getElementById("unassignedToggle");
  toggleBtn.addEventListener("click", () => {
    const list = document.getElementById("unassignedList");
    const chevron = document.getElementById("unassignedChevron");
    const isHidden = list.style.display === "none";
    list.style.display = isHidden ? "block" : "none";
    chevron.innerHTML = isHidden ? "&#9660;" : "&#8250;";
  });
}

async function changeClientPriority(clientId, direction) {
  // direction -1 = promote toward P1, +1 = demote toward unassigned
  const client = await DB.get(STORES.clients, clientId);
  if (!client) return;
  const idx = PRIORITY_LEVELS.indexOf(client.priority_level);

  if (direction === -1) {
    if (client.priority_level === null) client.priority_level = "P4";
    else if (idx > 0) client.priority_level = PRIORITY_LEVELS[idx - 1];
  } else {
    if (idx === -1) {
      // already unassigned — nothing lower to go to
    } else if (idx < PRIORITY_LEVELS.length - 1) {
      client.priority_level = PRIORITY_LEVELS[idx + 1];
    } else {
      client.priority_level = null;
    }
  }
  await DB.put(STORES.clients, client);
}

/* ------------------------------------------------------------
   Manual Client CRUD (Add / Edit / Delete) + manually adding a
   task type to a single client
   ------------------------------------------------------------ */
let editingClientId = null;

async function populateClientCategoryCheckboxes(selectedCategories = []) {
  const categories = await loadCategories();
  const container = document.getElementById("clientCategoryCheckboxes");
  container.innerHTML = categories
    .map(
      (c) => `
    <label class="checkbox-row">
      <input type="checkbox" class="client-category-checkbox" value="${escapeHtml(c.name)}" ${
        selectedCategories.includes(c.name) ? "checked" : ""
      }>
      <span>${escapeHtml(c.name)}</span>
    </label>`
    )
    .join("");
}

function openClientModal(client) {
  editingClientId = client ? client.id : null;
  document.getElementById("clientModalTitle").textContent = client ? "Edit Client" : "Add Client";
  document.getElementById("clientModalError").textContent = "";
  document.getElementById("clientNameInput").value = client ? client.name : "";
  document.getElementById("clientPANInput").value = client ? client.pan || "" : "";
  document.getElementById("clientGSTINInput").value = client ? client.gstin || "" : "";
  document.getElementById("clientPriorityInput").value = client ? client.priority_level || "" : "";
  document.getElementById("clientAwaitingInput").checked = client ? !!client.awaiting_data : false;
  document.getElementById("clientNotesInput").value = client ? client.notes || "" : "";
  document.getElementById("deleteClientModal").style.display = client ? "block" : "none";

  const selectedCats = client ? (client.category || "").split(",").map((s) => s.trim()).filter(Boolean) : [];
  populateClientCategoryCheckboxes(selectedCats);

  document.getElementById("clientModal").classList.remove("hidden");
}

function closeClientModal() {
  document.getElementById("clientModal").classList.add("hidden");
  editingClientId = null;
}

async function saveClientFromModal() {
  const name = document.getElementById("clientNameInput").value.trim();
  if (!name) {
    document.getElementById("clientModalError").textContent = "Client name is required";
    return;
  }

  const selectedCategories = Array.from(document.querySelectorAll(".client-category-checkbox:checked")).map((cb) => cb.value);
  const pan = document.getElementById("clientPANInput").value.trim();
  const gstin = document.getElementById("clientGSTINInput").value.trim();
  const priority_level = document.getElementById("clientPriorityInput").value || null;
  const awaiting_data = document.getElementById("clientAwaitingInput").checked;
  const notes = document.getElementById("clientNotesInput").value.trim();

  const existingClients = await loadClients();
  const clash = existingClients.find(
    (c) => c.name.trim().toLowerCase() === name.toLowerCase() && c.id !== editingClientId
  );
  if (clash) {
    document.getElementById("clientModalError").textContent = "A client with this name already exists";
    return;
  }

  const record = { name, category: selectedCategories.join(", "), pan, gstin, priority_level, awaiting_data, notes };
  if (editingClientId) record.id = editingClientId;
  await DB.put(STORES.clients, record);
  const savedClient = record; // DB.put fills in record.id in place

  // Assign default tasks for any selected categories (idempotent — skips ones
  // the client already has). Unchecking a category never removes existing
  // tasks, so nothing is lost by accident.
  if (selectedCategories.length > 0) {
    const allTaskTypes = await loadTaskTypes();
    await assignTasksForClient(savedClient, selectedCategories, allTaskTypes, getCurrentFY());
  }

  closeClientModal();

  if (document.getElementById("view-clients").classList.contains("active")) {
    await renderClientCategoryFilters();
    await renderClientList();
  }
  if (currentClientId === savedClient.id && document.getElementById("view-clientDetail").classList.contains("active")) {
    await renderClientDetail();
  }
}

async function deleteClientFromModal() {
  if (!editingClientId) return;
  if (!confirm("Delete this client? This also removes all their tasks and subtasks. This cannot be undone.")) return;

  const allClientTasks = await DB.getAll(STORES.clientTasks);
  const allSubtasks = await DB.getAll(STORES.subtasks);
  const toDelete = allClientTasks.filter((ct) => ct.client_id === editingClientId);
  for (const ct of toDelete) {
    const subs = allSubtasks.filter((s) => s.parent_task_id === ct.id);
    for (const s of subs) await DB.delete(STORES.subtasks, s.id);
    await DB.delete(STORES.clientTasks, ct.id);
  }
  await DB.delete(STORES.clients, editingClientId);

  closeClientModal();
  currentClientId = null;
  navHistory = ["dashboard", "clients"];
  showView("clients", false);
  await renderClientCategoryFilters();
  await renderClientList();
}

async function openAddTaskToClientModal() {
  const [allTaskTypes, clientTasks] = await Promise.all([loadTaskTypes(), DB.getAll(STORES.clientTasks)]);
  const alreadyIds = new Set(
    clientTasks.filter((ct) => ct.client_id === currentClientId && ct.year === currentClientYear).map((ct) => ct.task_id)
  );
  const eligible = allTaskTypes.filter((t) => !alreadyIds.has(t.id));
  const container = document.getElementById("addTaskToClientList");
  document.getElementById("addTaskToClientError").textContent = "";

  if (eligible.length === 0) {
    container.innerHTML = `<div class="empty-state">This client already has every task type for FY ${escapeHtml(currentClientYear)}.</div>`;
  } else {
    container.innerHTML = eligible
      .map(
        (t) => `
      <label class="checkbox-row">
        <input type="checkbox" class="add-task-checkbox" value="${t.id}">
        <span>${escapeHtml(t.name)} <span style="color:var(--text-dim); font-size:.85em;">(${escapeHtml(t.category)})</span></span>
      </label>`
      )
      .join("");
  }
  document.getElementById("addTaskToClientModal").classList.remove("hidden");
}

function closeAddTaskToClientModal() {
  document.getElementById("addTaskToClientModal").classList.add("hidden");
}

async function saveAddTaskToClient() {
  const checked = Array.from(document.querySelectorAll(".add-task-checkbox:checked")).map((cb) => Number(cb.value));
  if (checked.length === 0) {
    document.getElementById("addTaskToClientError").textContent = "Select at least one task";
    return;
  }
  for (const taskId of checked) {
    await DB.put(STORES.clientTasks, {
      client_id: currentClientId,
      task_id: taskId,
      year: currentClientYear,
      due_date: null,
      status: "pending",
      completed_date: null,
    });
  }
  closeAddTaskToClientModal();
  const client = await DB.get(STORES.clients, currentClientId);
  await renderClientDetailTasks(client);
}

function initClientCrud() {
  document.getElementById("addClientBtn").addEventListener("click", () => openClientModal(null));
  document.getElementById("cancelClientModal").addEventListener("click", closeClientModal);
  document.getElementById("saveClientModal").addEventListener("click", saveClientFromModal);
  document.getElementById("deleteClientModal").addEventListener("click", deleteClientFromModal);

  document.getElementById("editClientBtn").addEventListener("click", async () => {
    const client = await DB.get(STORES.clients, currentClientId);
    if (client) openClientModal(client);
  });

  document.getElementById("addTaskToClientBtn").addEventListener("click", openAddTaskToClientModal);
  document.getElementById("cancelAddTaskToClient").addEventListener("click", closeAddTaskToClientModal);
  document.getElementById("saveAddTaskToClient").addEventListener("click", saveAddTaskToClient);
}

/* ------------------------------------------------------------
   Boot
   ------------------------------------------------------------ */
async function boot() {
  await seedIfNeeded();
  initNav();
  initLockScreen();
  initChangePinModal();
  initTaskCategoryEditors();
  initClientImport();
  initClientsTab();
  initClientCrud();
  initTasksTab();
  await initSettings();
  await initProfile();
  await showLockScreenIfNeeded();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW registration failed", e));
  }
}

document.addEventListener("DOMContentLoaded", boot);
