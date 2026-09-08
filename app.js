"use strict";

// Public build intentionally starts with zero tasks.
const DEFAULT_TASKS = [];

// Permanent storage contract. Keep these names unchanged in future releases.
const KEY = "task_dashboard_master_v1";
const MIGRATION_FLAG = "task_dashboard_master_migrated_v1";
const DB_NAME = "TaskDashboardMasterDB";
const DB_VERSION = 1;
const DB_STORE = "appState";

// Known storage used by older versions of this project.
const LEGACY_KEYS = [
  "task_dashboard_v1",
  "task_dashboard_sep7_v2",
  "task_dashboard_sep7_smart_v1"
];
const LEGACY_DATABASES = [
  { name: "TaskDashboardDB", store: "appState", key: "main" }
];

const COMPLETED_VISIBLE_MS = 24 * 60 * 60 * 1000;
const PREFERRED_CATEGORIES = [
  "Personal",
  "School",
  "Work",
  "Health",
  "Errands",
  "Projects",
  "Finance",
  "Other"
];
const CUSTOM_VALUE = "__custom__";
const VIEWS = [
  ["today", "Today"],
  ["priority", "Priority"],
  ["shortest", "Shortest"],
  ["easiest", "Easiest"],
  ["all", "All"],
  ["topic", "Topic"],
  ["completed", "Completed"]
];

let state = loadInitialState();
let currentView = "priority";
let showRecentCompleted = true;
let editingId = null;
let selectedTopic = "all";
let lastDayKey = dayKey(new Date());
let migrationMessage = "";

const $ = id => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function safeTimestamp(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function extractState(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) return { tasks: raw, customCategories: [] };
  if (raw && Array.isArray(raw.tasks)) return raw;
  return null;
}

function normalizeTask(task) {
  const now = Date.now();
  const result = { ...task };
  result.id = String(result.id || `t${now}-${Math.random().toString(36).slice(2, 8)}`);
  result.title = String(result.title || "").trim();
  result.priority = clampNumber(result.priority, 0, 3, 2);
  result.minutes = clampNumber(result.minutes, 1, 1440, 10);
  result.difficulty = clampNumber(result.difficulty, 0, 3, 1);
  result.category = String(result.category || "Other").trim() || "Other";
  result.due = String(result.due || "").trim();
  result.dueDate = String(result.dueDate || "").trim();
  result.dueTime = String(result.dueTime || "").trim();
  result.today = Boolean(result.today);
  result.done = Boolean(result.done);
  result.focus = Boolean(result.focus);
  result.createdAt = safeTimestamp(result.createdAt) ||
    safeTimestamp(result.createdDate ? Date.parse(result.createdDate) : 0) || now;
  result.updatedAt = safeTimestamp(result.updatedAt) || result.createdAt;

  if (result.done) {
    result.completedAt = safeTimestamp(result.completedAt) || result.updatedAt || now;
    result.focus = false;
  } else {
    delete result.completedAt;
  }

  return result;
}

function taskFreshness(task, fallbackRank = 0) {
  return Math.max(
    safeTimestamp(task.updatedAt),
    safeTimestamp(task.completedAt),
    safeTimestamp(task.createdAt),
    fallbackRank
  );
}

function mergeTaskRecords(existing, incoming, existingRank = 0, incomingRank = 0) {
  if (!existing) return normalizeTask(incoming);
  if (!incoming) return normalizeTask(existing);

  const a = normalizeTask(existing);
  const b = normalizeTask(incoming);
  const aFresh = taskFreshness(a, existingRank);
  const bFresh = taskFreshness(b, incomingRank);
  const newer = bFresh >= aFresh ? b : a;
  const older = bFresh >= aFresh ? a : b;
  const merged = { ...older, ...newer };

  for (const key of ["dueDate", "dueTime", "due", "category", "createdAt"]) {
    if ((merged[key] === undefined || merged[key] === null || merged[key] === "") && older[key]) {
      merged[key] = older[key];
    }
  }

  if (merged.done) {
    merged.completedAt = Math.max(
      safeTimestamp(a.completedAt),
      safeTimestamp(b.completedAt),
      safeTimestamp(merged.updatedAt)
    ) || Date.now();
  } else {
    delete merged.completedAt;
  }

  merged.updatedAt = Math.max(aFresh, bFresh, safeTimestamp(merged.updatedAt));
  return normalizeTask(merged);
}

function mergeStates(sourceObjects) {
  const records = [];
  const byId = new Map();
  const byTitle = new Map();
  const customCategories = new Map();
  let mergedCount = 0;

  function addTask(task, rank) {
    if (!task || !String(task.title || "").trim()) return;
    const normalized = normalizeTask(task);
    const idKey = normalized.id;
    const titleKey = normalizeTitle(normalized.title);
    let record = byId.get(idKey) || byTitle.get(titleKey);

    if (record) {
      record.task = mergeTaskRecords(record.task, normalized, record.rank, rank);
      record.rank = Math.max(record.rank, rank);
      mergedCount += 1;
    } else {
      record = { task: normalized, rank };
      records.push(record);
    }

    byId.set(record.task.id, record);
    byTitle.set(normalizeTitle(record.task.title), record);
  }

  sourceObjects.forEach((source, index) => {
    const parsed = extractState(source.state);
    if (!parsed) return;
    const rank = (index + 1) * 1e13 + safeTimestamp(parsed._savedAt);

    for (const category of Array.isArray(parsed.customCategories) ? parsed.customCategories : []) {
      const clean = String(category || "").trim();
      if (clean) customCategories.set(clean.toLowerCase(), clean);
    }

    for (const task of parsed.tasks) addTask(task, rank);
  });

  for (const task of DEFAULT_TASKS) addTask(task, 1);

  return {
    tasks: records.map(record => normalizeTask(record.task)),
    customCategories: [...customCategories.values()],
    _savedAt: Date.now(),
    _mergeCount: mergedCount
  };
}

function readLocalState(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return extractState(JSON.parse(raw));
  } catch (_) {
    return null;
  }
}

function collectLegacyLocalSources() {
  const sources = [];
  const seen = new Set();

  for (const key of LEGACY_KEYS) {
    const parsed = readLocalState(key);
    if (parsed) {
      sources.push({ name: key, state: parsed });
      seen.add(key);
    }
  }

  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key || key === KEY || key === MIGRATION_FLAG || seen.has(key)) continue;
      if (!/task[_-]?dashboard/i.test(key)) continue;
      const parsed = readLocalState(key);
      if (parsed) sources.push({ name: key, state: parsed });
    }
  } catch (_) {}

  return sources;
}

function loadInitialState() {
  const permanent = readLocalState(KEY);
  if (permanent) return mergeStates([{ name: "permanent", state: permanent }]);

  const legacy = collectLegacyLocalSources();
  if (legacy.length) {
    migrationMessage = `Recovered data from ${legacy.length} older browser storage source${legacy.length === 1 ? "" : "s"}.`;
    return mergeStates(legacy);
  }

  return mergeStates([]);
}

function openPermanentDB() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openExistingDB(name) {
  return new Promise(resolve => {
    if (!("indexedDB" in window)) {
      resolve(null);
      return;
    }
    const request = indexedDB.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

async function readPermanentDB() {
  try {
    const db = await openPermanentDB();
    const result = await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readonly");
      const request = tx.objectStore(DB_STORE).get("main");
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return extractState(result);
  } catch (_) {
    return null;
  }
}

async function readLegacyDB(source) {
  const db = await openExistingDB(source.name);
  if (!db) return null;
  try {
    if (!db.objectStoreNames.contains(source.store)) {
      db.close();
      return null;
    }
    const result = await new Promise(resolve => {
      const tx = db.transaction(source.store, "readonly");
      const request = tx.objectStore(source.store).get(source.key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
    db.close();
    return extractState(result);
  } catch (_) {
    db.close();
    return null;
  }
}

async function writePermanentDB(snapshot) {
  try {
    const db = await openPermanentDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put(snapshot, "main");
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (_) {}
}

function saveState() {
  state._savedAt = Date.now();
  const snapshot = JSON.parse(JSON.stringify(state));
  try {
    localStorage.setItem(KEY, JSON.stringify(snapshot));
    localStorage.setItem(MIGRATION_FLAG, "1");
  } catch (_) {}
  writePermanentDB(snapshot);
}

async function hydrateStorage() {
  const permanentLocal = readLocalState(KEY);
  const permanentDB = await readPermanentDB();

  if (permanentLocal || permanentDB) {
    const sources = [];
    if (permanentLocal) sources.push({ name: "permanent-local", state: permanentLocal });
    if (permanentDB) sources.push({ name: "permanent-db", state: permanentDB });
    sources.push({ name: "current-memory", state });
    state = mergeStates(sources);
    saveState();
    render();
    return;
  }

  const legacySources = collectLegacyLocalSources();
  for (const source of LEGACY_DATABASES) {
    const legacyState = await readLegacyDB(source);
    if (legacyState) legacySources.push({ name: `${source.name}/${source.store}`, state: legacyState });
  }

  if (legacySources.length) {
    legacySources.push({ name: "current-memory", state });
    state = mergeStates(legacySources);
    migrationMessage = `Recovered and merged ${legacySources.length - 1} older saved data source${legacySources.length - 1 === 1 ? "" : "s"}.`;
  }

  saveState();
  render();
}

function pad(number) {
  return String(number).padStart(2, "0");
}

function dayKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseLocalDate(dateValue, timeValue) {
  if (!dateValue) return null;
  const parts = dateValue.split("-").map(Number);
  if (parts.length !== 3 || parts.some(value => !Number.isFinite(value))) return null;
  let hours = 23;
  let minutes = 59;
  if (/^\d{2}:\d{2}$/.test(timeValue || "")) {
    [hours, minutes] = timeValue.split(":").map(Number);
  }
  return new Date(parts[0], parts[1] - 1, parts[2], hours, minutes, 59, 999);
}

function daysFromToday(task) {
  if (!task.dueDate) return null;
  const parts = task.dueDate.split("-").map(Number);
  if (parts.length !== 3 || parts.some(value => !Number.isFinite(value))) return null;
  const dueDay = new Date(parts[0], parts[1] - 1, parts[2]);
  return Math.round((dueDay - startOfDay(new Date())) / 86400000);
}

function isOverdue(task) {
  const due = parseLocalDate(task.dueDate, task.dueTime);
  return Boolean(due && !task.done && due < new Date());
}

function isDueToday(task) {
  return !task.done && task.dueDate === dayKey(new Date());
}

function isDueTomorrow(task) {
  return !task.done && daysFromToday(task) === 1;
}

function completionAgeMs(task) {
  if (!task.done || !task.completedAt) return Number.POSITIVE_INFINITY;
  return Math.max(0, Date.now() - Number(task.completedAt));
}

function isRecentDone(task) {
  return Boolean(task.done && task.completedAt && completionAgeMs(task) < COMPLETED_VISIBLE_MS);
}

function completedAgo(task) {
  if (!task.done || !task.completedAt) return "";
  const minutes = Math.floor(completionAgeMs(task) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function effectivePriority(task) {
  if (task.done) return 9;
  if (task.focus) return -2;
  if (isOverdue(task)) return -1;
  if (isDueToday(task)) return 0;
  if (isDueTomorrow(task)) return Math.min(1, task.priority);
  return task.priority;
}

function comparePriority(a, b) {
  const aDue = parseLocalDate(a.dueDate, a.dueTime)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const bDue = parseLocalDate(b.dueDate, b.dueTime)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  return effectivePriority(a) - effectivePriority(b) ||
    aDue - bDue ||
    a.minutes - b.minutes ||
    a.difficulty - b.difficulty ||
    a.title.localeCompare(b.title);
}

function isTodayEffective(task) {
  if (task.done) return false;
  if (isOverdue(task) || isDueToday(task)) return true;
  return Boolean(task.today && (!task.dueDate || task.dueDate >= dayKey(new Date())));
}

function isAutoHigh(task) {
  return !task.done && (task.focus || isOverdue(task) || isDueToday(task));
}

function pLabel(priority) {
  return ["P0 urgent", "P1 next", "P2 soon", "P3 flexible"][priority] || "P2 soon";
}

function dLabel(difficulty) {
  return ["Very easy", "Easy", "Medium", "Hard"][difficulty] || "Easy";
}

function formatDate(iso) {
  const parts = iso.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" })
    .format(new Date(parts[0], parts[1] - 1, parts[2]));
}

function formatTime(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })
    .format(new Date(2000, 0, 1, hours, minutes));
}

function dueBadge(task) {
  if (isOverdue(task)) return '<span class="badge overdue">Overdue</span>';
  const delta = daysFromToday(task);
  if (delta === 0) return `<span class="badge today">Today${task.dueTime ? ` ${formatTime(task.dueTime)}` : ""}</span>`;
  if (delta === 1) return `<span class="badge">Tomorrow${task.dueTime ? ` ${formatTime(task.dueTime)}` : ""}</span>`;
  if (delta !== null && delta > 1) return `<span class="badge">${formatDate(task.dueDate)}${task.dueTime ? ` ${formatTime(task.dueTime)}` : ""}</span>`;
  return task.due ? `<span class="badge">${escapeHtml(task.due)}</span>` : "";
}

function getAllCategories() {
  const fromTasks = state.tasks.map(task => String(task.category || "Other").trim()).filter(Boolean);
  const custom = Array.isArray(state.customCategories) ? state.customCategories : [];
  const set = new Set([...PREFERRED_CATEGORIES, ...fromTasks, ...custom]);
  const preferred = PREFERRED_CATEGORIES.filter(category => set.has(category));
  const extras = [...set].filter(category => !PREFERRED_CATEGORIES.includes(category)).sort((a, b) => a.localeCompare(b));
  return [...preferred, ...extras];
}

function registerCustomCategory(name) {
  const clean = String(name || "").trim().replace(/\s+/g, " ").slice(0, 40);
  if (!clean) return "";
  const existing = getAllCategories().find(category => category.toLowerCase() === clean.toLowerCase());
  const finalName = existing || clean;
  if (!Array.isArray(state.customCategories)) state.customCategories = [];
  if (!PREFERRED_CATEGORIES.includes(finalName) && !state.customCategories.some(category => category.toLowerCase() === finalName.toLowerCase())) {
    state.customCategories.push(finalName);
  }
  return finalName;
}

function refreshTopicOptions() {
  const select = $("topicFilter");
  const categories = getAllCategories();
  select.innerHTML = '<option value="all">All sections</option>' +
    categories.map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("");
  if (selectedTopic !== "all" && !categories.includes(selectedTopic)) selectedTopic = "all";
  select.value = selectedTopic;
}

function refreshCategorySelect(selected = "Other") {
  const select = $("fCategory");
  const categories = getAllCategories();
  select.innerHTML = categories.map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("") +
    `<option value="${CUSTOM_VALUE}">+ Custom section…</option>`;
  select.value = categories.includes(selected) ? selected : "Other";
  syncCustomCategoryField();
}

function syncCustomCategoryField() {
  const isCustom = $("fCategory").value === CUSTOM_VALUE;
  $("customCategoryWrap").hidden = !isCustom;
  if (!isCustom) $("fCustomCategory").value = "";
}

function sortedForView(tasks) {
  let result = [...tasks];
  if (currentView === "today") result = result.filter(isTodayEffective).sort(comparePriority);
  if (currentView === "priority") result.sort(comparePriority);
  if (currentView === "shortest") result.sort((a, b) => a.minutes - b.minutes || comparePriority(a, b));
  if (currentView === "easiest") result.sort((a, b) => a.difficulty - b.difficulty || a.minutes - b.minutes || comparePriority(a, b));
  if (currentView === "all") result.sort((a, b) => a.title.localeCompare(b.title));
  if (currentView === "topic") {
    if (selectedTopic !== "all") result = result.filter(task => task.category === selectedTopic);
    result.sort(comparePriority);
  }
  if (currentView === "completed") result = result.filter(task => task.done).sort((a, b) => b.completedAt - a.completedAt);
  return result;
}

function taskHtml(task) {
  return `<article class="task ${task.done ? "done" : ""} ${task.focus ? "focus" : ""} ${isOverdue(task) ? "overdue" : ""}">
    <input class="check" type="checkbox" ${task.done ? "checked" : ""} data-action="toggle" data-id="${escapeHtml(task.id)}" aria-label="Mark ${escapeHtml(task.title)} ${task.done ? "open" : "complete"}">
    <div>
      <div class="title">${escapeHtml(task.title)}</div>
      <div class="meta">
        ${task.focus ? '<span class="badge focus">High Priority</span>' : ""}
        <span class="badge p${task.priority}">${pLabel(task.priority)}</span>
        <span class="badge">${task.minutes} min</span>
        <span class="badge">${dLabel(task.difficulty)}</span>
        <span class="badge">${escapeHtml(task.category)}</span>
        ${dueBadge(task)}
        ${task.done ? `<span class="badge">${isRecentDone(task) ? "Completed" : "Archived"} ${completedAgo(task)}</span>` : ""}
      </div>
    </div>
    <div class="actions">
      ${task.focus && !task.done ? `<button class="icon" type="button" title="Remove from high priority" data-action="unfocus" data-id="${escapeHtml(task.id)}">↓</button>` : ""}
      <button class="icon" type="button" title="Edit" data-action="edit" data-id="${escapeHtml(task.id)}">✎</button>
      <button class="icon" type="button" title="Delete" data-action="delete" data-id="${escapeHtml(task.id)}">×</button>
    </div>
  </article>`;
}

function render() {
  const now = new Date();
  $("clockLine").textContent = `${new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(now)} • priorities update automatically`;

  const open = state.tasks.filter(task => !task.done);
  const done = state.tasks.filter(task => task.done);
  const recentDone = done.filter(isRecentDone);
  const archivedDone = done.filter(task => !isRecentDone(task));

  $("tabs").innerHTML = VIEWS.map(([id, label]) => {
    const visibleLabel = id === "completed" ? `Completed (${done.length})` : label;
    return `<button class="tab ${currentView === id ? "active" : ""}" type="button" data-view="${id}">${visibleLabel}</button>`;
  }).join("");

  refreshTopicOptions();
  $("topicFilterWrap").hidden = currentView !== "topic";

  const topicMatches = task => currentView !== "topic" || selectedTopic === "all" || task.category === selectedTopic;
  const focus = open.filter(isAutoHigh).filter(topicMatches).sort(comparePriority);
  let active = [];
  let recentForView = [];

  if (currentView === "completed") {
    active = [...done].sort((a, b) => b.completedAt - a.completedAt);
  } else {
    active = sortedForView(open.filter(task => !isAutoHigh(task)));
    recentForView = currentView === "topic" ? recentDone.filter(topicMatches) : recentDone;
  }

  $("focusPanel").hidden = currentView === "completed";
  $("recentCompletedPanel").hidden = currentView === "completed" || recentForView.length === 0;

  $("focusList").innerHTML = focus.length
    ? focus.map(taskHtml).join("")
    : '<div class="empty">No urgent items right now. Use “Move next 5 here” when you want a new focus batch.</div>';

  if (currentView === "completed") {
    $("activeList").innerHTML = active.length
      ? `<div class="archiveNote">${recentDone.length} completed in the last 24 hours • ${archivedDone.length} archived after 24 hours. Archived tasks stay stored here but disappear from the normal dashboard and recent-completion counter.</div>${active.map(taskHtml).join("")}`
      : '<div class="empty">No completed tasks yet.</div>';
  } else {
    $("activeList").innerHTML = active.length
      ? active.map(taskHtml).join("")
      : `<div class="empty">${currentView === "topic" && selectedTopic !== "all" ? `No open tasks in ${escapeHtml(selectedTopic)}.` : "Nothing here 🎉"}</div>`;
  }

  $("completedList").innerHTML = showRecentCompleted
    ? (recentForView.length ? [...recentForView].sort((a, b) => b.completedAt - a.completedAt).map(taskHtml).join("") : '<div class="empty">Nothing completed in the last 24 hours.</div>')
    : "";

  $("openCount").textContent = open.length;
  $("todayCount").textContent = open.filter(task => isOverdue(task) || isDueToday(task)).length;
  $("focusCount").textContent = focus.length;
  $("doneCount").textContent = recentDone.length;

  const currentTotal = open.length + recentDone.length;
  const percent = currentTotal ? Math.round((recentDone.length / currentTotal) * 100) : 0;
  $("progressText").textContent = `${percent}% • ${recentDone.length}/${currentTotal} current`;
  $("progressBar").style.width = `${percent}%`;

  const viewMeta = {
    today: ["Today", "Overdue + due-today + manually pinned"],
    priority: ["Priority", "Deadlines and time automatically move tasks up"],
    shortest: ["Shortest", "Fastest open tasks first"],
    easiest: ["Easiest", "Lowest-effort open tasks first"],
    all: ["All", "Alphabetical"],
    topic: [selectedTopic === "all" ? "Topic" : selectedTopic, selectedTopic === "all" ? "Choose a section from the dropdown" : `${selectedTopic} section • smart priority order`],
    completed: ["Completed archive", `${done.length} stored • normal dashboard hides them after 24 hours`]
  };
  $("viewTitle").textContent = viewMeta[currentView][0];
  $("viewHint").textContent = viewMeta[currentView][1];

  const candidates = open.filter(task => !isAutoHigh(task));
  $("nextFiveBtn").disabled = candidates.length === 0;
  $("nextFiveBtn").textContent = candidates.length ? `Move next ${Math.min(5, candidates.length)} here` : "No more tasks";

  if (migrationMessage) {
    $("migrationStatus").textContent = `Permanent storage active • ${migrationMessage}`;
    $("migrationStatus").hidden = false;
  } else {
    $("migrationStatus").hidden = true;
  }
}

function setView(view) {
  currentView = view;
  render();
}

function toggleDone(id) {
  const task = state.tasks.find(item => item.id === id);
  if (!task) return;
  task.done = !task.done;
  task.updatedAt = Date.now();
  if (task.done) {
    task.focus = false;
    task.completedAt = task.updatedAt;
  } else {
    delete task.completedAt;
  }
  saveState();
  render();
}

function removeFocus(id) {
  const task = state.tasks.find(item => item.id === id);
  if (!task) return;
  task.focus = false;
  task.updatedAt = Date.now();
  saveState();
  render();
}

function deleteTask(id) {
  const task = state.tasks.find(item => item.id === id);
  if (!task) return;
  if (!confirm(`Delete “${task.title}”?`)) return;
  state.tasks = state.tasks.filter(item => item.id !== id);
  saveState();
  render();
}

function moveNextFive() {
  const candidates = state.tasks
    .filter(task => !task.done && !isAutoHigh(task))
    .sort(comparePriority)
    .slice(0, 5);
  const stamp = Date.now();
  for (const task of candidates) {
    task.focus = true;
    task.updatedAt = stamp;
  }
  saveState();
  render();
}

function openAdd() {
  editingId = null;
  $("modalTitle").textContent = "Add task";
  $("fTitle").value = "";
  $("fPriority").value = "2";
  $("fMinutes").value = "10";
  $("fDifficulty").value = "1";
  refreshCategorySelect("Other");
  $("fCustomCategory").value = "";
  $("fDue").value = "";
  $("fDueDate").value = "";
  $("fDueTime").value = "";
  $("fToday").checked = false;
  $("modal").classList.add("open");
  $("modal").setAttribute("aria-hidden", "false");
  setTimeout(() => $("fTitle").focus(), 50);
}

function openEdit(id) {
  const task = state.tasks.find(item => item.id === id);
  if (!task) return;
  editingId = id;
  $("modalTitle").textContent = "Edit task";
  $("fTitle").value = task.title;
  $("fPriority").value = String(task.priority);
  $("fMinutes").value = String(task.minutes);
  $("fDifficulty").value = String(task.difficulty);
  refreshCategorySelect(task.category);
  $("fCustomCategory").value = "";
  $("fDue").value = task.due || "";
  $("fDueDate").value = task.dueDate || "";
  $("fDueTime").value = task.dueTime || "";
  $("fToday").checked = Boolean(task.today);
  $("modal").classList.add("open");
  $("modal").setAttribute("aria-hidden", "false");
}

function closeModal() {
  $("modal").classList.remove("open");
  $("modal").setAttribute("aria-hidden", "true");
}

function saveTask() {
  const title = $("fTitle").value.trim();
  if (!title) {
    alert("Add a task name.");
    $("fTitle").focus();
    return;
  }

  let category = $("fCategory").value;
  if (category === CUSTOM_VALUE) {
    category = registerCustomCategory($("fCustomCategory").value);
    if (!category) {
      alert("Enter a name for the new custom section.");
      $("fCustomCategory").focus();
      return;
    }
  }

  const stamp = Date.now();
  const data = {
    title,
    priority: clampNumber($("fPriority").value, 0, 3, 2),
    minutes: clampNumber($("fMinutes").value, 1, 1440, 10),
    difficulty: clampNumber($("fDifficulty").value, 0, 3, 1),
    category: category || "Other",
    due: $("fDue").value.trim(),
    dueDate: $("fDueDate").value,
    dueTime: $("fDueTime").value,
    today: $("fToday").checked,
    updatedAt: stamp
  };

  if (editingId) {
    const task = state.tasks.find(item => item.id === editingId);
    Object.assign(task, data);
  } else {
    state.tasks.push(normalizeTask({
      id: `t${stamp}`,
      ...data,
      createdAt: stamp,
      done: false,
      focus: false
    }));
  }

  saveState();
  selectedTopic = data.category;
  closeModal();
  render();
}

function exportTasks() {
  const payload = {
    tasks: state.tasks,
    customCategories: state.customCategories || [],
    exportedAt: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "task-dashboard-data.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function importTasksFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const incoming = extractState(parsed);
      if (!incoming) throw new Error("Invalid data");
      state = mergeStates([
        { name: "current", state },
        { name: "import", state: incoming }
      ]);
      migrationMessage = "Imported task data was merged without replacing the current list.";
      saveState();
      render();
    } catch (_) {
      alert("That JSON file is not valid task-dashboard data.");
    }
  };
  reader.readAsText(file);
}

$("tabs").addEventListener("click", event => {
  const button = event.target.closest("[data-view]");
  if (button) setView(button.dataset.view);
});

$("topicFilter").addEventListener("change", event => {
  selectedTopic = event.target.value;
  render();
});

$("fCategory").addEventListener("change", () => {
  syncCustomCategoryField();
  if ($("fCategory").value === CUSTOM_VALUE) setTimeout(() => $("fCustomCategory").focus(), 50);
});

for (const listId of ["activeList", "focusList", "completedList"]) {
  $(listId).addEventListener("click", event => {
    const control = event.target.closest("[data-action]");
    if (!control) return;
    const { action, id } = control.dataset;
    if (action === "edit") openEdit(id);
    if (action === "delete") deleteTask(id);
    if (action === "unfocus") removeFocus(id);
  });

  $(listId).addEventListener("change", event => {
    const control = event.target.closest('[data-action="toggle"]');
    if (control) toggleDone(control.dataset.id);
  });
}

$("fab").addEventListener("click", openAdd);
$("addTop").addEventListener("click", openAdd);
$("cancelBtn").addEventListener("click", closeModal);
$("saveBtn").addEventListener("click", saveTask);
$("nextFiveBtn").addEventListener("click", moveNextFive);
$("toggleCompleted").addEventListener("click", () => {
  showRecentCompleted = !showRecentCompleted;
  $("toggleCompleted").textContent = showRecentCompleted ? "Hide" : "Show";
  render();
});
$("exportBtn").addEventListener("click", exportTasks);
$("importBtn").addEventListener("click", () => $("importFile").click());
$("importFile").addEventListener("change", event => {
  const file = event.target.files && event.target.files[0];
  importTasksFile(file);
  event.target.value = "";
});
$("modal").addEventListener("click", event => {
  if (event.target === $("modal")) closeModal();
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && $("modal").classList.contains("open")) closeModal();
});

setInterval(() => {
  const currentDay = dayKey(new Date());
  if (currentDay !== lastDayKey) lastDayKey = currentDay;
  render();
}, 60000);

render();
hydrateStorage();
