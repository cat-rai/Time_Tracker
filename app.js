// --- Data model -------------------------------------------------------
// A "session" is { id, start: <ms>, end: <ms|null>, categoryId, group: "activity"|"state", subcategory, detail }
// end === null means the session is currently running.
// Activities are mutually exclusive (starting one stops any other running activity).
// States are independent — any number can run concurrently, and never affect Activities.

const STORAGE_KEY = "time-tracker-sessions";
const CATEGORIES_KEY = "time-tracker-categories";

// Validated categorical palette (see dataviz skill's validate_palette.js):
// passes lightness/chroma/CVD/contrast checks against this app's actual
// dark (#181b21) and light (#f5f6f8) surfaces. Slots are assigned in a
// fixed order per category (never re-cycled by render position), scoped
// independently per group so Activities and States each use the full set.
const CATEGORY_COLORS_DARK = [
  "#3987e5", "#199e70", "#c98500", "#008300",
  "#9085e9", "#e66767", "#d55181", "#d95926",
];
const CATEGORY_COLORS_LIGHT = [
  "#2a78d6", "#1baf7a", "#eda100", "#008300",
  "#4a3aa7", "#e34948", "#e87ba4", "#eb6834",
];
const CATEGORY_PALETTE_SIZE = CATEGORY_COLORS_DARK.length;

function getCategoryPalette() {
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? CATEGORY_COLORS_DARK
    : CATEGORY_COLORS_LIGHT;
}

function shadeColor(hex, percent) {
  // percent > 0 lightens toward white, < 0 darkens toward black
  const num = parseInt(hex.slice(1), 16);
  let r = (num >> 16) & 0xff;
  let g = (num >> 8) & 0xff;
  let b = num & 0xff;
  const target = percent > 0 ? 255 : 0;
  const amount = Math.abs(percent);
  r = Math.round(r + (target - r) * amount);
  g = Math.round(g + (target - g) * amount);
  b = Math.round(b + (target - b) * amount);
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function loadSessions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : [];
    // Backfill group on historical sessions (all pre-existing data is Activities)
    return data.map((s) => (s.group ? s : { ...s, group: "activity" }));
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
    const data = raw ? JSON.parse(raw) : [];
    const perGroupCount = { activity: 0, state: 0 };
    // Ensure all categories have id, label, group, and a fixed color slot
    return data.map((cat) => {
      const normalized = typeof cat === "string" ? { id: cat, label: cat } : cat;
      if (!normalized.group) normalized.group = "activity";
      if (typeof normalized.colorSlot !== "number") {
        normalized.colorSlot = perGroupCount[normalized.group] % CATEGORY_PALETTE_SIZE;
      }
      perGroupCount[normalized.group] = (perGroupCount[normalized.group] || 0) + 1;
      return normalized;
    });
  } catch {
    return [];
  }
}

function saveCategories(categories) {
  localStorage.setItem(CATEGORIES_KEY, JSON.stringify(categories));
}

function migrateCategories() {
  // Convert old string-based categories to objects with IDs
  const oldCategories = loadCategories();
  const sessions = loadSessions();

  // Create a map of old category strings to new category objects
  const categoryMap = {};
  const newCategories = [];

  // Get unique categories from existing data
  const uniqueCategories = new Set();
  for (const session of sessions) {
    if (session.category) {
      uniqueCategories.add(session.category);
    }
  }

  // Convert to objects with IDs
  for (const categoryStr of uniqueCategories) {
    const catObj = oldCategories.find(c => c.id === categoryStr || (c.label || c) === categoryStr) ||
                   { id: categoryStr, label: categoryStr, group: "activity" };
    if (!catObj.id) catObj.id = categoryStr;
    if (!catObj.label) catObj.label = categoryStr;
    if (!catObj.group) catObj.group = "activity";
    newCategories.push(catObj);
    categoryMap[categoryStr] = catObj.id;
  }

  // Merge in any categories that already exist as objects but had no legacy sessions
  for (const cat of oldCategories) {
    if (!newCategories.some((c) => c.id === cat.id)) {
      newCategories.push(cat);
    }
  }

  // Update sessions to use categoryId instead of category
  for (const session of sessions) {
    if (session.category && !session.categoryId) {
      session.categoryId = categoryMap[session.category] || session.category;
      // Keep category for backwards compat, but it's now the ID
    }
  }

  saveCategories(newCategories);
  saveSessions(sessions);
}

let sessions = loadSessions();
let categories = loadCategories();
migrateCategories();

// --- Elements -----------------------------------------------------------

const liveTimerEl = document.getElementById("live-timer");
const currentCategoryEl = document.getElementById("current-category");
const todayDateEl = document.getElementById("today-date");

// Edit category modal elements
const editModalEl = document.getElementById("edit-category-modal");
const editCategoryInputEl = document.getElementById("edit-category-input");
const editCategorySaveBtn = document.getElementById("edit-category-save");
const editCategoryCancelBtn = document.getElementById("edit-category-cancel");
const editModalCloseBtnEl = document.getElementById("edit-modal-close-btn");
let editingCategoryId = null;

// Edit session modal elements
const editSessionModalEl = document.getElementById("edit-session-modal");
const editSessionCategoryEl = document.getElementById("edit-session-category");
const editSessionStartEl = document.getElementById("edit-session-start");
const editSessionEndEl = document.getElementById("edit-session-end");
const editSessionDurationEl = document.getElementById("edit-session-duration");
const editSessionSubcategoryEl = document.getElementById("edit-session-subcategory");
const editSessionDetailEl = document.getElementById("edit-session-detail");
const editSessionSaveBtn = document.getElementById("edit-session-save");
const editSessionDeleteBtn = document.getElementById("edit-session-delete");
const editSessionCancelBtn = document.getElementById("edit-session-cancel");
const editSessionCloseBtnEl = document.getElementById("edit-session-close-btn");
let editingSessionId = null;

// --- Group registry -------------------------------------------------------
// Each group (Activities / States) owns its own buttons, chart, and log.
// Activities are exclusive (one running at a time); States are independent
// (any number can run concurrently, toggled individually).

function buildGroupConfig(key, sectionId, chartSectionId, logSectionId) {
  const sectionEl = document.getElementById(sectionId);
  const chartSectionEl = document.getElementById(chartSectionId);
  const logSectionEl = document.getElementById(logSectionId);
  const categoriesSectionEl = sectionEl.querySelector(":scope > .categories-section");

  return {
    key,
    exclusive: key === "activity",
    sectionEl,
    mainButtonsEl: categoriesSectionEl.querySelector(":scope > .category-buttons"),
    toggleMoreBtn: categoriesSectionEl.querySelector(".toggle-more-btn"),
    moreSectionEl: categoriesSectionEl.querySelector(".more-categories-section"),
    moreButtonsEl: categoriesSectionEl.querySelector(".more-categories-section .category-buttons"),
    addFormEl: categoriesSectionEl.querySelector(".add-category-form"),
    addInputEl: categoriesSectionEl.querySelector(".add-category-form input"),
    chartSectionEl,
    svgEl: chartSectionEl.querySelector("svg"),
    legendEl: chartSectionEl.querySelector(".chart-legend"),
    pickerEl: chartSectionEl.querySelector(".subcategory-picker"),
    chartHeaderEl: chartSectionEl.querySelector(".collapsible-header"),
    chartContentEl: chartSectionEl.querySelector(".collapsible-content"),
    logSectionEl,
    listEl: logSectionEl.querySelector(".session-list"),
    totalEl: logSectionEl.querySelector(".log-total"),
    emptyEl: logSectionEl.querySelector(".empty-state"),
    logHeaderEl: logSectionEl.querySelector(".collapsible-header"),
    logContentEl: logSectionEl.querySelector(".collapsible-content"),
    chartType: "pie",
    chartViewMode: "category",
    selectedCategoryId: null,
  };
}

const GROUPS = {
  activity: buildGroupConfig("activity", "activities-group", "activities-chart-section", "activities-log-section"),
  state: buildGroupConfig("state", "states-group", "states-chart-section", "states-log-section"),
};

// --- Helpers --------------------------------------------------------------

function getRunningSessionsForGroup(group) {
  return sessions.filter((s) => s.end === null && (s.group || "activity") === group);
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

function getCategoryLabel(categoryId) {
  const cat = categories.find(c => c.id === categoryId);
  return cat ? cat.label : categoryId;
}

function getCategoryColor(categoryId) {
  const cat = categories.find(c => c.id === categoryId);
  const palette = getCategoryPalette();
  const slot = cat && typeof cat.colorSlot === "number" ? cat.colorSlot : 0;
  return palette[slot % palette.length];
}

function editCategoryLabel(categoryId, newLabel) {
  const cat = categories.find(c => c.id === categoryId);
  if (cat && newLabel.trim()) {
    cat.label = newLabel.trim();
    saveCategories(categories);
    render();
  }
}

function getCategoriesSortedByRecency(categoryList) {
  // Sort categories by most recent session (returns a new sorted array)
  const categoryLastUsed = {};

  for (const session of sessions) {
    const catId = session.categoryId || session.category;
    if (!categoryLastUsed[catId] || session.start > categoryLastUsed[catId]) {
      categoryLastUsed[catId] = session.start;
    }
  }

  return [...categoryList].sort((a, b) => {
    const aTime = categoryLastUsed[a.id] || 0;
    const bTime = categoryLastUsed[b.id] || 0;
    return bTime - aTime;
  });
}

// --- Chart functions -----------------------------------------------

function getAggregatedData(group, mode, selectedCategoryId) {
  const now = Date.now();
  const todaySessions = sessions.filter(
    (s) => isSameDay(s.start, now) && (s.group || "activity") === group
  );

  if (mode === "category") {
    const data = {};
    for (const session of todaySessions) {
      const categoryId = session.categoryId || session.category;
      const categoryLabel = getCategoryLabel(categoryId);
      const duration = (session.end ?? now) - session.start;
      if (!data[categoryLabel]) {
        data[categoryLabel] = { ms: 0, categoryId };
      }
      data[categoryLabel].ms += duration;
    }
    return Object.entries(data).map(([label, d]) => ({
      label,
      ms: d.ms,
      color: getCategoryColor(d.categoryId),
    }));
  } else {
    // "subcategory" mode: scoped to one selected category only, so we're
    // comparing that category's own breakdown, not every category at once.
    if (!selectedCategoryId) return [];
    const relevant = todaySessions.filter(
      (s) => (s.categoryId || s.category) === selectedCategoryId
    );
    const data = {};
    for (const session of relevant) {
      const key = session.subcategory || "General";
      const duration = (session.end ?? now) - session.start;
      data[key] = (data[key] || 0) + duration;
    }
    const baseColor = getCategoryColor(selectedCategoryId);
    return Object.entries(data).map(([label, ms], i) => ({
      label,
      ms,
      color: i === 0 ? baseColor : shadeColor(baseColor, i % 2 === 1 ? 0.25 * Math.ceil(i / 2) : -0.25 * (i / 2)),
    }));
  }
}

function renderPieChart(group) {
  const g = GROUPS[group];
  const data = getAggregatedData(group, g.chartViewMode, g.selectedCategoryId);

  const total = data.reduce((sum, d) => sum + d.ms, 0);
  if (data.length === 0 || total === 0) {
    g.svgEl.innerHTML = "<text x='200' y='200' text-anchor='middle' fill='var(--text-dim)'>No data yet</text>";
    g.legendEl.innerHTML = "";
    return;
  }

  // Calculate percentages
  const slices = data.map((d) => ({
    ...d,
    percent: (d.ms / total) * 100,
  }));

  // Draw pie chart
  const svg = g.svgEl;
  svg.innerHTML = "";
  const centerX = 200, centerY = 200, radius = 150;

  let currentAngle = -Math.PI / 2; // Start at top

  for (const slice of slices) {
    const sliceAngle = (slice.percent / 100) * 2 * Math.PI;
    const endAngle = currentAngle + sliceAngle;

    const x1 = centerX + radius * Math.cos(currentAngle);
    const y1 = centerY + radius * Math.sin(currentAngle);
    const x2 = centerX + radius * Math.cos(endAngle);
    const y2 = centerY + radius * Math.sin(endAngle);

    const largeArc = sliceAngle > Math.PI ? 1 : 0;

    const pathData = [
      `M ${centerX} ${centerY}`,
      `L ${x1} ${y1}`,
      `A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`,
      "Z",
    ].join(" ");

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    path.setAttribute("fill", slice.color);
    path.setAttribute("stroke", "var(--bg)");
    path.setAttribute("stroke-width", "2");
    svg.appendChild(path);

    currentAngle = endAngle;
  }

  renderChartLegend(g.legendEl, slices);
}

function renderBarChart(group) {
  const g = GROUPS[group];
  const data = getAggregatedData(group, g.chartViewMode, g.selectedCategoryId);

  const total = data.reduce((sum, d) => sum + d.ms, 0);
  if (data.length === 0 || total === 0) {
    g.svgEl.innerHTML = "<text x='200' y='200' text-anchor='middle' fill='var(--text-dim)'>No data yet</text>";
    g.legendEl.innerHTML = "";
    return;
  }

  const bars = data.map((d) => ({
    ...d,
    percent: (d.ms / total) * 100,
  }));

  // Draw bar chart
  const svg = g.svgEl;
  svg.innerHTML = "";
  svg.setAttribute("viewBox", "0 0 400 300");

  const chartWidth = 350;
  const chartHeight = 200;
  const padding = 40;
  const barSpacing = chartWidth / bars.length;
  const barWidth = barSpacing * 0.8;

  // Draw bars
  bars.forEach((bar, i) => {
    const barHeight = (bar.percent / 100) * chartHeight;
    const x = padding + i * barSpacing + (barSpacing - barWidth) / 2;
    const y = padding + chartHeight - barHeight;

    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", x);
    rect.setAttribute("y", y);
    rect.setAttribute("width", barWidth);
    rect.setAttribute("height", barHeight);
    rect.setAttribute("fill", bar.color);
    svg.appendChild(rect);
  });

  renderChartLegend(g.legendEl, bars);
}

function renderChartLegend(legendEl, items) {
  legendEl.innerHTML = "";
  for (const item of items) {
    const div = document.createElement("div");
    div.className = "legend-item";

    const colorBox = document.createElement("div");
    colorBox.className = "legend-color";
    colorBox.style.backgroundColor = item.color;

    const label = document.createElement("span");
    label.className = "legend-label";
    label.textContent = item.label;

    const time = document.createElement("span");
    time.className = "legend-time";
    time.textContent = formatDuration(item.ms);

    div.appendChild(colorBox);
    div.appendChild(label);
    div.appendChild(time);
    legendEl.appendChild(div);
  }
}

function renderChart(group) {
  const g = GROUPS[group];
  if (g.chartType === "pie") {
    renderPieChart(group);
  } else {
    renderBarChart(group);
  }
}

function populateSubcategoryPicker(group) {
  const g = GROUPS[group];
  const groupCategories = categories.filter((c) => c.group === group);
  const sorted = getCategoriesSortedByRecency(groupCategories);

  g.pickerEl.innerHTML = "";
  for (const cat of sorted) {
    const opt = document.createElement("option");
    opt.value = cat.id;
    opt.textContent = cat.label;
    g.pickerEl.appendChild(opt);
  }

  if (!g.selectedCategoryId || !sorted.some((c) => c.id === g.selectedCategoryId)) {
    g.selectedCategoryId = sorted[0] ? sorted[0].id : null;
  }
  g.pickerEl.value = g.selectedCategoryId || "";
}

// --- Actions -------------------------------------------------------

function toggleActivity(cat) {
  const now = Date.now();
  const running = getRunningSessionsForGroup("activity")[0] || null;

  if (running && running.categoryId === cat.id) {
    // Toggle off: stop the running activity
    running.end = now;
  } else {
    // Stop whatever activity was running, then start this one
    if (running) running.end = now;
    sessions.push({
      id: crypto.randomUUID(),
      start: now,
      end: null,
      categoryId: cat.id,
      category: cat.id,
      group: "activity",
      subcategory: "",
      detail: "",
    });
  }
  saveSessions(sessions);
  render();
}

function toggleState(cat) {
  const now = Date.now();
  const running = sessions.find(
    (s) => s.end === null && (s.group || "activity") === "state" && s.categoryId === cat.id
  );

  if (running) {
    // Toggle off: stop only this state's own session
    running.end = now;
  } else {
    // Start this state independently — no other session is affected
    sessions.push({
      id: crypto.randomUUID(),
      start: now,
      end: null,
      categoryId: cat.id,
      category: cat.id,
      group: "state",
      subcategory: "",
      detail: "",
    });
  }
  saveSessions(sessions);
  render();
}

function addCategory(group, inputEl) {
  const name = inputEl.value.trim();
  if (!name) return;
  if (categories.some((c) => c.label === name && c.group === group)) {
    inputEl.value = "";
    return;
  }

  const countInGroup = categories.filter((c) => c.group === group).length;
  categories.push({
    id: crypto.randomUUID(),
    label: name,
    group,
    colorSlot: countInGroup % CATEGORY_PALETTE_SIZE,
  });
  saveCategories(categories);
  inputEl.value = "";
  render();
}

// --- Rendering --------------------------------------------------------

function renderCategoryButtons(group, containerEl, categoriesToRender) {
  containerEl.innerHTML = "";
  const runningActivity = group === "activity" ? getRunningSessionsForGroup("activity")[0] || null : null;

  for (const cat of categoriesToRender) {
    const runningSession = group === "activity"
      ? (runningActivity && runningActivity.categoryId === cat.id ? runningActivity : null)
      : sessions.find((s) => s.end === null && (s.group || "activity") === "state" && s.categoryId === cat.id) || null;

    const wrapper = document.createElement("div");
    wrapper.className = "category-btn-wrapper";
    wrapper.style.position = "relative";
    wrapper.style.display = "inline-block";
    wrapper.style.marginRight = "8px";

    const btn = document.createElement("button");
    btn.className = "category-btn";
    if (runningSession) {
      btn.classList.add("active");
    }

    const dot = document.createElement("span");
    dot.className = "category-color-dot";
    dot.style.backgroundColor = getCategoryColor(cat.id);
    btn.appendChild(dot);
    btn.appendChild(document.createTextNode(cat.label));

    if (group === "state" && runningSession) {
      const badge = document.createElement("span");
      badge.className = "state-duration";
      badge.dataset.start = runningSession.start;
      badge.textContent = formatClock(Date.now() - runningSession.start);
      btn.appendChild(badge);
    }

    btn.addEventListener("click", () => {
      if (group === "activity") {
        toggleActivity(cat);
      } else {
        toggleState(cat);
      }
    });
    wrapper.appendChild(btn);

    // Edit button - create as a proper button with click handler
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "category-edit-btn";
    editBtn.textContent = "✎";
    editBtn.title = "Edit category name";
    editBtn.style.position = "absolute";
    editBtn.style.top = "2px";
    editBtn.style.right = "2px";
    editBtn.style.width = "20px";
    editBtn.style.height = "20px";
    editBtn.style.minWidth = "20px";
    editBtn.style.padding = "2px";
    editBtn.style.fontSize = "11px";
    editBtn.style.border = "1px solid var(--accent)";
    editBtn.style.borderRadius = "3px";
    editBtn.style.background = "var(--surface)";
    editBtn.style.color = "var(--text)";
    editBtn.style.cursor = "pointer";
    editBtn.style.display = "none";
    editBtn.style.opacity = "0.7";
    editBtn.style.zIndex = "10";

    // Store category info on the button for easy access
    editBtn.dataset.categoryId = cat.id;
    editBtn.dataset.categoryLabel = cat.label;

    wrapper.addEventListener("mouseenter", () => {
      editBtn.style.display = "block";
    });

    wrapper.addEventListener("mouseleave", () => {
      editBtn.style.display = "none";
    });

    wrapper.appendChild(editBtn);
    containerEl.appendChild(wrapper);
  }
}

function renderCategoriesForGroup(group) {
  const g = GROUPS[group];
  const groupCategories = categories.filter((c) => c.group === group);
  const sorted = getCategoriesSortedByRecency(groupCategories);
  const recentCategories = sorted.slice(0, 4);
  const olderCategories = sorted.slice(4);

  renderCategoryButtons(group, g.mainButtonsEl, recentCategories);

  g.toggleMoreBtn.style.display = olderCategories.length > 0 ? "block" : "none";

  renderCategoryButtons(group, g.moreButtonsEl, olderCategories);
}

function closeEditModal() {
  editModalEl.classList.add("hidden");
  editingCategoryId = null;
  editCategoryInputEl.value = "";
}

function saveEditCategory() {
  if (editingCategoryId) {
    const newLabel = editCategoryInputEl.value.trim();
    if (newLabel) {
      editCategoryLabel(editingCategoryId, newLabel);
    }
  }
  closeEditModal();
}

function openEditSessionModal(sessionId) {
  const session = sessions.find(s => s.id === sessionId);
  if (!session) return;

  editingSessionId = sessionId;

  // Set category
  const categoryLabel = getCategoryLabel(session.categoryId || session.category);
  editSessionCategoryEl.textContent = categoryLabel;

  // Set times (convert ms to HH:MM format)
  const startDate = new Date(session.start);
  const endDate = new Date(session.end || Date.now());

  editSessionStartEl.value = startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }).substring(0, 5);
  editSessionEndEl.value = endDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }).substring(0, 5);

  // Set subcategory and detail
  editSessionSubcategoryEl.value = session.subcategory || "";
  editSessionDetailEl.value = session.detail || "";

  // Update duration display
  updateSessionDurationDisplay();

  editSessionModalEl.classList.remove("hidden");
}

function closeEditSessionModal() {
  editSessionModalEl.classList.add("hidden");
  editingSessionId = null;
}

function updateSessionDurationDisplay() {
  if (!editingSessionId) return;

  const session = sessions.find(s => s.id === editingSessionId);
  if (!session) return;

  // Get the times from input fields and calculate duration
  const startStr = editSessionStartEl.value;
  const endStr = editSessionEndEl.value;

  if (startStr && endStr) {
    // Parse times
    const [startH, startM] = startStr.split(':').map(Number);
    const [endH, endM] = endStr.split(':').map(Number);

    let startMs = startH * 3600000 + startM * 60000;
    let endMs = endH * 3600000 + endM * 60000;

    // Handle case where end time is next day
    if (endMs < startMs) {
      endMs += 24 * 3600000;
    }

    const durationMs = endMs - startMs;
    editSessionDurationEl.textContent = formatDuration(durationMs);
  }
}

function saveEditSession() {
  if (!editingSessionId) return;

  const session = sessions.find(s => s.id === editingSessionId);
  if (!session) return;

  // Parse and set times
  const startStr = editSessionStartEl.value;
  const endStr = editSessionEndEl.value;

  if (startStr && endStr) {
    const today = new Date();
    const [startH, startM] = startStr.split(':').map(Number);
    const [endH, endM] = endStr.split(':').map(Number);

    const startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), startH, startM);
    let endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), endH, endM);

    // Handle case where end time is next day
    if (endDate < startDate) {
      endDate.setDate(endDate.getDate() + 1);
    }

    session.start = startDate.getTime();
    session.end = endDate.getTime();
  }

  // Update subcategory and detail
  session.subcategory = editSessionSubcategoryEl.value.trim();
  session.detail = editSessionDetailEl.value.trim();

  saveSessions(sessions);
  closeEditSessionModal();
  render();
}

function deleteEditSession() {
  if (!editingSessionId) return;

  if (confirm("Delete this session?")) {
    sessions = sessions.filter(s => s.id !== editingSessionId);
    saveSessions(sessions);
    closeEditSessionModal();
    render();
  }
}

function renderLog(group) {
  const g = GROUPS[group];
  const now = Date.now();
  const todaySessions = sessions
    .filter((s) => isSameDay(s.start, now) && (s.group || "activity") === group)
    .slice()
    .reverse();

  g.listEl.innerHTML = "";
  g.emptyEl.style.display = todaySessions.length === 0 ? "block" : "none";

  for (const s of todaySessions) {
    const li = document.createElement("li");
    li.className = "session-item" + (s.end === null ? " running" : "");
    li.style.cursor = "pointer";
    li.dataset.sessionId = s.id;

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
    const categoryLabel = getCategoryLabel(s.categoryId || s.category);
    const metaText = [categoryLabel, s.subcategory, s.detail].filter(Boolean).join(" • ");
    meta.textContent = metaText || categoryLabel;

    li.appendChild(meta);
    li.appendChild(range);
    li.appendChild(duration);
    g.listEl.appendChild(li);
  }

  const totalMs = todaySessions.reduce(
    (sum, s) => sum + ((s.end ?? now) - s.start),
    0
  );
  g.totalEl.textContent = formatDuration(totalMs);
}

function render() {
  const runningActivity = getRunningSessionsForGroup("activity")[0] || null;

  // Update current activity display
  if (runningActivity) {
    const categoryLabel = getCategoryLabel(runningActivity.categoryId || runningActivity.category);
    const subtitle = runningActivity.subcategory ? ` / ${runningActivity.subcategory}` : "";
    currentCategoryEl.textContent = categoryLabel + subtitle;
  } else {
    currentCategoryEl.textContent = "—";
  }

  renderCategoriesForGroup("activity");
  renderCategoriesForGroup("state");
  renderChart("activity");
  renderChart("state");
  renderLog("activity");
  renderLog("state");
}

// --- Ticking --------------------------------------------------------

function tick() {
  const now = Date.now();
  const runningActivity = getRunningSessionsForGroup("activity")[0] || null;

  if (runningActivity) {
    liveTimerEl.textContent = formatClock(now - runningActivity.start);
  } else {
    liveTimerEl.textContent = "00:00:00";
  }

  // Keep every currently-running row fresh (an Activity plus any number of States)
  document.querySelectorAll('.duration[data-running="1"]').forEach((el) => {
    const start = Number(el.dataset.start);
    el.textContent = formatDuration(now - start);
  });

  // Keep each active State button's own live badge fresh
  document.querySelectorAll(".state-duration").forEach((el) => {
    const start = Number(el.dataset.start);
    el.textContent = formatClock(now - start);
  });

  // Keep both groups' totals fresh
  for (const group of ["activity", "state"]) {
    const g = GROUPS[group];
    const totalMs = sessions
      .filter((s) => isSameDay(s.start, now) && (s.group || "activity") === group)
      .reduce((sum, s) => sum + ((s.end ?? now) - s.start), 0);
    g.totalEl.textContent = formatDuration(totalMs);
  }
}

setInterval(tick, 1000);

// --- Wiring -------------------------------------------------------

function setupCollapsible(headerEl, contentEl) {
  const arrowEl = headerEl.querySelector(".collapse-arrow");
  let expanded = false; // always start collapsed
  headerEl.addEventListener("click", () => {
    expanded = !expanded;
    contentEl.classList.toggle("hidden", !expanded);
    arrowEl.style.transform = expanded ? "rotate(90deg)" : "rotate(0deg)";
  });
}

for (const group of ["activity", "state"]) {
  const g = GROUPS[group];

  setupCollapsible(g.chartHeaderEl, g.chartContentEl);
  setupCollapsible(g.logHeaderEl, g.logContentEl);

  g.addFormEl.addEventListener("submit", (e) => {
    e.preventDefault();
    addCategory(group, g.addInputEl);
  });

  g.toggleMoreBtn.addEventListener("click", () => {
    g.moreSectionEl.classList.toggle("hidden");
    g.toggleMoreBtn.textContent = g.moreSectionEl.classList.contains("hidden") ? "More" : "Less";
  });

  // Edit button click handler using event delegation (covers main + more buttons)
  g.sectionEl.addEventListener("click", (e) => {
    const editBtn = e.target.closest(".category-edit-btn");
    if (editBtn) {
      e.preventDefault();
      e.stopPropagation();
      editingCategoryId = editBtn.dataset.categoryId;
      const currentLabel = editBtn.dataset.categoryLabel;
      editCategoryInputEl.value = currentLabel;
      editModalEl.classList.remove("hidden");
      editCategoryInputEl.focus();
      editCategoryInputEl.select();
    }
  });

  // Chart controls
  const pieBtn = g.chartSectionEl.querySelector('[data-chart-type="pie"]');
  const barBtn = g.chartSectionEl.querySelector('[data-chart-type="bar"]');
  const catBtn = g.chartSectionEl.querySelector('[data-view-mode="category"]');
  const subBtn = g.chartSectionEl.querySelector('[data-view-mode="subcategory"]');

  pieBtn.addEventListener("click", () => {
    g.chartType = "pie";
    pieBtn.classList.add("active");
    barBtn.classList.remove("active");
    renderChart(group);
  });

  barBtn.addEventListener("click", () => {
    g.chartType = "bar";
    barBtn.classList.add("active");
    pieBtn.classList.remove("active");
    renderChart(group);
  });

  catBtn.addEventListener("click", () => {
    g.chartViewMode = "category";
    catBtn.classList.add("active");
    subBtn.classList.remove("active");
    g.pickerEl.classList.add("hidden");
    renderChart(group);
  });

  subBtn.addEventListener("click", () => {
    g.chartViewMode = "subcategory";
    subBtn.classList.add("active");
    catBtn.classList.remove("active");
    populateSubcategoryPicker(group);
    g.pickerEl.classList.remove("hidden");
    renderChart(group);
  });

  g.pickerEl.addEventListener("change", () => {
    g.selectedCategoryId = g.pickerEl.value;
    renderChart(group);
  });

  // Session list click handler using event delegation
  g.listEl.addEventListener("click", (e) => {
    const sessionItem = e.target.closest(".session-item");
    if (sessionItem && sessionItem.dataset.sessionId) {
      openEditSessionModal(sessionItem.dataset.sessionId);
    }
  });
}

// Edit category modal actions
editCategorySaveBtn.addEventListener("click", saveEditCategory);
editCategoryCancelBtn.addEventListener("click", closeEditModal);
editModalCloseBtnEl.addEventListener("click", closeEditModal);

// Close edit modal on backdrop click
editModalEl.addEventListener("click", (e) => {
  if (e.target === editModalEl) {
    closeEditModal();
  }
});

// Enter key saves in edit modal
editCategoryInputEl.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    saveEditCategory();
  }
});

// Edit session modal event listeners
editSessionStartEl.addEventListener("change", updateSessionDurationDisplay);
editSessionEndEl.addEventListener("change", updateSessionDurationDisplay);

editSessionSaveBtn.addEventListener("click", saveEditSession);
editSessionDeleteBtn.addEventListener("click", deleteEditSession);
editSessionCancelBtn.addEventListener("click", closeEditSessionModal);
editSessionCloseBtnEl.addEventListener("click", closeEditSessionModal);

// Close edit session modal on backdrop click
editSessionModalEl.addEventListener("click", (e) => {
  if (e.target === editSessionModalEl) {
    closeEditSessionModal();
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
