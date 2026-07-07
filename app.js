// --- Data model -------------------------------------------------------
// A "session" is { id, start: <ms>, end: <ms|null>, category: <string>, subcategory: <string>, detail: <string> }
// end === null means the session is currently running.

const STORAGE_KEY = "time-tracker-sessions";
const CATEGORIES_KEY = "time-tracker-categories";

function loadSessions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSessions(sessions) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

function loadCategories() {
  try {
    const raw = localStorage.getItem(CATEGORIES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCategories(categories) {
  localStorage.setItem(CATEGORIES_KEY, JSON.stringify(categories));
}

let sessions = loadSessions();
let categories = loadCategories();

// --- Elements -----------------------------------------------------------

const categoryButtonsEl = document.getElementById("category-buttons");
const addCategoryFormEl = document.getElementById("add-category-form");
const newCategoryInputEl = document.getElementById("new-category-input");
const liveTimerEl = document.getElementById("live-timer");
const currentCategoryEl = document.getElementById("current-category");
const sessionListEl = document.getElementById("session-list");
const emptyStateEl = document.getElementById("empty-state");
const todayTotalEl = document.getElementById("today-total");
const todayDateEl = document.getElementById("today-date");

// Modal elements
const modalEl = document.getElementById("subcategory-modal");
const modalCategoryTitleEl = document.getElementById("modal-category-title");
const commonSubcategoriesListEl = document.getElementById("common-subcategories-list");
const newSubcategoryFormEl = document.getElementById("new-subcategory-form");
const newSubcategoryInputEl = document.getElementById("new-subcategory-input");
const detailInputEl = document.getElementById("detail-input");
const startSessionBtnEl = document.getElementById("start-session-btn");
const modalCloseBtnEl = document.getElementById("modal-close-btn");

// --- Helpers --------------------------------------------------------------

function getRunningSession() {
  return sessions.find((s) => s.end === null) || null;
}

function formatClock(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

function formatDuration(ms) {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function formatTimeOfDay(ms) {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function isSameDay(a, b) {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

function getCommonSubcategoriesForCategory(category) {
  // Get the most recently used subcategories for this category
  const categorySessionsReversed = sessions
    .filter((s) => s.category === category)
    .reverse();

  const subcategoryOrder = [];
  const seen = new Set();

  for (const session of categorySessionsReversed) {
    if (session.subcategory && !seen.has(session.subcategory)) {
      subcategoryOrder.push(session.subcategory);
      seen.add(session.subcategory);
      if (subcategoryOrder.length >= 3) break;
    }
  }

  return subcategoryOrder;
}

// --- Modal Logic -------------------------------------------------------

let pendingCategoryForModal = null;
let selectedSubcategoryForModal = null;
let isEditingRunningSession = false;

function openSubcategoryModal(category) {
  const running = getRunningSession();
  const isRunningCategory = running && running.category === category;

  pendingCategoryForModal = category;
  selectedSubcategoryForModal = isRunningCategory ? running.subcategory : null;
  detailInputEl.value = isRunningCategory ? running.detail : "";
  newSubcategoryInputEl.value = "";
  isEditingRunningSession = isRunningCategory;

  // Update button text
  startSessionBtnEl.textContent = isEditingRunningSession ? "Update" : "Start";

  modalCategoryTitleEl.textContent = category;

  // Show common subcategories
  const commonSubcategories = getCommonSubcategoriesForCategory(category);
  commonSubcategoriesListEl.innerHTML = "";

  for (const subcategory of commonSubcategories) {
    const btn = document.createElement("button");
    btn.className = "subcategory-btn";
    btn.type = "button";
    btn.textContent = subcategory;
    if (isRunningCategory && subcategory === running.subcategory) {
      btn.classList.add("selected");
    }
    btn.addEventListener("click", () => selectSubcategory(subcategory));
    commonSubcategoriesListEl.appendChild(btn);
  }

  modalEl.classList.remove("hidden");
}

function closeSubcategoryModal() {
  modalEl.classList.add("hidden");
  pendingCategoryForModal = null;
  selectedSubcategoryForModal = null;
}

function selectSubcategory(subcategory) {
  selectedSubcategoryForModal = subcategory;

  // Update UI to show selection
  const buttons = commonSubcategoriesListEl.querySelectorAll(".subcategory-btn");
  buttons.forEach((btn) => {
    if (btn.textContent === subcategory) {
      btn.classList.add("selected");
    } else {
      btn.classList.remove("selected");
    }
  });
}

function startSessionFromModal() {
  if (!pendingCategoryForModal) {
    return;
  }

  const detail = detailInputEl.value.trim();

  if (isEditingRunningSession) {
    // Update the running session
    const running = getRunningSession();
    if (running) {
      running.subcategory = selectedSubcategoryForModal || "";
      running.detail = detail;
      saveSessions(sessions);
    }
  } else {
    // Create new session
    const running = getRunningSession();
    const now = Date.now();

    // Stop any running session
    if (running) {
      running.end = now;
    }

    // Start new session
    sessions.push({
      id: crypto.randomUUID(),
      start: now,
      end: null,
      category: pendingCategoryForModal,
      subcategory: selectedSubcategoryForModal || "",
      detail: detail,
    });

    saveSessions(sessions);
  }

  closeSubcategoryModal();
  render();
}

// --- Rendering --------------------------------------------------------

function renderCategories() {
  categoryButtonsEl.innerHTML = "";
  const running = getRunningSession();

  for (const cat of categories) {
    const btn = document.createElement("button");
    btn.className = "category-btn";
    if (running && running.category === cat) {
      btn.classList.add("active");
    }
    btn.textContent = cat;
    btn.addEventListener("click", () => openSubcategoryModal(cat));
    categoryButtonsEl.appendChild(btn);
  }
}

function render() {
  const running = getRunningSession();

  // Update current category display
  if (running) {
    const subtitle = running.subcategory ? ` / ${running.subcategory}` : "";
    currentCategoryEl.textContent = running.category + subtitle;
  } else {
    currentCategoryEl.textContent = "—";
  }

  renderCategories();

  // Today's sessions, newest first
  const now = Date.now();
  const todaySessions = sessions
    .filter((s) => isSameDay(s.start, now))
    .slice()
    .reverse();

  sessionListEl.innerHTML = "";
  emptyStateEl.style.display = todaySessions.length === 0 ? "block" : "none";

  for (const s of todaySessions) {
    const li = document.createElement("li");
    li.className = "session-item" + (s.end === null ? " running" : "");

    const range = document.createElement("span");
    range.className = "time-range";
    range.textContent = s.end
      ? `${formatTimeOfDay(s.start)} – ${formatTimeOfDay(s.end)}`
      : `${formatTimeOfDay(s.start)} – now`;

    const duration = document.createElement("span");
    duration.className = "duration";
    duration.dataset.start = s.start;
    duration.dataset.running = s.end === null ? "1" : "0";
    duration.textContent = formatDuration((s.end ?? now) - s.start);

    const meta = document.createElement("span");
    meta.style.fontSize = "12px";
    meta.style.color = "var(--text-dim)";
    meta.style.flexBasis = "100%";
    const metaText = [s.category, s.subcategory, s.detail].filter(Boolean).join(" • ");
    meta.textContent = metaText || s.category;

    li.appendChild(meta);
    li.appendChild(range);
    li.appendChild(duration);
    sessionListEl.appendChild(li);
  }

  // Today's total
  const totalMs = todaySessions.reduce(
    (sum, s) => sum + ((s.end ?? now) - s.start),
    0
  );
  todayTotalEl.textContent = formatDuration(totalMs);
}

// --- Ticking --------------------------------------------------------

function tick() {
  const running = getRunningSession();
  const now = Date.now();

  if (running) {
    liveTimerEl.textContent = formatClock(now - running.start);

    // Keep the "now" duration on the running list item fresh too.
    const runningDurationEl = sessionListEl.querySelector(
      '.duration[data-running="1"]'
    );
    if (runningDurationEl) {
      const start = Number(runningDurationEl.dataset.start);
      runningDurationEl.textContent = formatDuration(now - start);
    }

    // Update today's total
    const totalMs = sessions
      .filter((s) => isSameDay(s.start, now))
      .reduce((sum, s) => sum + ((s.end ?? now) - s.start), 0);
    todayTotalEl.textContent = formatDuration(totalMs);
  } else {
    liveTimerEl.textContent = "00:00:00";
  }
}

setInterval(tick, 1000);

// --- Actions -------------------------------------------------------

function addCategory() {
  const name = newCategoryInputEl.value.trim();
  if (!name) return;
  if (categories.includes(name)) {
    newCategoryInputEl.value = "";
    return;
  }

  categories.push(name);
  saveCategories(categories);
  newCategoryInputEl.value = "";
  render();
}

addCategoryFormEl.addEventListener("submit", (e) => {
  e.preventDefault();
  addCategory();
});

// Modal actions
newSubcategoryFormEl.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = newSubcategoryInputEl.value.trim();
  if (!name) return;
  selectSubcategory(name);
});

startSessionBtnEl.addEventListener("click", startSessionFromModal);
modalCloseBtnEl.addEventListener("click", closeSubcategoryModal);

// Close modal on backdrop click
modalEl.addEventListener("click", (e) => {
  if (e.target === modalEl) {
    closeSubcategoryModal();
  }
});

// --- Header date ----------------------------------------------------------

todayDateEl.textContent = new Date().toLocaleDateString(undefined, {
  weekday: "long",
  month: "short",
  day: "numeric",
});

// --- Init -----------------------------------------------------------------

render();
