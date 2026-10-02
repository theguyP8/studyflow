"use strict";

/* =========================================================
   StudyFlow — app.js
   Same storage key as v1, so existing data carries over.
========================================================= */

const STORAGE_KEY = "studyflow_v1";
const TIMER_KEY = "studyflow_timer_v1";
const RING_C = 2 * Math.PI * 136;

/* ---------- Default state ---------- */

const mkTopics = (prefix, names) =>
  names.map((name, i) => ({ id: prefix + i, name, done: false, minutes: 0 }));

const defaultState = () => ({
  profile: { name: "Student", dailyTarget: 90, emailWebhook: "", surveyReminderNotifiedAt: null, theme: "system" },
  subjects: [
    { id: "db", name: "Base de données", code: "BD", color: "#3d5afe",
      topics: mkTopics("dbt", ["Modèle relationnel", "Algèbre relationnelle", "SQL", "Normalisation", "Transactions"]) },
    { id: "algo2", name: "Algo 2", code: "A2", color: "#7c3aed",
      topics: mkTopics("a2t", ["Complexité", "Arbres", "Graphes", "Programmation dynamique", "Algorithmes gloutons"]) },
    { id: "analyse2", name: "Analyse 2", code: "AN2", color: "#0891b2",
      topics: mkTopics("an2t", ["Suites", "Séries", "Intégrales", "Fonctions de plusieurs variables", "Équations différentielles"]) },
    { id: "algebre2", name: "Algèbre 2", code: "ALG2", color: "#ea580c",
      topics: mkTopics("alg2t", ["Espaces vectoriels", "Applications linéaires", "Matrices", "Diagonalisation", "Formes bilinéaires"]) },
    { id: "probstat", name: "Probabilité & Statistique", code: "P&S", color: "#16a34a",
      topics: mkTopics("pst", ["Variables aléatoires", "Lois", "Espérance & variance", "Estimation", "Tests"]) },
    { id: "english", name: "English", code: "ENG", color: "#db2777",
      topics: mkTopics("engt", ["Vocabulary", "Grammar", "Writing", "Speaking", "Research English"]) }
  ],
  tasks: [], sessions: [], notes: [], reminders: [], surveys: [],
  settings: { firstRun: true, lastSubjectId: null }
});

function normalize(raw) {
  const d = defaultState();
  const s = raw && typeof raw === "object" ? raw : {};
  return {
    ...d, ...s,
    profile: { ...d.profile, ...(s.profile || {}) },
    settings: { ...d.settings, ...(s.settings || {}) },
    subjects: s.subjects?.length ? s.subjects : d.subjects,
    tasks: s.tasks || [], sessions: s.sessions || [], notes: s.notes || [],
    reminders: s.reminders || [], surveys: s.surveys || []
  };
}

function loadState() {
  try { return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY))); }
  catch { return defaultState(); }
}

let state = loadState();
let currentView = "dashboard";
let taskFilter = "all";
let taskSubjectFilter = "all";
let currentNoteId = null;
let editorNoteId = null;

const timer = { total: 25 * 60, remaining: 25 * 60, running: false, startedAt: null, endAt: null, interval: null, durationMinutes: 25 };

/* ---------- Helpers ---------- */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const pad = (n) => String(n).padStart(2, "0");
const uid = (p = "id") => p + "_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

function localISO(date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
function todayISO() { return localISO(new Date()); }
function startOfDay(date = new Date()) { const d = new Date(date); d.setHours(0, 0, 0, 0); return d; }

function formatDate(iso) {
  if (!iso) return "No date";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(iso + "T00:00:00"));
}
function formatDateTime(iso) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}
function minutesLabel(mins) {
  if (mins < 60) return `${Math.round(mins)}m`;
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}
function escapeHtml(str = "") {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch { toast("Couldn't save. Browser storage may be full. Export a backup."); }
  updateSidebarLevel();
  updateBadge();
}

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove("show"), 2800);
}

const subjectById = (id) => state.subjects.find((s) => s.id === id);
const topicById = (sid, tid) => subjectById(sid)?.topics.find((t) => t.id === tid);

/* ---------- Notifications (works on installed Android PWAs too) ---------- */

async function showNotif(title, body) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg) return reg.showNotification(title, { body, icon: "icons/icon-192.png", badge: "icons/icon-192.png" });
  } catch {}
  try { new Notification(title, { body, icon: "icons/icon-192.png" }); } catch {}
}

/* ---------- Icon badge: tasks due today or overdue ---------- */

function updateBadge() {
  if (!navigator.setAppBadge) return;
  const n = state.tasks.filter((t) => !t.completed && t.dueDate && t.dueDate <= todayISO()).length;
  try { n ? navigator.setAppBadge(n) : navigator.clearAppBadge(); } catch {}
}

/* ---------- Theme ---------- */

function applyTheme() {
  const t = state.profile.theme || "system";
  const root = document.documentElement;
  if (t === "system") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", t);
  const dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  $("#themeColorMeta").setAttribute("content", dark ? "#0a0f1d" : "#0e1525");
}
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", applyTheme);

/* =========================================================
   XP / stats
========================================================= */

function getXP() {
  const sessionXP = state.sessions.reduce((sum, s) => sum + Math.round(s.minutes * 2), 0);
  const taskXP = state.tasks.filter((t) => t.completed).length * 40;
  const topicXP = state.subjects.flatMap((s) => s.topics).filter((t) => t.done).length * 25;
  return sessionXP + taskXP + topicXP;
}
const getLevel = () => Math.floor(getXP() / 250) + 1;

function updateSidebarLevel() {
  const xp = getXP(), level = getLevel(), progress = xp - (level - 1) * 250;
  $("#sidebarLevel").textContent = level;
  $("#sidebarXP").textContent = `${xp} XP`;
  $("#sidebarXPBar").style.width = `${Math.min(100, (progress / 250) * 100)}%`;
  $("#sidebarXPText").textContent = `${Math.max(0, 250 - progress)} XP to next level`;
}

const sumMinutes = (list) => list.reduce((a, s) => a + Number(s.minutes || 0), 0);
const dayMinutes = (iso) => sumMinutes(state.sessions.filter((s) => s.date === iso));
const subjectMinutes = (id) => sumMinutes(state.sessions.filter((s) => s.subjectId === id));
const totalMinutes = () => sumMinutes(state.sessions);

function rangeMinutes(daysAgoStart, daysAgoEnd) {
  // inclusive range of days ago, e.g. (6,0) = last 7 days
  const from = startOfDay(); from.setDate(from.getDate() - daysAgoStart);
  const to = startOfDay(); to.setDate(to.getDate() - daysAgoEnd + 1);
  return sumMinutes(state.sessions.filter((s) => {
    const d = new Date(s.date + "T00:00:00");
    return d >= from && d < to;
  }));
}
const weekMinutes = () => rangeMinutes(6, 0);

function getStreak() {
  const dates = new Set(state.sessions.map((s) => s.date));
  const cursor = startOfDay();
  if (!dates.has(localISO(cursor))) cursor.setDate(cursor.getDate() - 1);
  let count = 0;
  while (dates.has(localISO(cursor))) { count++; cursor.setDate(cursor.getDate() - 1); }
  return count;
}

/* =========================================================
   Navigation
========================================================= */

const TITLES = {
  dashboard: "Dashboard", subjects: "Subjects", "study-room": "Study room", tasks: "Tasks",
  notes: "Notes", reminders: "Reminders", research: "Research survey", settings: "Settings"
};

function closeSidebar() { $("#sidebar").classList.remove("open"); $("#scrim").classList.remove("show"); }

function setView(view) {
  currentView = view;
  $$(".view").forEach((v) => v.classList.remove("active"));
  $(`#view-${view}`)?.classList.add("active");
  $$("[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  $("#pageTitle").textContent = TITLES[view] || "Dashboard";
  closeSidebar();
  renderAll();
  updateTimerDisplay();
  window.scrollTo(0, 0);
}

function renderDate() {
  $("#dateLabel").textContent = new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric" }).format(new Date());
}

/* =========================================================
   Dashboard
========================================================= */

function emptyInline(msg) { return `<div class="empty-state"><p>${escapeHtml(msg)}</p></div>`; }

function priorityOrder(a, b) {
  const pr = { high: 0, medium: 1, low: 2 };
  return pr[a.priority] - pr[b.priority] || (a.dueDate || "9999").localeCompare(b.dueDate || "9999");
}

function renderDashboard() {
  const today = todayISO();
  const minsToday = dayMinutes(today);
  const target = Number(state.profile.dailyTarget || 90);

  $("#todayMinutes").textContent = minsToday;
  $("#todayBar").style.width = `${Math.min(100, (minsToday / target) * 100)}%`;

  const streak = getStreak();
  $("#streakCount").textContent = `${streak} day${streak === 1 ? "" : "s"}`;
  $("#streakSubtext").textContent = streak ? "Keep the chain unbroken." : "Study today to start one.";

  const week = weekMinutes(), prev = rangeMinutes(13, 7);
  $("#weekMinutes").textContent = minutesLabel(week);
  $("#weekTrend").textContent = !week && !prev ? "No data yet"
    : week >= prev ? `+${minutesLabel(week - prev)} vs last week` : `-${minutesLabel(prev - week)} vs last week`;
  $("#totalMinutes").textContent = minutesLabel(totalMinutes());
  $("#totalSessions").textContent = `${state.sessions.length} session${state.sessions.length === 1 ? "" : "s"}`;

  const doneTasks = state.tasks.filter((t) => t.completed).length;
  $("#completedTasks").textContent = doneTasks;
  $("#taskCompletionRate").textContent = `${state.tasks.length ? Math.round((doneTasks / state.tasks.length) * 100) : 0}% completion`;

  const topics = state.subjects.flatMap((s) => s.topics);
  const doneTopics = topics.filter((t) => t.done).length;
  $("#completedTopics").textContent = doneTopics;
  $("#topicCompletionRate").textContent = `${topics.length ? Math.round((doneTopics / topics.length) * 100) : 0}% of topics`;

  $("#weeklyFocusPill").textContent = `${(week / 60).toFixed(1)}h focus`;
  $("#dashboardGreeting").textContent = minsToday >= target ? "Target cleared." : minsToday ? "Momentum is on." : "Build the streak.";
  $("#dailyMessage").textContent = minsToday >= target
    ? "Daily target complete. Anything more is a bonus."
    : `${Math.max(0, target - minsToday)} minutes to go for today's ${target}-minute target.`;

  // Weekly chart
  const days = [];
  let max = 1;
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const m = dayMinutes(localISO(d));
    max = Math.max(max, m);
    days.push({ d, m, today: i === 0 });
  }
  $("#weeklyChart").innerHTML = days.map((x) => {
    const h = Math.round((x.m / max) * 128);
    const lab = new Intl.DateTimeFormat("en", { weekday: "short" }).format(x.d);
    return `<div class="bar-day">
      <div class="bar-wrap"><div class="bar ${x.m === 0 ? "zero" : ""} ${x.today ? "today" : ""}" style="height:${Math.max(3, h)}px"></div></div>
      <strong>${x.m}m</strong><small>${lab}</small></div>`;
  }).join("");

  // Subject distribution
  const total = Math.max(1, totalMinutes());
  $("#subjectDistribution").innerHTML = state.subjects.map((s) => {
    const m = subjectMinutes(s.id), pct = Math.round((m / total) * 100);
    return `<div class="subject-line">
      <span title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</span>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%;background:${s.color}"></div></div>
      <small>${minutesLabel(m)}</small></div>`;
  }).join("");

  // Recent sessions
  const sessions = [...state.sessions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
  $("#recentSessions").innerHTML = sessions.length ? sessions.map((s) => {
    const sub = subjectById(s.subjectId), topic = topicById(s.subjectId, s.topicId);
    return `<div class="stack-item">
      <div class="stack-main"><strong>${escapeHtml(sub?.name || "Deleted subject")}</strong>
      <small>${escapeHtml(topic?.name || s.note || "Study session")} · ${formatDateTime(s.createdAt)}</small></div>
      <div class="stack-meta"><strong>${s.minutes}m</strong><small>focus</small></div></div>`;
  }).join("") : emptyInline("No sessions yet. Start a timer in the study room.");

  // Priority tasks
  const tasks = state.tasks.filter((t) => !t.completed).sort(priorityOrder).slice(0, 5);
  $("#dashboardTasks").innerHTML = tasks.length ? tasks.map(taskHTML).join("") : emptyInline("No open tasks. Add one from the Tasks tab.");
}

/* =========================================================
   Subjects / topics
========================================================= */

function renderSubjects() {
  $("#subjectCards").innerHTML = state.subjects.map((s) => {
    const total = s.topics.length, done = s.topics.filter((t) => t.done).length;
    const mins = subjectMinutes(s.id), pct = total ? Math.round((done / total) * 100) : 0;
    return `<article class="subject-card" style="--c:${s.color}">
      <div class="subject-card-top">
        <div><h3>${escapeHtml(s.name)}</h3><div class="code">${escapeHtml(s.code)} · ${minutesLabel(mins)} studied</div></div>
        <div class="subject-actions">
          <button class="tiny-btn" title="Edit subject" aria-label="Edit subject" data-action="edit-subject" data-id="${s.id}">✎</button>
          <button class="tiny-btn" title="Delete subject" aria-label="Delete subject" data-action="delete-subject" data-id="${s.id}">×</button>
        </div>
      </div>
      <div class="stats">
        <div class="mini-stat"><span>Progress</span><strong>${pct}%</strong></div>
        <div class="mini-stat"><span>Topics</span><strong>${done}/${total}</strong></div>
        <div class="mini-stat"><span>Time</span><strong>${minutesLabel(mins)}</strong></div>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      <div class="topic-list">
        ${s.topics.length ? s.topics.map((t) => `
          <div class="topic-row">
            <button class="topic-check ${t.done ? "done" : ""}" aria-label="Toggle topic" data-action="toggle-topic" data-subject="${s.id}" data-topic="${t.id}">${t.done ? "✓" : ""}</button>
            <span>${escapeHtml(t.name)}</span>
            <small>${t.minutes || 0}m</small>
            <div class="topic-actions">
              <button class="tiny-btn" aria-label="Edit topic" data-action="edit-topic" data-subject="${s.id}" data-topic="${t.id}">✎</button>
              <button class="tiny-btn" aria-label="Delete topic" data-action="delete-topic" data-subject="${s.id}" data-topic="${t.id}">×</button>
            </div>
          </div>`).join("") : `<div class="empty-state"><p>No topics yet.</p></div>`}
      </div>
      <button class="secondary-btn full topic-add" data-action="add-topic" data-subject="${s.id}">+ Topic</button>
    </article>`;
  }).join("");
}

function subjectOptions(selected) {
  return state.subjects.map((s) => `<option value="${s.id}" ${s.id === selected ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("");
}

function renderTopicOptions() {
  const subj = $("#timerSubject");
  const current = subj.value;
  subj.innerHTML = subjectOptions();
  if (current && subjectById(current)) subj.value = current;
  renderTimerTopics();

  const qs = $("#quickTaskSubject");
  const cur = qs.value || state.settings.lastSubjectId;
  qs.innerHTML = subjectOptions();
  if (cur && subjectById(cur)) qs.value = cur;
}

function renderTimerTopics() {
  const s = subjectById($("#timerSubject").value) || state.subjects[0];
  $("#timerSubject").value = s?.id || "";
  const sel = $("#timerTopic");
  const keep = sel.value;
  sel.innerHTML = (s?.topics || []).map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("");
  if (keep && s?.topics.some((t) => t.id === keep)) sel.value = keep;
}

function renderStudyTasks() {
  const sid = $("#timerSubject").value;
  const list = state.tasks.filter((t) => !t.completed && t.subjectId === sid).sort(priorityOrder).slice(0, 5);
  $("#studyTasks").innerHTML = list.length ? list.map((t) => `
    <div class="mini-task">
      <button class="task-check" aria-label="Complete task" data-action="toggle-task" data-id="${t.id}"></button>
      <span>${escapeHtml(t.title)}</span>
      <small class="tag priority-${t.priority}">${t.priority}</small>
    </div>`).join("") : emptyInline("Nothing open for this subject.");
}

/* =========================================================
   Tasks
========================================================= */

function renderTaskFilters() {
  $("#taskSubjectFilter").innerHTML = `<option value="all">All subjects</option>` + subjectOptions();
  $("#taskSubjectFilter").value = taskSubjectFilter;
}

function taskHTML(t) {
  const sub = subjectById(t.subjectId);
  const overdue = !t.completed && t.dueDate && t.dueDate < todayISO();
  const due = t.dueDate ? (t.dueDate === todayISO() ? "Today" : formatDate(t.dueDate)) : "No due date";
  return `<div class="task-item ${t.completed ? "completed" : ""} ${overdue ? "overdue" : ""}" style="--c:${sub?.color || "var(--border)"}">
    <button class="task-check ${t.completed ? "done" : ""}" aria-label="Toggle task" data-action="toggle-task" data-id="${t.id}">${t.completed ? "✓" : ""}</button>
    <div>
      <div class="task-title">${escapeHtml(t.title)}</div>
      <div class="task-info">
        <span class="tag">${escapeHtml(sub?.name || "No subject")}</span>
        <span class="tag priority-${t.priority}">${t.priority}</span>
        ${t.topicId ? `<span class="tag">${escapeHtml(topicById(t.subjectId, t.topicId)?.name || "Topic")}</span>` : ""}
      </div>
    </div>
    <div class="task-date ${overdue ? "overdue" : ""}">${escapeHtml(overdue ? "Overdue · " + due : due)}
      <div class="task-actions">
        <button class="tiny-btn" aria-label="Edit task" data-action="edit-task" data-id="${t.id}">✎</button>
        <button class="tiny-btn" aria-label="Delete task" data-action="delete-task" data-id="${t.id}">×</button>
      </div>
    </div>
  </div>`;
}

function renderTasks() {
  renderTaskFilters();
  let list = [...state.tasks];
  if (taskFilter === "open") list = list.filter((t) => !t.completed);
  if (taskFilter === "today") list = list.filter((t) => t.dueDate && t.dueDate <= todayISO() && !t.completed);
  if (taskFilter === "completed") list = list.filter((t) => t.completed);
  if (taskSubjectFilter !== "all") list = list.filter((t) => t.subjectId === taskSubjectFilter);
  list.sort((a, b) => (a.completed !== b.completed ? (a.completed ? 1 : -1) : priorityOrder(a, b)));
  $("#taskList").innerHTML = list.length ? list.map(taskHTML).join("") : emptyInline("No tasks here. Type one above and press Enter.");
}

function quickAddTask() {
  const input = $("#quickTaskInput");
  let title = input.value.trim();
  if (!title) return input.focus();
  let priority = "medium";
  if (title.endsWith("!")) { priority = "high"; title = title.replace(/!+$/, "").trim(); }
  if (!title) return;
  const subjectId = $("#quickTaskSubject").value || state.subjects[0]?.id || null;
  state.tasks.push({ id: uid("task"), title, subjectId, topicId: null, priority, dueDate: null, completed: false, createdAt: new Date().toISOString() });
  state.settings.lastSubjectId = subjectId;
  input.value = "";
  saveState();
  renderAll();
  input.focus();
  toast("Task added.");
}

/* =========================================================
   Notes (autosave)
========================================================= */

function renderNotesList() {
  const notes = [...state.notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  $("#notesList").innerHTML = notes.length ? notes.map((n) => `
    <button class="note-card ${currentNoteId === n.id ? "active" : ""}" data-action="open-note" data-id="${n.id}">
      <h4>${escapeHtml(n.title || "Untitled note")}</h4>
      <small>${escapeHtml((n.body || "").slice(0, 90))}${(n.body || "").length > 90 ? "…" : ""}<br>${formatDateTime(n.updatedAt)}</small>
    </button>`).join("") : emptyInline("No notes yet. Tap + Note.");
}

function renderNoteEditor() {
  const editor = $("#noteEditor");
  const note = state.notes.find((n) => n.id === currentNoteId);
  if (!note) {
    editorNoteId = null;
    editor.innerHTML = `<div class="empty-state"><h3>Select a note</h3><p>Create a note or pick one from the list.</p></div>`;
    return;
  }
  editorNoteId = note.id;
  editor.innerHTML = `
    <div class="note-editor-head">
      <input id="editNoteTitle" class="note-title-input" value="${escapeHtml(note.title)}" aria-label="Note title" />
      <button class="tiny-btn" aria-label="Delete note" data-action="delete-note" data-id="${note.id}">×</button>
    </div>
    <div class="saved-hint" id="noteSavedHint">Saved ${formatDateTime(note.updatedAt)}</div>
    <textarea id="editNoteBody" aria-label="Note body">${escapeHtml(note.body)}</textarea>`;

  let t;
  const autosave = () => {
    clearTimeout(t);
    t = setTimeout(() => {
      note.title = $("#editNoteTitle").value.trim() || "Untitled note";
      note.body = $("#editNoteBody").value;
      note.updatedAt = new Date().toISOString();
      saveState();
      renderNotesList();
      const hint = $("#noteSavedHint");
      if (hint) hint.textContent = `Saved ${formatDateTime(note.updatedAt)}`;
    }, 400);
  };
  $("#editNoteTitle").oninput = autosave;
  $("#editNoteBody").oninput = autosave;
}

function renderNotes() {
  renderNotesList();
  if (editorNoteId !== currentNoteId || !$("#editNoteBody")) renderNoteEditor();
}

/* =========================================================
   Reminders
========================================================= */

function renderReminders() {
  const browserEnabled = "Notification" in window && Notification.permission === "granted";
  $("#reminderStatusText").textContent = state.reminders.length
    ? `${state.reminders.filter((r) => r.enabled).length} active. ${browserEnabled ? "Notifications are on." : "Notifications are off."}`
    : "No reminder configured.";

  $("#reminderList").innerHTML = state.reminders.length ? state.reminders.map((r) => `
    <div class="reminder-item">
      <div>
        <strong>${escapeHtml(r.title)}</strong>
        <small>${r.repeat === "daily" ? "Every day" : escapeHtml(r.date)} at ${escapeHtml(r.time)} · ${escapeHtml(r.method || "browser")}${r.email ? " · " + escapeHtml(r.email) : ""}</small>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <button class="switch ${r.enabled ? "on" : ""}" aria-label="Toggle reminder" data-action="toggle-reminder" data-id="${r.id}"><span class="knob"></span></button>
        <button class="tiny-btn" aria-label="Edit reminder" data-action="edit-reminder" data-id="${r.id}">✎</button>
        <button class="tiny-btn" aria-label="Delete reminder" data-action="delete-reminder" data-id="${r.id}">×</button>
      </div>
    </div>`).join("") : emptyInline("No reminders yet. Add a daily one to build the habit.");
}

/* =========================================================
   Research / TAM
========================================================= */

const mean = (values) => values.length ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2) : "—";
const pick = (keys) => state.surveys.flatMap((s) => keys.map((k) => s[k])).filter(Boolean).map(Number);

function getSurveyStatus() {
  if (!state.surveys.length) return { due: true, daysPassed: null, daysRemaining: 0 };
  const latest = [...state.surveys].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  const daysPassed = Math.floor((Date.now() - new Date(latest.createdAt)) / 86400000);
  return { due: daysPassed >= 7, daysPassed, daysRemaining: Math.max(0, 7 - daysPassed) };
}

function renderSurveyReminder() {
  const form = $("#tamForm");
  if (!form) return;
  let banner = $("#surveyReminderBanner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "surveyReminderBanner";
    banner.className = "survey-reminder";
    form.parentNode.insertBefore(banner, form);
  }
  const status = getSurveyStatus();
  banner.classList.toggle("due", status.due);
  banner.innerHTML = status.due
    ? `<div><strong>Survey due</strong><p>${state.surveys.length === 0 ? "Complete your baseline survey to start the weekly cycle." : "It's been 7+ days since your last survey."}</p></div>
       <button class="primary-btn" id="surveyReminderButton" type="button">Take survey</button>`
    : `<div><strong>Survey schedule</strong><p>Next survey due in ${status.daysRemaining} day${status.daysRemaining === 1 ? "" : "s"}.</p></div>
       <button class="secondary-btn" id="surveyReminderButton" type="button">View survey</button>`;
  $("#surveyReminderButton").onclick = () => form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function maybeNotifySurvey() {
  if (!getSurveyStatus().due) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const today = todayISO();
  if (state.profile.surveyReminderNotifiedAt === today) return;
  showNotif("StudyFlow survey due", "Your weekly research survey is ready.");
  state.profile.surveyReminderNotifiedAt = today;
  saveState();
}

function renderResearch() {
  $("#peouMean").textContent = mean(pick(["peou1", "peou2"]));
  $("#puMean").textContent = mean(pick(["pu1", "pu2"]));
  $("#attMean").textContent = mean(pick(["att1"]));
  $("#biMean").textContent = mean(pick(["bi1", "bi2"]));
  $("#surveyCount").textContent = `${state.surveys.length} response${state.surveys.length === 1 ? "" : "s"}`;
  const m2 = (a, b) => mean([a, b].map(Number));
  $("#surveyHistory").innerHTML = state.surveys.length
    ? state.surveys.slice().reverse().map((s) => `
      <div class="survey-row"><span>${formatDateTime(s.createdAt)}</span>
        <strong>${m2(s.peou1, s.peou2)}</strong><strong>${m2(s.pu1, s.pu2)}</strong>
        <strong>${s.att1}</strong><strong>${m2(s.bi1, s.bi2)}</strong></div>`).join("")
    : emptyInline("No responses yet. Repeated measures make the analysis much stronger.");
  renderSurveyReminder();
}

/* =========================================================
   Render all
========================================================= */

function renderAll() {
  renderDate();
  updateSidebarLevel();
  renderDashboard();
  renderSubjects();
  renderTopicOptions();
  renderStudyTasks();
  renderTasks();
  renderNotes();
  renderReminders();
  renderResearch();
}

/* =========================================================
   Modals
========================================================= */

function openModal(inner) {
  $("#modalContent").innerHTML = inner;
  $("#modalBackdrop").hidden = false;
  $("#modalContent").querySelector("input,select")?.focus();
}
function closeModal() { $("#modalBackdrop").hidden = true; $("#modalContent").innerHTML = ""; }
const modalFooter = (extra = "") => `<div class="modal-footer"><button class="ghost-btn" data-action="close-modal">Cancel</button>${extra}</div>`;

function openSubjectModal(id = null) {
  const s = id ? subjectById(id) : null;
  openModal(`
    <h3>${s ? "Edit subject" : "Add subject"}</h3>
    <div class="form-grid">
      <label class="wide">Name<input id="mSubjectName" value="${escapeHtml(s?.name || "")}"></label>
      <label>Code<input id="mSubjectCode" value="${escapeHtml(s?.code || "")}"></label>
      <label>Color<input id="mSubjectColor" type="color" value="${s?.color || "#3d5afe"}"></label>
    </div>
    ${modalFooter(`<button class="primary-btn" id="saveSubjectModal">${s ? "Save changes" : "Create subject"}</button>`)}`);

  $("#saveSubjectModal").onclick = () => {
    const name = $("#mSubjectName").value.trim();
    if (!name) return toast("Name the subject first.");
    if (s) {
      s.name = name; s.code = $("#mSubjectCode").value.trim(); s.color = $("#mSubjectColor").value;
    } else {
      state.subjects.push({ id: uid("sub"), name, code: $("#mSubjectCode").value.trim() || "NEW", color: $("#mSubjectColor").value, topics: [] });
    }
    saveState(); closeModal(); renderAll();
    toast(s ? "Subject updated." : "Subject created.");
  };
}

function openTopicModal(subjectId, topicId = null) {
  const s = subjectById(subjectId);
  if (!s) return;
  const topic = topicId ? topicById(subjectId, topicId) : null;
  openModal(`
    <h3>${topic ? "Edit topic" : "Add topic"}</h3>
    <p>${topic ? "Rename this topic" : "Add one concrete topic"} in ${escapeHtml(s.name)}.</p>
    <label>Topic name<input id="mTopicName" value="${escapeHtml(topic?.name || "")}" placeholder="e.g. SQL joins"></label>
    ${modalFooter(`<button class="primary-btn" id="saveTopicModal">${topic ? "Save changes" : "Add topic"}</button>`)}`);

  $("#saveTopicModal").onclick = () => {
    const name = $("#mTopicName").value.trim();
    if (!name) return toast("Give the topic a name.");
    if (topic) topic.name = name;
    else s.topics.push({ id: uid("topic"), name, done: false, minutes: 0 });
    saveState(); closeModal(); renderAll();
    toast(topic ? "Topic updated." : "Topic added.");
  };
}

function openTaskModal(id = null) {
  const t = id ? state.tasks.find((x) => x.id === id) : null;
  const subject = t ? subjectById(t.subjectId) : subjectById(state.settings.lastSubjectId) || state.subjects[0];
  openModal(`
    <h3>${t ? "Edit task" : "Add task"}</h3>
    <p>Make it specific enough that “done” is obvious.</p>
    <div class="form-grid">
      <label class="wide">Task<input id="mTaskTitle" value="${escapeHtml(t?.title || "")}"></label>
      <label>Subject<select id="mTaskSubject">${subjectOptions(subject?.id)}</select></label>
      <label>Topic<select id="mTaskTopic"></select></label>
      <label>Priority<select id="mTaskPriority"><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
      <label>Due date<input id="mTaskDue" type="date" value="${t?.dueDate || ""}"></label>
    </div>
    ${modalFooter(`<button class="primary-btn" id="saveTaskModal">${t ? "Save changes" : "Create task"}</button>`)}`);

  $("#mTaskPriority").value = t?.priority || "medium";
  const fillTopics = () => {
    const ss = subjectById($("#mTaskSubject").value);
    $("#mTaskTopic").innerHTML = `<option value="">No specific topic</option>` +
      (ss?.topics || []).map((tp) => `<option value="${tp.id}">${escapeHtml(tp.name)}</option>`).join("");
    $("#mTaskTopic").value = t?.topicId || "";
  };
  $("#mTaskSubject").onchange = fillTopics;
  fillTopics();

  $("#saveTaskModal").onclick = () => {
    const title = $("#mTaskTitle").value.trim();
    if (!title) return toast("Write the task first.");
    const payload = {
      title, subjectId: $("#mTaskSubject").value, topicId: $("#mTaskTopic").value || null,
      priority: $("#mTaskPriority").value, dueDate: $("#mTaskDue").value || null
    };
    if (t) Object.assign(t, payload);
    else state.tasks.push({ id: uid("task"), ...payload, completed: false, createdAt: new Date().toISOString() });
    state.settings.lastSubjectId = payload.subjectId;
    saveState(); closeModal(); renderAll();
    toast(t ? "Task updated." : "Task created.");
  };
}

function openReminderModal(id = null) {
  const r = id ? state.reminders.find((x) => x.id === id) : null;
  const soon = new Date(Date.now() + 5 * 60000);
  const date = r?.date || localISO(soon);
  const time = r?.time || `${pad(soon.getHours())}:${pad(soon.getMinutes())}`;

  openModal(`
    <h3>${r ? "Edit reminder" : "Add reminder"}</h3>
    <p>Notifications only fire while StudyFlow is open. Email needs the webhook in Settings.</p>
    <div class="form-grid">
      <label class="wide">Title<input id="mRemTitle" value="${escapeHtml(r?.title || "Study session")}"></label>
      <label>Date<input id="mRemDate" type="date" value="${date}"></label>
      <label>Time<input id="mRemTime" type="time" value="${time}"></label>
      <label>Repeat<select id="mRemRepeat"><option value="none">Just once</option><option value="daily">Every day</option></select></label>
      <label>Method<select id="mRemMethod"><option value="browser">Notification</option><option value="email">Email / webhook</option><option value="both">Both</option></select></label>
      <label class="wide">Email<input id="mRemEmail" type="email" value="${escapeHtml(r?.email || "")}" placeholder="you@example.com"></label>
    </div>
    ${modalFooter(`<button class="primary-btn" id="saveReminderModal">${r ? "Save changes" : "Create reminder"}</button>`)}`);

  $("#mRemMethod").value = r?.method || "browser";
  $("#mRemRepeat").value = r?.repeat || "none";

  $("#saveReminderModal").onclick = () => {
    const title = $("#mRemTitle").value.trim();
    if (!title) return toast("Give the reminder a title.");
    const payload = {
      title, date: $("#mRemDate").value, time: $("#mRemTime").value, repeat: $("#mRemRepeat").value,
      method: $("#mRemMethod").value, email: $("#mRemEmail").value.trim(), enabled: true
    };
    if (r) Object.assign(r, payload);
    else state.reminders.push({ id: uid("rem"), ...payload, lastTriggered: null });
    saveState(); closeModal(); renderAll();
    toast("Reminder saved.");
  };
}

/* =========================================================
   Timer (timestamp-based, survives sleep, tab switches and reloads)
========================================================= */

function timerColor() { return subjectById($("#timerSubject").value)?.color || "var(--primary)"; }

function saveTimer() {
  try {
    localStorage.setItem(TIMER_KEY, JSON.stringify({
      total: timer.total, remaining: timer.remaining, running: timer.running, endAt: timer.endAt,
      startedAt: timer.startedAt, durationMinutes: timer.durationMinutes,
      subjectId: $("#timerSubject").value, topicId: $("#timerTopic").value, note: $("#timerNote").value
    }));
  } catch {}
}

function syncRemaining() {
  if (timer.running) timer.remaining = Math.max(0, Math.round((timer.endAt - Date.now()) / 1000));
}

function tick() {
  if (!timer.running) return;
  syncRemaining();
  updateTimerDisplay();
  if (timer.remaining <= 0) finishTimer(true);
}

function updateTimerDisplay() {
  const label = `${pad(Math.floor(timer.remaining / 60))}:${pad(timer.remaining % 60)}`;
  $("#timerDisplay").textContent = label;
  $("#timerStatus").textContent = timer.running ? "Focusing" : timer.startedAt ? "Paused" : "Ready";
  $("#timerStartBtn").textContent = timer.running ? "Pause" : timer.startedAt ? "Resume" : "Start focus";

  const ring = $("#ringProgress");
  const frac = timer.total ? timer.remaining / timer.total : 1;
  ring.style.strokeDasharray = RING_C;
  ring.style.strokeDashoffset = RING_C * (1 - frac);
  ring.style.stroke = timerColor();

  const mini = $("#miniTimer");
  mini.hidden = !(timer.startedAt && currentView !== "study-room");
  mini.classList.toggle("running", timer.running);
  mini.classList.toggle("paused", !timer.running);
  $("#miniTimerTime").textContent = label;
  $("#miniTimerState").textContent = timer.running ? "Focusing" : "Paused";

  document.title = timer.running ? `${label} · StudyFlow` : "StudyFlow";

  $$(".mode-btn").forEach((b) => {
    const isPreset = ["25", "50", "90"].includes(b.dataset.duration);
    const presetMatch = isPreset && Number(b.dataset.duration) === timer.durationMinutes;
    const customMatch = b.dataset.duration === "custom" && ![25, 50, 90].includes(timer.durationMinutes);
    b.classList.toggle("active", presetMatch || customMatch);
  });
}

function setTimerMinutes(minutes) {
  stopTimer();
  timer.total = timer.remaining = minutes * 60;
  timer.durationMinutes = minutes;
  timer.startedAt = null;
  timer.endAt = null;
  saveTimer();
  updateTimerDisplay();
}

function startTimer() {
  if (timer.running) return;
  if (timer.remaining <= 0) timer.remaining = timer.total;
  timer.running = true;
  timer.startedAt = timer.startedAt || new Date().toISOString();
  timer.endAt = Date.now() + timer.remaining * 1000;
  clearInterval(timer.interval);
  timer.interval = setInterval(tick, 500);
  saveTimer();
  updateTimerDisplay();
}

function stopTimer() {
  syncRemaining();
  timer.running = false;
  clearInterval(timer.interval);
  timer.interval = null;
  saveTimer();
  updateTimerDisplay();
}

function finishTimer(auto = false) {
  if (!timer.startedAt) return;
  syncRemaining();
  const elapsed = Math.max(0, timer.total - timer.remaining);
  clearInterval(timer.interval);
  timer.interval = null;
  timer.running = false;

  const mins = Math.max(1, Math.round(elapsed / 60));
  const subjectId = $("#timerSubject").value;
  const topicId = $("#timerTopic").value || null;

  state.sessions.push({
    id: uid("sess"), date: todayISO(), createdAt: new Date().toISOString(),
    minutes: mins, subjectId, topicId, note: $("#timerNote").value.trim()
  });
  const topic = topicById(subjectId, topicId);
  if (topic) topic.minutes += mins;

  timer.remaining = timer.total;
  timer.startedAt = null;
  timer.endAt = null;
  saveState();
  saveTimer();
  updateTimerDisplay();

  if (auto) {
    try { navigator.vibrate?.([200, 100, 200]); } catch {}
    showNotif("Session complete", `${mins} minutes logged.`);
  }
  toast(auto ? `Timer complete. ${mins} minutes logged.` : `Session logged: ${mins} minutes.`);
  renderAll();
}

function logCurrentTimerSession() {
  syncRemaining();
  const elapsed = Math.max(0, timer.total - timer.remaining);
  if (!timer.startedAt || elapsed < 30) return toast("Study for at least 30 seconds before logging a session.");
  finishTimer(false);
}

function resetTimer() {
  if (timer.startedAt && !confirm("Reset the timer without logging this session?")) return;
  stopTimer();
  timer.remaining = timer.total;
  timer.startedAt = null;
  timer.endAt = null;
  saveTimer();
  updateTimerDisplay();
}

function restoreTimer() {
  try {
    const t = JSON.parse(localStorage.getItem(TIMER_KEY));
    if (!t) return;
    Object.assign(timer, { total: t.total, remaining: t.remaining, durationMinutes: t.durationMinutes, startedAt: t.startedAt, endAt: t.endAt, running: false });
    if (t.subjectId && subjectById(t.subjectId)) {
      $("#timerSubject").value = t.subjectId;
      renderTimerTopics();
      if (t.topicId) $("#timerTopic").value = t.topicId;
    }
    $("#timerNote").value = t.note || "";
    if (t.running && t.endAt) {
      timer.running = true;
      syncRemaining();
      if (timer.remaining <= 0) return finishTimer(true); // finished while you were away
      timer.interval = setInterval(tick, 500);
    }
    updateTimerDisplay();
  } catch {}
}

function quickStart25() {
  setView("study-room");
  if (!timer.startedAt) { setTimerMinutes(25); startTimer(); }
}

/* =========================================================
   Quick note from study room
========================================================= */

function saveQuickNote() {
  const body = $("#quickNote").value.trim();
  if (!body) return toast("Nothing to save yet.");
  const now = new Date().toISOString();
  state.notes.push({ id: uid("note"), title: "Quick study note", body, subjectId: $("#timerSubject").value, createdAt: now, updatedAt: now });
  $("#quickNote").value = "";
  saveState();
  renderNotes();
  toast("Note saved.");
}

/* =========================================================
   Action handler (event delegation)
========================================================= */

function handleAction(e) {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const { action, id } = el.dataset;

  switch (action) {
    case "close-modal": return closeModal();

    case "toggle-topic": {
      const t = topicById(el.dataset.subject, el.dataset.topic);
      if (t) { t.done = !t.done; saveState(); renderAll(); toast(t.done ? "Topic completed." : "Topic reopened."); }
      return;
    }
    case "add-topic": return openTopicModal(el.dataset.subject);
    case "edit-topic": return openTopicModal(el.dataset.subject, el.dataset.topic);
    case "delete-topic": {
      const subject = subjectById(el.dataset.subject), topic = topicById(el.dataset.subject, el.dataset.topic);
      if (!subject || !topic || !confirm(`Delete "${topic.name}"?`)) return;
      subject.topics = subject.topics.filter((t) => t.id !== topic.id);
      state.tasks = state.tasks.filter((task) => !(task.subjectId === subject.id && task.topicId === topic.id));
      saveState(); renderAll(); toast("Topic deleted.");
      return;
    }

    case "edit-subject": return openSubjectModal(id);
    case "delete-subject": {
      const s = subjectById(id);
      if (!confirm(`Delete ${s?.name || "this subject"}, its topics and its tasks? Your logged study time is kept.`)) return;
      state.subjects = state.subjects.filter((x) => x.id !== id);
      state.tasks = state.tasks.filter((x) => x.subjectId !== id);
      saveState(); renderAll(); toast("Subject deleted.");
      return;
    }

    case "toggle-task": {
      const t = state.tasks.find((x) => x.id === id);
      if (t) {
        t.completed = !t.completed;
        t.completedAt = t.completed ? new Date().toISOString() : null;
        saveState(); renderAll();
        toast(t.completed ? "+40 XP. Task completed." : "Task reopened.");
      }
      return;
    }
    case "edit-task": return openTaskModal(id);
    case "delete-task":
      if (!confirm("Delete this task?")) return;
      state.tasks = state.tasks.filter((x) => x.id !== id);
      saveState(); renderAll(); toast("Task deleted.");
      return;

    case "open-note": currentNoteId = id; renderNotes(); return;
    case "delete-note":
      if (!confirm("Delete this note?")) return;
      state.notes = state.notes.filter((x) => x.id !== id);
      currentNoteId = null;
      saveState(); renderNotes(); toast("Note deleted.");
      return;

    case "toggle-reminder": {
      const r = state.reminders.find((x) => x.id === id);
      if (r) { r.enabled = !r.enabled; saveState(); renderReminders(); }
      return;
    }
    case "edit-reminder": return openReminderModal(id);
    case "delete-reminder":
      state.reminders = state.reminders.filter((x) => x.id !== id);
      saveState(); renderReminders(); toast("Reminder deleted.");
      return;
  }
}

/* =========================================================
   Reminders engine
========================================================= */

function maybeTriggerReminders() {
  const now = new Date();
  const date = localISO(now), time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  state.reminders
    .filter((r) => r.enabled && r.time === time && (r.date === date || r.repeat === "daily") && r.lastTriggered !== `${date} ${time}`)
    .forEach(async (r) => {
      r.lastTriggered = `${date} ${time}`;
      if (r.method === "browser" || r.method === "both") showNotif(r.title, "Time to study.");
      if ((r.method === "email" || r.method === "both") && state.profile.emailWebhook) {
        try {
          await fetch(state.profile.emailWebhook, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "study-reminder", title: r.title, date, time: r.time, email: r.email, user: state.profile.name })
          });
          toast("Email reminder sent to webhook.");
        } catch { toast("Webhook request failed. Check the URL in Settings."); }
      }
      saveState();
    });

  maybeNotifySurvey();
}

/* =========================================================
   Export / import
========================================================= */

function downloadBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const exportJSON = () => downloadBlob(new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }), `studyflow-backup-${todayISO()}.json`);

const csvCell = (x) => `"${String(x ?? "").replace(/"/g, '""')}"`;

function exportResearchCSV() {
  const keys = ["peou1", "peou2", "pu1", "pu2", "att1", "bi1", "bi2"];
  const rows = [["created_at", ...keys]];
  state.surveys.forEach((s) => rows.push([s.createdAt, ...keys.map((k) => s[k])]));
  downloadBlob(new Blob([rows.map((r) => r.map(csvCell).join(",")).join("\n")], { type: "text/csv" }), `studyflow-tam-${todayISO()}.csv`);
}

function importJSON(file) {
  if (!confirm("Importing replaces everything currently in StudyFlow. Continue?")) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      state = normalize(JSON.parse(r.result));
      saveState();
      currentNoteId = null; editorNoteId = null;
      applyTheme(); syncSettingsUI(); renderAll();
      toast("Backup imported.");
    } catch { toast("That file is not a valid StudyFlow backup."); }
  };
  r.readAsText(file);
}

/* =========================================================
   Misc init
========================================================= */

function initTAMSelects() {
  $$("#tamForm select").forEach((sel) => {
    for (let i = 1; i <= 7; i++) sel.insertAdjacentHTML("beforeend", `<option value="${i}">${i}</option>`);
  });
}

function syncSettingsUI() {
  $("#profileName").value = state.profile.name || "Student";
  $("#dailyTarget").value = state.profile.dailyTarget || 90;
  $("#emailWebhook").value = state.profile.emailWebhook || "";
  $("#themeSelect").value = state.profile.theme || "system";
}

/* =========================================================
   Event wiring
========================================================= */

$$(".nav-btn[data-view], .tab-btn[data-view]").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
$$("[data-view-target]").forEach((b) => b.addEventListener("click", () => setView(b.dataset.viewTarget)));
document.addEventListener("click", handleAction);

$("#moreBtn").onclick = () => { $("#sidebar").classList.add("open"); $("#scrim").classList.add("show"); };
$("#scrim").onclick = closeSidebar;
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeModal(); closeSidebar(); } });

$("#addSubjectBtn").onclick = () => openSubjectModal();
$("#addTaskBtn").onclick = () => openTaskModal();
$("#quickTaskBtn").onclick = () => openTaskModal();
$("#addReminderBtn").onclick = () => openReminderModal();
$("#quickSessionBtn").onclick = quickStart25;
$("#miniTimer").onclick = () => setView("study-room");

$("#addNoteBtn").onclick = () => {
  const now = new Date().toISOString();
  const note = { id: uid("note"), title: "New note", body: "", createdAt: now, updatedAt: now, subjectId: "" };
  state.notes.push(note);
  currentNoteId = note.id;
  saveState();
  setView("notes");
  $("#editNoteBody")?.focus();
};

$("#quickTaskAddBtn").onclick = quickAddTask;
$("#quickTaskInput").addEventListener("keydown", (e) => { if (e.key === "Enter") quickAddTask(); });

// Timer controls
$("#timerSubject").onchange = () => { renderTimerTopics(); renderStudyTasks(); saveTimer(); updateTimerDisplay(); };
$("#timerTopic").onchange = saveTimer;
$("#timerNote").oninput = saveTimer;
$("#timerStartBtn").onclick = () => (timer.running ? stopTimer() : startTimer());
$("#timerResetBtn").onclick = resetTimer;
$("#timerLogBtn").onclick = logCurrentTimerSession;

$$(".mode-btn").forEach((btn) => {
  btn.onclick = () => {
    let mins;
    if (btn.dataset.duration === "custom") {
      const answer = prompt("Custom duration in minutes (5–180)", "35");
      if (answer === null) return;
      mins = Math.min(180, Math.max(5, Math.round(Number(answer)) || 35));
    } else {
      mins = Number(btn.dataset.duration);
    }
    if (timer.startedAt && !confirm("This resets the current session without logging it. Continue?")) return;
    setTimerMinutes(mins);
  };
});

$("#saveQuickNoteBtn").onclick = saveQuickNote;

$("#taskFilters").onclick = (e) => {
  const b = e.target.closest(".filter-btn");
  if (!b) return;
  $$(".filter-btn").forEach((x) => x.classList.remove("active"));
  b.classList.add("active");
  taskFilter = b.dataset.filter;
  renderTasks();
};
$("#taskSubjectFilter").onchange = (e) => { taskSubjectFilter = e.target.value; renderTasks(); };

$("#enableNotificationsBtn").onclick = async () => {
  if (!("Notification" in window)) return toast("This browser does not support notifications.");
  const p = await Notification.requestPermission();
  toast(p === "granted" ? "Notifications enabled." : "Notifications not enabled.");
  renderReminders();
  updateBadge();
};

$("#exportJsonBtn").onclick = exportJSON;
$("#exportResearchBtn").onclick = exportResearchCSV;
$("#importJsonInput").onchange = (e) => { if (e.target.files[0]) importJSON(e.target.files[0]); e.target.value = ""; };

$("#resetDataBtn").onclick = () => {
  if (!confirm("Reset ALL StudyFlow data? This cannot be undone unless you exported a backup.")) return;
  state = defaultState();
  localStorage.removeItem(TIMER_KEY);
  Object.assign(timer, { total: 1500, remaining: 1500, running: false, startedAt: null, endAt: null, durationMinutes: 25 });
  clearInterval(timer.interval);
  currentNoteId = null; editorNoteId = null;
  saveState(); applyTheme(); syncSettingsUI(); renderAll(); updateTimerDisplay();
  toast("Data reset.");
};

$("#saveSettingsBtn").onclick = () => {
  state.profile.name = $("#profileName").value.trim() || "Student";
  state.profile.dailyTarget = Math.min(600, Math.max(10, Number($("#dailyTarget").value) || 90));
  state.profile.theme = $("#themeSelect").value;
  saveState(); applyTheme(); renderAll();
  toast("Settings saved.");
};

$("#saveWebhookBtn").onclick = () => {
  state.profile.emailWebhook = $("#emailWebhook").value.trim();
  saveState();
  toast("Webhook saved.");
};

$("#themeSelect").onchange = () => { state.profile.theme = $("#themeSelect").value; saveState(); applyTheme(); };

$("#modalBackdrop").onclick = (e) => { if (e.target.id === "modalBackdrop") closeModal(); };

$("#tamForm").onsubmit = (e) => {
  e.preventDefault();
  const item = { id: uid("survey"), createdAt: new Date().toISOString() };
  for (const [k, v] of new FormData(e.target).entries()) item[k] = Number(v);
  state.surveys.push(item);
  state.profile.surveyReminderNotifiedAt = null;
  saveState();
  e.target.reset();
  renderResearch();
  toast("Survey saved. Next one is due in 7 days.");
};

// Install button
let deferredInstall = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstall = e;
  $("#installBtn").hidden = false;
});
$("#installBtn").onclick = async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  await deferredInstall.userChoice;
  deferredInstall = null;
  $("#installBtn").hidden = true;
};

// Keep the timer honest when the tab/app comes back to the foreground
document.addEventListener("visibilitychange", () => { if (!document.hidden) { tick(); maybeTriggerReminders(); updateBadge(); } });
window.addEventListener("pagehide", saveTimer);

/* =========================================================
   Boot
========================================================= */

function boot() {
  applyTheme();
  initTAMSelects();
  syncSettingsUI();
  renderAll();
  restoreTimer();
  updateTimerDisplay();
  updateBadge();
  maybeTriggerReminders();
  setInterval(maybeTriggerReminders, 30000);
  setInterval(() => { renderDashboard(); updateSidebarLevel(); updateBadge(); }, 60000);

  navigator.storage?.persist?.();
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  // Homescreen shortcuts: ?action=add-task / ?action=start
  const action = new URLSearchParams(location.search).get("action");
  if (action === "add-task") { setView("tasks"); $("#quickTaskInput").focus(); }
  if (action === "start") quickStart25();
  if (action) history.replaceState({}, "", location.pathname);
}

boot();
