// --- Data model -------------------------------------------------------
// A "session" is { id, start: <ms epoch>, end: <ms epoch|null> }
// end === null means the session is currently running.
// Kept intentionally flat/simple in v1 so category/subcategory fields
// can be added to each session object later without a migration.

const STORAGE_KEY = "time-tracker-sessions";

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

let sessions = loadSessions();

// --- Elements -----------------------------------------------------------

const trackBtn = document.getElementById("track-btn");
const trackBtnLabel = document.getElementById("track-btn-label");
const liveTimerEl = document.getElementById("live-timer");
const sessionListEl = document.getElementById("session-list");
const emptyStateEl = document.getElementById("empty-state");
const todayTotalEl = document.getElementById("today-total");
const todayDateEl = document.getElementById("today-date");

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

// --- Rendering --------------------------------------------------------

function render() {
  const running = getRunningSession();

  // Button state
  if (running) {
    trackBtn.classList.remove("idle");
    trackBtn.classList.add("running");
    trackBtnLabel.textContent = "Stop";
  } else {
    trackBtn.classList.remove("running");
    trackBtn.classList.add("idle");
    trackBtnLabel.textContent = "Start";
    liveTimerEl.textContent = "00:00:00";
  }

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

    li.appendChild(range);
    li.appendChild(duration);
    sessionListEl.appendChild(li);
  }

  // Today's total (includes live running time)
  const totalMs = todaySessions.reduce(
    (sum, s) => sum + ((s.end ?? now) - s.start),
    0
  );
  todayTotalEl.textContent = formatDuration(totalMs);
}

// --- Ticking (updates live timer + running duration every second) -----

function tick() {
  const running = getRunningSession();
  if (running) {
    liveTimerEl.textContent = formatClock(Date.now() - running.start);
  }
  // Keep the "now" duration on the running list item fresh too.
  const runningDurationEl = sessionListEl.querySelector(
    '.duration[data-running="1"]'
  );
  if (runningDurationEl) {
    const start = Number(runningDurationEl.dataset.start);
    runningDurationEl.textContent = formatDuration(Date.now() - start);
  }
  const totalEl = todayTotalEl;
  if (running) {
    const now = Date.now();
    const totalMs = sessions
      .filter((s) => isSameDay(s.start, now))
      .reduce((sum, s) => sum + ((s.end ?? now) - s.start), 0);
    totalEl.textContent = formatDuration(totalMs);
  }
}

setInterval(tick, 1000);

// --- Actions ------------------------------------------------------------

function toggleTracking() {
  const running = getRunningSession();
  const now = Date.now();

  if (running) {
    running.end = now;
  } else {
    sessions.push({ id: crypto.randomUUID(), start: now, end: null });
  }

  saveSessions(sessions);
  render();
}

trackBtn.addEventListener("click", toggleTracking);

// --- Header date ----------------------------------------------------------

todayDateEl.textContent = new Date().toLocaleDateString(undefined, {
  weekday: "long",
  month: "short",
  day: "numeric",
});

// --- Init -----------------------------------------------------------------

render();
