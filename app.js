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
    const data = raw ? JSON.parse(raw) : [];
    // Ensure all categories have id and label
    return data.map(cat =>
      typeof cat === "string" ? { id: cat, label: cat } : cat
    );
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
    const catObj = oldCategories.find(c => (c.label || c) === categoryStr) ||
                   { id: categoryStr, label: categoryStr };
    if (!catObj.id) catObj.id = categoryStr;
    if (!catObj.label) catObj.label = categoryStr;
    newCategories.push(catObj);
    categoryMap[categoryStr] = catObj.id;
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

const categoryButtonsEl = document.getElementById("category-buttons");
const addCategoryFormEl = document.getElementById("add-category-form");
const newCategoryInputEl = document.getElementById("new-category-input");
const liveTimerEl = document.getElementById("live-timer");
const currentCategoryEl = document.getElementById("current-category");
const sessionListEl = document.getElementById("session-list");
const emptyStateEl = document.getElementById("empty-state");
const todayTotalEl = document.getElementById("today-total");
const todayDateEl = document.getElementById("today-date");

// Chart elements
const chartSvgEl = document.getElementById("pie-chart");
const chartLegendEl = document.getElementById("chart-legend");
const toggleByCategoryEl = document.getElementById("toggle-by-category");
const toggleBySubcategoryEl = document.getElementById("toggle-by-subcategory");

let chartViewMode = "category"; // "category" or "subcategory"

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

function getCategoryLabel(categoryId) {
  const cat = categories.find(c => c.id === categoryId);
  return cat ? cat.label : categoryId;
}

function editCategoryLabel(categoryId, newLabel) {
  const cat = categories.find(c => c.id === categoryId);
  if (cat && newLabel.trim()) {
    cat.label = newLabel.trim();
    saveCategories(categories);
    render();
  }
}

function getCommonSubcategoriesForCategory(categoryId) {
  // Get the most recently used subcategories for this category
  const categorySessionsReversed = sessions
    .filter((s) => s.categoryId === categoryId)
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

// --- Chart functions -----------------------------------------------

const CHART_COLORS = [
  "#3ddc84", "#2a7f52", "#ff5c5c", "#7f2a2a", "#5c9cff", "#2a4a7f",
  "#ffd700", "#7f7f2a", "#ff69b4", "#7f2a5c", "#00d4ff", "#2a7f7f",
];

function getAggregatedData(mode) {
  const now = Date.now();
  const todaySessions = sessions.filter((s) => isSameDay(s.start, now));

  if (mode === "category") {
    const data = {};
    for (const session of todaySessions) {
      const categoryId = session.categoryId || session.category;
      const categoryLabel = getCategoryLabel(categoryId);
      const duration = (session.end ?? now) - session.start;
      data[categoryLabel] = (data[categoryLabel] || 0) + duration;
    }
    return Object.entries(data).map(([label, ms]) => ({ label, ms }));
  } else {
    // "subcategory" mode: group by category + subcategory
    const data = {};
    for (const session of todaySessions) {
      const categoryId = session.categoryId || session.category;
      const categoryLabel = getCategoryLabel(categoryId);
      const key = session.subcategory
        ? `${categoryLabel} • ${session.subcategory}`
        : categoryLabel;
      const duration = (session.end ?? now) - session.start;
      data[key] = (data[key] || 0) + duration;
    }
    return Object.entries(data).map(([label, ms]) => ({ label, ms }));
  }
}

function renderPieChart() {
  const data = getAggregatedData(chartViewMode);

  if (data.length === 0) {
    chartSvgEl.innerHTML = "<text x='200' y='200' text-anchor='middle' fill='var(--text-dim)'>No data yet</text>";
    chartLegendEl.innerHTML = "";
    return;
  }

  // Calculate total and percentages
  const total = data.reduce((sum, d) => sum + d.ms, 0);
  const slices = data.map((d, i) => ({
    ...d,
    percent: (d.ms / total) * 100,
    color: CHART_COLORS[i % CHART_COLORS.length],
  }));

  // Draw pie chart
  const svg = chartSvgEl;
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

  // Render legend
  chartLegendEl.innerHTML = "";
  for (const slice of slices) {
    const item = document.createElement("div");
    item.className = "legend-item";

    const colorBox = document.createElement("div");
    colorBox.className = "legend-color";
    colorBox.style.backgroundColor = slice.color;

    const label = document.createElement("span");
    label.className = "legend-label";
    label.textContent = slice.label;

    const time = document.createElement("span");
    time.className = "legend-time";
    time.textContent = formatDuration(slice.ms);

    item.appendChild(colorBox);
    item.appendChild(label);
    item.appendChild(time);
    chartLegendEl.appendChild(item);
  }
}

// --- Modal Logic -------------------------------------------------------

let pendingCategoryIdForModal = null;
let selectedSubcategoryForModal = null;
let isEditingRunningSession = false;

function openSubcategoryModal(categoryId, categoryLabel) {
  const running = getRunningSession();
  const isRunningCategory = running && running.categoryId === categoryId;

  pendingCategoryIdForModal = categoryId;
  selectedSubcategoryForModal = isRunningCategory ? running.subcategory : null;
  detailInputEl.value = isRunningCategory ? running.detail : "";
  newSubcategoryInputEl.value = "";
  isEditingRunningSession = isRunningCategory;

  // Update button text
  startSessionBtnEl.textContent = isEditingRunningSession ? "Update" : "Start";

  modalCategoryTitleEl.textContent = categoryLabel;

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
  if (!pendingCategoryIdForModal) {
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
      categoryId: pendingCategoryIdForModal,
      category: pendingCategoryIdForModal, // Keep for backwards compat
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
    const wrapper = document.createElement("div");
    wrapper.className = "category-btn-wrapper";
    wrapper.style.position = "relative";
    wrapper.style.display = "inline-block";

    const btn = document.createElement("button");
    btn.className = "category-btn";
    if (running && running.categoryId === cat.id) {
      btn.classList.add("active");
    }
    btn.textContent = cat.label;
    btn.addEventListener("click", () => openSubcategoryModal(cat.id, cat.label));
    wrapper.appendChild(btn);

    // Edit button
    const editBtn = document.createElement("button");
    editBtn.className = "category-edit-btn";
    editBtn.textContent = "✏️";
    editBtn.style.position = "absolute";
    editBtn.style.top = "-8px";
    editBtn.style.right = "-8px";
    editBtn.style.width = "24px";
    editBtn.style.height = "24px";
    editBtn.style.padding = "0";
    editBtn.style.fontSize = "12px";
    editBtn.style.border = "1px solid var(--surface-2)";
    editBtn.style.borderRadius = "50%";
    editBtn.style.background = "var(--surface)";
    editBtn.style.cursor = "pointer";
    editBtn.style.display = "none";

    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const newLabel = prompt("Edit category name:", cat.label);
      if (newLabel) {
        editCategoryLabel(cat.id, newLabel);
      }
    });

    wrapper.addEventListener("mouseenter", () => {
      editBtn.style.display = "block";
    });

    wrapper.addEventListener("mouseleave", () => {
      editBtn.style.display = "none";
    });

    wrapper.appendChild(editBtn);
    categoryButtonsEl.appendChild(wrapper);
  }
}

function render() {
  const running = getRunningSession();

  // Update current category display
  if (running) {
    const categoryLabel = getCategoryLabel(running.categoryId || running.category);
    const subtitle = running.subcategory ? ` / ${running.subcategory}` : "";
    currentCategoryEl.textContent = categoryLabel + subtitle;
  } else {
    currentCategoryEl.textContent = "—";
  }

  renderCategories();
  renderPieChart();

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
    const categoryLabel = getCategoryLabel(s.categoryId || s.category);
    const metaText = [categoryLabel, s.subcategory, s.detail].filter(Boolean).join(" • ");
    meta.textContent = metaText || categoryLabel;

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
  if (categories.some(c => c.label === name)) {
    newCategoryInputEl.value = "";
    return;
  }

  categories.push({
    id: crypto.randomUUID(),
    label: name
  });
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

// Chart toggle
toggleByCategoryEl.addEventListener("click", () => {
  chartViewMode = "category";
  toggleByCategoryEl.classList.add("active");
  toggleBySubcategoryEl.classList.remove("active");
  renderPieChart();
});

toggleBySubcategoryEl.addEventListener("click", () => {
  chartViewMode = "subcategory";
  toggleBySubcategoryEl.classList.add("active");
  toggleByCategoryEl.classList.remove("active");
  renderPieChart();
});

// --- Header date ----------------------------------------------------------

todayDateEl.textContent = new Date().toLocaleDateString(undefined, {
  weekday: "long",
  month: "short",
  day: "numeric",
});

// --- Init -----------------------------------------------------------------

render();
