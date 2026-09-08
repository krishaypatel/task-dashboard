"use strict";

const DEFAULT_TASKS = [];

// Permanent storage contract. Do not rename these in future releases.
const KEY = "task_dashboard_master_v1";
const DB_NAME = "TaskDashboardMasterDB";
const DB_VERSION = 1;
const DB_STORE = "appState";

const LEGACY_KEYS = [
  "task_dashboard_v1",
  "task_dashboard_sep7_v2",
  "task_dashboard_sep7_smart_v1"
];
const LEGACY_DATABASES = [
  { name: "TaskDashboardDB", store: "appState", key: "main" }
];

const COMPLETED_VISIBLE_MS = 24 * 60 * 60 * 1000;
const CUSTOM_VALUE = "__custom__";
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
const VIEWS = [
  ["today", "Today"],
  ["priority", "Priority"],
  ["shortest", "Shortest"],
  ["easiest", "Easiest"],
  ["all", "All"],
  ["topic", "Topic"],
  ["completed", "Completed"]
];

let migrationMessage = "";
let state = loadInitialState();
let currentView = "priority";
let showRecentCompleted = true;
let editingId = null;
let selectedTopic = "all";
let lastDayKey = dayKey(new Date());

const $ = id => document.getElementById(id);

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[ch]);
}

function clamp(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function ts(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function titleKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function extractState(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) return { tasks: raw, customCategories: [] };
  return Array.isArray(raw.tasks) ? raw : null;
}

function normalizeTask(input) {
  const now = Date.now();
  const task = { ...input };
  task.id = String(task.id || `t${now}-${Math.random().toString(36).slice(2, 8)}`);
  task.title = String(task.title || "").trim();
  task.priority = clamp(task.priority, 0, 3, 2);
  task.minutes = clamp(task.minutes, 1, 1440, 10);
  task.difficulty = clamp(task.difficulty, 0, 3, 1);
  task.category = String(task.category || "Other").trim() || "Other";
  task.due = String(task.due || "").trim();
  task.dueDate = String(task.dueDate || "").trim();
  task.dueTime = String(task.dueTime || "").trim();
  task.today = Boolean(task.today);
  task.done = Boolean(task.done);
  task.focus = Boolean(task.focus);
  task.createdAt = ts(task.createdAt) || ts(task.createdDate ? Date.parse(task.createdDate) : 0) || now;
  task.updatedAt = ts(task.updatedAt) || task.createdAt;
  if (task.done) {
    task.completedAt = ts(task.completedAt) || task.updatedAt || now;
    task.focus = false;
  } else {
    delete task.completedAt;
  }
  return task;
}

function freshness(task, fallback = 0) {
  return Math.max(ts(task.updatedAt), ts(task.completedAt), ts(task.createdAt), fallback);
}

function mergeTask(a, b, aRank = 0, bRank = 0) {
  if (!a) return normalizeTask(b);
  if (!b) return normalizeTask(a);
  a = normalizeTask(a);
  b = normalizeTask(b);
  const af = freshness(a, aRank);
  const bf = freshness(b, bRank);
  const newer = bf >= af ? b : a;
  const older = bf >= af ? a : b;
  const merged = { ...older, ...newer };
  for (const key of ["due", "dueDate", "dueTime", "category", "createdAt"]) {
    if ((merged[key] === undefined || merged[key] === null || merged[key] === "") && older[key]) merged[key] = older[key];
  }
  if (merged.done) merged.completedAt = Math.max(ts(a.completedAt), ts(b.completedAt), ts(merged.updatedAt)) || Date.now();
  else delete merged.completedAt;
  merged.updatedAt = Math.max(af, bf, ts(merged.updatedAt));
  return normalizeTask(merged);
}

function mergeStates(sources) {
  const records = [];
  const byId = new Map();
  const byTitle = new Map();
  const custom = new Map();

  const add = (rawTask, rank) => {
    if (!rawTask || !String(rawTask.title || "").trim()) return;
    const task = normalizeTask(rawTask);
    const key = titleKey(task.title);
    let record = byId.get(task.id) || byTitle.get(key);
    if (!record) {
      record = { task, rank };
      records.push(record);
    } else {
      record.task = mergeTask(record.task, task, record.rank, rank);
      record.rank = Math.max(record.rank, rank);
    }
    byId.set(record.task.id, record);
    byTitle.set(titleKey(record.task.title), record);
  };

  sources.forEach((source, index) => {
    const parsed = extractState(source.state);
    if (!parsed) return;
    const rank = (index + 1) * 1e13 + ts(parsed._savedAt);
    for (const category of Array.isArray(parsed.customCategories) ? parsed.customCategories : []) {
      const clean = String(category || "").trim();
      if (clean) custom.set(clean.toLowerCase(), clean);
    }
    for (const task of parsed.tasks) add(task, rank);
  });

  for (const task of DEFAULT_TASKS) add(task, 1);

  return {
    tasks: records.map(record => normalizeTask(record.task)),
    customCategories: [...custom.values()],
    _savedAt: Date.now()
  };
}

function readLocal(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? extractState(JSON.parse(raw)) : null;
  } catch (_) {
    return null;
  }
}

function legacyLocalSources() {
  const sources = [];
  const seen = new Set();
  for (const key of LEGACY_KEYS) {
    const data = readLocal(key);
    if (data) {
      sources.push({ name: key, state: data });
      seen.add(key);
    }
  }
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || key === KEY || seen.has(key) || !/task[_-]?dashboard/i.test(key)) continue;
      const data = readLocal(key);
      if (data) sources.push({ name: key, state: data });
    }
  } catch (_) {}
  return sources;
}

function loadInitialState() {
  const permanent = readLocal(KEY);
  if (permanent) return mergeStates([{ name: "permanent", state: permanent }]);
  const old = legacyLocalSources();
  if (old.length) migrationMessage = `Found ${old.length} older saved source${old.length === 1 ? "" : "s"}; merging them into permanent storage.`;
  return mergeStates(old);
}

function openPermanentDB() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) return reject(new Error("IndexedDB unavailable"));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DB_STORE)) request.result.createObjectStore(DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openExistingDB(name) {
  return new Promise(resolve => {
    if (!("indexedDB" in window)) return resolve(null);
    const request = indexedDB.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

async function readDB(db, store, key) {
  try {
    if (!db || !db.objectStoreNames.contains(store)) return null;
    return await new Promise(resolve => {
      const request = db.transaction(store, "readonly").objectStore(store).get(key);
      request.onsuccess = () => resolve(extractState(request.result));
      request.onerror = () => resolve(null);
    });
  } catch (_) {
    return null;
  }
}

async function readPermanentDB() {
  try {
    const db = await openPermanentDB();
    const result = await readDB(db, DB_STORE, "main");
    db.close();
    return result;
  } catch (_) {
    return null;
  }
}

async function readLegacyDB(source) {
  const db = await openExistingDB(source.name);
  if (!db) return null;
  const result = await readDB(db, source.store, source.key);
  db.close();
  return result;
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
  try { localStorage.setItem(KEY, JSON.stringify(snapshot)); } catch (_) {}
  writePermanentDB(snapshot);
}

async function hydrateStorage() {
  const permanentLocal = readLocal(KEY);
  const permanentDb = await readPermanentDB();

  if (permanentLocal || permanentDb) {
    const sources = [];
    if (permanentLocal) sources.push({ name: "permanent-local", state: permanentLocal });
    if (permanentDb) sources.push({ name: "permanent-db", state: permanentDb });
    sources.push({ name: "memory", state });
    state = mergeStates(sources);
    saveState();
    render();
    return;
  }

  const sources = legacyLocalSources();
  for (const legacy of LEGACY_DATABASES) {
    const old = await readLegacyDB(legacy);
    if (old) sources.push({ name: `${legacy.name}/${legacy.store}`, state: old });
  }
  if (sources.length) {
    sources.push({ name: "memory", state });
    state = mergeStates(sources);
    migrationMessage = `Recovered and merged ${sources.length - 1} older saved source${sources.length - 1 === 1 ? "" : "s"}.`;
  }
  saveState();
  render();
}

function pad(n) { return String(n).padStart(2, "0"); }
function dayKey(date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
function startOfDay(date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }

function parseDue(task) {
  if (!task.dueDate) return null;
  const [y, m, d] = task.dueDate.split("-").map(Number);
  if (![y, m, d].every(Number.isFinite)) return null;
  let h = 23, min = 59;
  if (/^\d{2}:\d{2}$/.test(task.dueTime || "")) [h, min] = task.dueTime.split(":").map(Number);
  return new Date(y, m - 1, d, h, min, 59, 999);
}

function daysFromToday(task) {
  if (!task.dueDate) return null;
  const [y, m, d] = task.dueDate.split("-").map(Number);
  if (![y, m, d].every(Number.isFinite)) return null;
  return Math.round((new Date(y, m - 1, d) - startOfDay(new Date())) / 86400000);
}

function isOverdue(task) { const due = parseDue(task); return Boolean(due && !task.done && due < new Date()); }
function isDueToday(task) { return !task.done && task.dueDate === dayKey(new Date()); }
function isDueTomorrow(task) { return !task.done && daysFromToday(task) === 1; }
function isRecentDone(task) { return Boolean(task.done && task.completedAt && Date.now() - task.completedAt < COMPLETED_VISIBLE_MS); }
function isAutoHigh(task) { return !task.done && (task.focus || isOverdue(task) || isDueToday(task)); }
function isTodayEffective(task) { return !task.done && (isOverdue(task) || isDueToday(task) || (task.today && (!task.dueDate || task.dueDate >= dayKey(new Date())))); }

function completedAgo(task) {
  const mins = Math.max(0, Math.floor((Date.now() - task.completedAt) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
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
  const ad = parseDue(a)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const bd = parseDue(b)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  return effectivePriority(a) - effectivePriority(b) || ad - bd || a.minutes - b.minutes || a.difficulty - b.difficulty || a.title.localeCompare(b.title);
}

function pLabel(p) { return ["P0 urgent", "P1 next", "P2 soon", "P3 flexible"][p] || "P2 soon"; }
function dLabel(d) { return ["Very easy", "Easy", "Medium", "Hard"][d] || "Easy"; }

function dateLabel(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(new Date(y, m - 1, d));
}

function timeLabel(value) {
  const [h, m] = value.split(":").map(Number);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(2000, 0, 1, h, m));
}

function dueBadge(task) {
  if (isOverdue(task)) return '<span class="badge overdue">Overdue</span>';
  const delta = daysFromToday(task);
  if (delta === 0) return `<span class="badge today">Today${task.dueTime ? ` ${timeLabel(task.dueTime)}` : ""}</span>`;
  if (delta === 1) return `<span class="badge">Tomorrow${task.dueTime ? ` ${timeLabel(task.dueTime)}` : ""}</span>`;
  if (delta !== null && delta > 1) return `<span class="badge">${dateLabel(task.dueDate)}${task.dueTime ? ` ${timeLabel(task.dueTime)}` : ""}</span>`;
  return task.due ? `<span class="badge">${esc(task.due)}</span>` : "";
}

function categories() {
  const set = new Set([
    ...PREFERRED_CATEGORIES,
    ...state.tasks.map(task => task.category || "Other"),
    ...(state.customCategories || [])
  ]);
  const preferred = PREFERRED_CATEGORIES.filter(category => set.has(category));
  const extras = [...set].filter(category => !PREFERRED_CATEGORIES.includes(category)).sort((a, b) => a.localeCompare(b));
  return [...preferred, ...extras];
}

function addCustomCategory(value) {
  const clean = String(value || "").trim().replace(/\s+/g, " ").slice(0, 40);
  if (!clean) return "";
  const existing = categories().find(category => category.toLowerCase() === clean.toLowerCase());
  const finalName = existing || clean;
  if (!state.customCategories) state.customCategories = [];
  if (!PREFERRED_CATEGORIES.includes(finalName) && !state.customCategories.some(category => category.toLowerCase() === finalName.toLowerCase())) state.customCategories.push(finalName);
  return finalName;
}

function refreshTopicOptions() {
  const list = categories();
  $("topicFilter").innerHTML = '<option value="all">All sections</option>' + list.map(category => `<option value="${esc(category)}">${esc(category)}</option>`).join("");
  if (selectedTopic !== "all" && !list.includes(selectedTopic)) selectedTopic = "all";
  $("topicFilter").value = selectedTopic;
}

function refreshCategorySelect(selected = "Other") {
  const list = categories();
  $("fCategory").innerHTML = list.map(category => `<option value="${esc(category)}">${esc(category)}</option>`).join("") + `<option value="${CUSTOM_VALUE}">+ Custom section…</option>`;
  $("fCategory").value = list.includes(selected) ? selected : "Other";
  syncCustomField();
}

function syncCustomField() {
  const custom = $("fCategory").value === CUSTOM_VALUE;
  $("customCategoryWrap").hidden = !custom;
  if (!custom) $("fCustomCategory").value = "";
}

function sorted(tasks) {
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
  return result;
}

function taskHtml(task) {
  return `<article class="task ${task.done ? "done" : ""} ${task.focus ? "focus" : ""} ${isOverdue(task) ? "overdue" : ""}">
    <input class="check" type="checkbox" ${task.done ? "checked" : ""} data-action="toggle" data-id="${esc(task.id)}" aria-label="Toggle ${esc(task.title)}">
    <div><div class="title">${esc(task.title)}</div><div class="meta">
      ${task.focus ? '<span class="badge focus">High Priority</span>' : ""}
      <span class="badge p${task.priority}">${pLabel(task.priority)}</span>
      <span class="badge">${task.minutes} min</span>
      <span class="badge">${dLabel(task.difficulty)}</span>
      <span class="badge">${esc(task.category)}</span>
      ${dueBadge(task)}
      ${task.done ? `<span class="badge">${isRecentDone(task) ? "Completed" : "Archived"} ${completedAgo(task)}</span>` : ""}
    </div></div>
    <div class="actions">
      ${task.focus && !task.done ? `<button class="icon" type="button" data-action="unfocus" data-id="${esc(task.id)}" title="Remove from high priority">↓</button>` : ""}
      <button class="icon" type="button" data-action="edit" data-id="${esc(task.id)}" title="Edit">✎</button>
      <button class="icon" type="button" data-action="delete" data-id="${esc(task.id)}" title="Delete">×</button>
    </div>
  </article>`;
}

function render() {
  const now = new Date();
  $("clockLine").textContent = `${new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(now)} • priorities update automatically`;

  const open = state.tasks.filter(task => !task.done);
  const done = state.tasks.filter(task => task.done);
  const recentDone = done.filter(isRecentDone);
  const archivedDone = done.filter(task => !isRecentDone(task));

  $("tabs").innerHTML = VIEWS.map(([id, label]) => `<button class="tab ${currentView === id ? "active" : ""}" type="button" data-view="${id}">${id === "completed" ? `Completed (${done.length})` : label}</button>`).join("");
  refreshTopicOptions();
  $("topicFilterWrap").hidden = currentView !== "topic";

  const topicMatch = task => currentView !== "topic" || selectedTopic === "all" || task.category === selectedTopic;
  const focus = open.filter(isAutoHigh).filter(topicMatch).sort(comparePriority);
  const active = currentView === "completed" ? [...done].sort((a, b) => b.completedAt - a.completedAt) : sorted(open.filter(task => !isAutoHigh(task)));
  const recentForView = currentView === "topic" ? recentDone.filter(topicMatch) : recentDone;

  $("focusPanel").hidden = currentView === "completed";
  $("recentCompletedPanel").hidden = currentView === "completed" || recentForView.length === 0;
  $("focusList").innerHTML = focus.length ? focus.map(taskHtml).join("") : '<div class="empty">No urgent items right now. Use “Move next 5 here” when you want a new focus batch.</div>';

  if (currentView === "completed") {
    $("activeList").innerHTML = active.length
      ? `<div class="archiveNote">${recentDone.length} completed in the last 24 hours • ${archivedDone.length} archived after 24 hours. Archived tasks stay here but leave the normal dashboard and recent-completion counter.</div>${active.map(taskHtml).join("")}`
      : '<div class="empty">No completed tasks yet.</div>';
  } else {
    $("activeList").innerHTML = active.length ? active.map(taskHtml).join("") : `<div class="empty">${currentView === "topic" && selectedTopic !== "all" ? `No open tasks in ${esc(selectedTopic)}.` : "Nothing here 🎉"}</div>`;
  }

  $("completedList").innerHTML = showRecentCompleted ? (recentForView.length ? [...recentForView].sort((a, b) => b.completedAt - a.completedAt).map(taskHtml).join("") : '<div class="empty">Nothing completed in the last 24 hours.</div>') : "";

  $("openCount").textContent = open.length;
  $("todayCount").textContent = open.filter(task => isOverdue(task) || isDueToday(task)).length;
  $("focusCount").textContent = focus.length;
  $("doneCount").textContent = recentDone.length;

  const currentTotal = open.length + recentDone.length;
  const pct = currentTotal ? Math.round(recentDone.length / currentTotal * 100) : 0;
  $("progressText").textContent = `${pct}% • ${recentDone.length}/${currentTotal} current`;
  $("progressBar").style.width = `${pct}%`;

  const meta = {
    today: ["Today", "Overdue + due-today + manually pinned"],
    priority: ["Priority", "Deadlines and time automatically move tasks up"],
    shortest: ["Shortest", "Fastest open tasks first"],
    easiest: ["Easiest", "Lowest-effort open tasks first"],
    all: ["All", "Alphabetical"],
    topic: [selectedTopic === "all" ? "Topic" : selectedTopic, selectedTopic === "all" ? "Choose a section from the dropdown" : `${selectedTopic} section • smart priority order`],
    completed: ["Completed archive", `${done.length} stored • normal dashboard hides them after 24 hours`]
  }[currentView];
  $("viewTitle").textContent = meta[0];
  $("viewHint").textContent = meta[1];

  const candidates = open.filter(task => !isAutoHigh(task));
  $("nextFiveBtn").disabled = candidates.length === 0;
  $("nextFiveBtn").textContent = candidates.length ? `Move next ${Math.min(5, candidates.length)} here` : "No more tasks";

  $("migrationStatus").hidden = !migrationMessage;
  $("migrationStatus").textContent = migrationMessage ? `Permanent storage active • ${migrationMessage}` : "";
}

function setView(view) { currentView = view; render(); }

function toggleDone(id) {
  const task = state.tasks.find(item => item.id === id);
  if (!task) return;
  task.done = !task.done;
  task.updatedAt = Date.now();
  if (task.done) { task.focus = false; task.completedAt = task.updatedAt; }
  else delete task.completedAt;
  saveState();
  render();
}

function unfocus(id) {
  const task = state.tasks.find(item => item.id === id);
  if (!task) return;
  task.focus = false;
  task.updatedAt = Date.now();
  saveState();
  render();
}

function deleteTask(id) {
  const task = state.tasks.find(item => item.id === id);
  if (!task || !confirm(`Delete “${task.title}”?`)) return;
  state.tasks = state.tasks.filter(item => item.id !== id);
  saveState();
  render();
}

function moveNextFive() {
  const list = state.tasks.filter(task => !task.done && !isAutoHigh(task)).sort(comparePriority).slice(0, 5);
  const stamp = Date.now();
  for (const task of list) { task.focus = true; task.updatedAt = stamp; }
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
  $("fToday").checked = task.today;
  $("modal").classList.add("open");
  $("modal").setAttribute("aria-hidden", "false");
}

function closeModal() {
  $("modal").classList.remove("open");
  $("modal").setAttribute("aria-hidden", "true");
}

function saveTask() {
  const title = $("fTitle").value.trim();
  if (!title) return $("fTitle").focus();

  let category = $("fCategory").value;
  if (category === CUSTOM_VALUE) {
    category = addCustomCategory($("fCustomCategory").value);
    if (!category) return $("fCustomCategory").focus();
  }

  const stamp = Date.now();
  const data = {
    title,
    priority: clamp($("fPriority").value, 0, 3, 2),
    minutes: clamp($("fMinutes").value, 1, 1440, 10),
    difficulty: clamp($("fDifficulty").value, 0, 3, 1),
    category: category || "Other",
    due: $("fDue").value.trim(),
    dueDate: $("fDueDate").value,
    dueTime: $("fDueTime").value,
    today: $("fToday").checked,
    updatedAt: stamp
  };

  if (editingId) Object.assign(state.tasks.find(item => item.id === editingId), data);
  else state.tasks.push(normalizeTask({ id: `t${stamp}`, ...data, createdAt: stamp, done: false, focus: false }));

  selectedTopic = data.category;
  saveState();
  closeModal();
  render();
}

function exportData() {
  const payload = { tasks: state.tasks, customCategories: state.customCategories || [], exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "task-dashboard-data.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function importData(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const incoming = extractState(JSON.parse(reader.result));
      if (!incoming) throw new Error();
      state = mergeStates([{ name: "current", state }, { name: "import", state: incoming }]);
      migrationMessage = "Imported data was merged with the current list instead of replacing it.";
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
$("topicFilter").addEventListener("change", event => { selectedTopic = event.target.value; render(); });
$("fCategory").addEventListener("change", () => { syncCustomField(); if ($("fCategory").value === CUSTOM_VALUE) setTimeout(() => $("fCustomCategory").focus(), 50); });

for (const id of ["activeList", "focusList", "completedList"]) {
  $(id).addEventListener("click", event => {
    const control = event.target.closest("[data-action]");
    if (!control) return;
    if (control.dataset.action === "edit") openEdit(control.dataset.id);
    if (control.dataset.action === "delete") deleteTask(control.dataset.id);
    if (control.dataset.action === "unfocus") unfocus(control.dataset.id);
  });
  $(id).addEventListener("change", event => {
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
$("exportBtn").addEventListener("click", exportData);
$("importBtn").addEventListener("click", () => $("importFile").click());
$("importFile").addEventListener("change", event => {
  importData(event.target.files && event.target.files[0]);
  event.target.value = "";
});
$("modal").addEventListener("click", event => { if (event.target === $("modal")) closeModal(); });
document.addEventListener("keydown", event => { if (event.key === "Escape" && $("modal").classList.contains("open")) closeModal(); });

setInterval(() => {
  const today = dayKey(new Date());
  if (today !== lastDayKey) lastDayKey = today;
  render();
}, 60000);

render();
hydrateStorage();
