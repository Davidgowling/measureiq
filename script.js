//------------------------------------------------------
// GLOBAL DATA
//------------------------------------------------------
let rooms = [];
let activeRoomId = null;
let SYSTEM_ACCESSORIES = [];
let accessoriesDefs = []; // global list with default prices
let businessProfile = null;
let authUser = null;

const AUTH_TOKEN_KEY = "measureiq_auth_token_v1";
const API_BASE = "";  // same-origin for local dev
const VAT_RATE = 0.2;

//------------------------------------------------------
// CLOUD CACHE + DEBOUNCED SAVE (NEW)
//------------------------------------------------------
let _cloudCache = null;       // in-memory mirror of the cloud JSONB blob
let _cloudDirty = false;      // has the cache been modified since last save?
let _saveTimer = null;        // debounce timer
let _saveInFlight = false;    // is a save request currently in progress?
const SAVE_DEBOUNCE_MS = 1500; // wait 1.5s after last change before saving

/** Return cached cloud data, or fetch once if empty */
async function getCloudData() {
  if (_cloudCache) return _cloudCache;
  if (!isSignedIn()) return {};
  try {
    _cloudCache = await apiFetch("/api/load", { method: "GET" });
  } catch {
    _cloudCache = {};
  }
  return _cloudCache;
}

/** Invalidate cache (e.g. on logout) */
function clearCloudCache() {
  _cloudCache = null;
  _cloudDirty = false;
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
}

/** Mark a key in the cache as changed and schedule a debounced save */
function markCloudDirty(key, value) {
  if (!_cloudCache) _cloudCache = {};
  _cloudCache[key] = value;
  _cloudDirty = true;
  scheduleSave();
}

/** Schedule a save after SAVE_DEBOUNCE_MS of inactivity */
function scheduleSave() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => flushSave(), SAVE_DEBOUNCE_MS);
  showSaveStatus("pending");
}

/** Force an immediate save (used by explicit "Save" buttons) */
async function flushSave() {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  if (!_cloudDirty || !isSignedIn() || !_cloudCache) {
    showSaveStatus("idle");
    return;
  }
  if (_saveInFlight) return; // another save is running; it will pick up changes

  _saveInFlight = true;
  _cloudDirty = false;
  showSaveStatus("saving");

  try {
    await apiFetch("/api/save", {
      method: "POST",
      body: JSON.stringify(_cloudCache),
    });
    showSaveStatus("saved");
  } catch (e) {
    console.error("Cloud save failed", e);
    _cloudDirty = true; // retry on next schedule
    showSaveStatus("error");
  } finally {
    _saveInFlight = false;
  }

  // If more changes arrived while we were saving, flush again
  if (_cloudDirty) scheduleSave();
}

/** Update the save status indicator in the UI */
function showSaveStatus(state) {
  const el = document.getElementById("saveStatus");
  if (!el) return;
  const labels = {
    idle: "",
    pending: "Unsaved changes…",
    saving: "Saving…",
    saved: "✓ Saved",
    error: "⚠ Save failed — retrying…",
  };
  el.textContent = labels[state] || "";
  el.className = `save-status save-status--${state}`;
  if (state === "saved") {
    setTimeout(() => {
      if (el.textContent === "✓ Saved") { el.textContent = ""; el.className = "save-status"; }
    }, 2000);
  }
}

//------------------------------------------------------
// INITIALISE APP
//------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  // Inject save-status indicator into topbar
  const topbar = document.querySelector(".topbar .auth");
  if (topbar) {
    const indicator = document.createElement("span");
    indicator.id = "saveStatus";
    indicator.className = "save-status";
    topbar.insertBefore(indicator, topbar.firstChild);
  }

  // Load system accessories
  fetch("data/accessories.json")
    .then((res) => res.json())
    .then((data) => {
      SYSTEM_ACCESSORIES = (data.systemAccessories || []).map((acc) => ({
        id: acc.id,
        name: acc.name,
        unit: acc.unit,
        category: acc.category || "Other",
      }));
    })
    .catch((err) => console.error("Error loading data/accessories.json", err));

  // Buttons & events
  document.getElementById("addRoomBtn").addEventListener("click", addRoom);
  document.getElementById("editRoomBtn").addEventListener("click", renameRoom);
  document.getElementById("deleteRoomBtn").addEventListener("click", deleteRoom);

  document.getElementById("saveCustomerBtn").addEventListener("click", saveCustomer);
  document.getElementById("newCustomerBtn").addEventListener("click", newCustomer);
  document.getElementById("customerSearch")?.addEventListener("input", () => {
    renderSavedCustomersList(_cloudCache);
  });

  document.getElementById("calculateBtn").addEventListener("click", () => calculateRoom(false));

  // Live geometry recalc
  ["length", "widthInput"].forEach((id) => {
    const el = document.getElementById(id);
    el?.addEventListener("input", () => {
      syncAutoQtyLinesToRoomArea();
      calculateRoom(true);
    });
  });

  // Room custom lines
  document.getElementById("addCustomLineBtn").addEventListener("click", addCustomLine);

  // Accessories pricing
  document.getElementById("saveAccessoriesBtn").addEventListener("click", saveAccessoryDefinitions);

  // Business profile
  document.getElementById("saveBusinessProfileBtn").addEventListener("click", saveBusinessProfile);

  // Quote
  document.getElementById("quoteShowLineItems").addEventListener("change", () => renderQuote());
  document.getElementById("quoteNotes").addEventListener("input", () => renderQuote());
  document.getElementById("quotePrintBtn").addEventListener("click", () => window.print());

  // Flush save before user leaves
  window.addEventListener("beforeunload", (e) => {
    if (_cloudDirty) {
      flushSave();
      e.preventDefault();
      e.returnValue = "";
    }
  });

  setupTabs();
  setupAuthUI();
  initCloudOnly();
});

//------------------------------------------------------
// AUTH + API
//------------------------------------------------------
function getToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

function setToken(token) {
  if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
  else localStorage.removeItem(AUTH_TOKEN_KEY);
}

function isSignedIn() {
  return !!getToken();
}

async function apiFetch(path, options = {}) {
  const headers = Object.assign(
    { "Content-Type": "application/json" },
    options.headers || {}
  );

  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  let data = null;
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) data = await res.json();
  else data = await res.text();

  if (!res.ok) {
    const msg = (data && data.error) ? data.error : (typeof data === "string" ? data : "Request failed");
    throw new Error(msg);
  }
  return data;
}

function setAuthUI() {
  const status = document.getElementById("authStatus");
  const logoutBtn = document.getElementById("logoutBtn");

  const signedIn = !!authUser;

  if (signedIn) {
    status.textContent = `Signed in as ${authUser.email || "user"}`;
    logoutBtn.style.display = "inline-block";
  } else {
    status.textContent = "Not signed in";
    logoutBtn.style.display = "none";
  }
}

function showAuthScreen() {
  document.getElementById("authScreen").style.display = "flex";
  document.getElementById("appMain").style.display = "none";
}

function hideAuthScreen() {
  document.getElementById("authScreen").style.display = "none";
  document.getElementById("appMain").style.display = "block";
}

async function hydrateAuthUser() {
  if (!isSignedIn()) {
    authUser = null;
    setAuthUI();
    return;
  }

  try {
    const me = await apiFetch("/api/me", { method: "GET" });
    authUser = { email: me.email };
  } catch (e) {
    setToken(null);
    authUser = null;
  }
  setAuthUI();
}

function setupAuthUI() {
  const logoutBtn = document.getElementById("logoutBtn");

  // Auth screen tab switching
  document.querySelectorAll(".auth-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".auth-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      const target = tab.dataset.authTab;
      document.getElementById("authLoginPanel").style.display = target === "login" ? "block" : "none";
      document.getElementById("authRegisterPanel").style.display = target === "register" ? "block" : "none";
    });
  });

  document.getElementById("loginBtn")?.addEventListener("click", async (e) => {
    e.preventDefault();
    const msg = document.getElementById("loginMsg");
    msg.textContent = "";
    try {
      const email = document.getElementById("loginEmail").value.trim();
      const password = document.getElementById("loginPassword").value;

      if (!email || !password) {
        msg.textContent = "Please enter your email and password.";
        return;
      }

      const data = await apiFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setToken(data.token);
      clearCloudCache(); // clear stale cache before fresh load
      await hydrateAuthUser();
      await syncFromCloud();
      unlockApp();
      hideAuthScreen();
    } catch (e) {
      msg.textContent = e.message;
    }
  });

  document.getElementById("forgotPasswordBtn")?.addEventListener("click", async (e) => {
    e.preventDefault();
    const emailInput = document.getElementById("loginEmail");
    const msg = document.getElementById("forgotMsg");
    if (!emailInput || !msg) return;

    msg.textContent = "";
    const email = emailInput.value.trim();
    if (!email) {
      msg.textContent = "Please enter your email address above.";
      return;
    }

    try {
      await apiFetch("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      msg.textContent = "If an account exists for that email, a password reset link has been sent.";
    } catch {
      msg.textContent = "Something went wrong. Please try again.";
    }
  });

  // Password strength indicator
  document.getElementById("registerPassword")?.addEventListener("input", (e) => {
    const val = e.target.value;
    const fill = document.getElementById("passwordStrengthFill");
    const label = document.getElementById("passwordStrengthLabel");
    if (!fill || !label) return;

    if (!val) {
      fill.style.width = "0%";
      fill.className = "password-strength__fill";
      label.textContent = "";
      return;
    }

    let score = 0;
    if (val.length >= 8) score++;
    if (val.length >= 12) score++;
    if (/[A-Z]/.test(val)) score++;
    if (/[0-9]/.test(val)) score++;
    if (/[^A-Za-z0-9]/.test(val)) score++;

    const levels = [
      { pct: "20%", cls: "weak",   text: "Too short" },
      { pct: "40%", cls: "weak",   text: "Weak" },
      { pct: "60%", cls: "fair",   text: "Fair" },
      { pct: "80%", cls: "good",   text: "Good" },
      { pct: "100%",cls: "strong", text: "Strong" },
    ];
    const lvl = levels[Math.min(score, levels.length - 1)];
    fill.style.width = lvl.pct;
    fill.className = `password-strength__fill password-strength__fill--${lvl.cls}`;
    label.textContent = lvl.text;
    label.className = `password-strength__label password-strength__label--${lvl.cls}`;
  });

  document.getElementById("registerBtn")?.addEventListener("click", async (e) => {
    e.preventDefault();
    const msg = document.getElementById("registerMsg");
    msg.textContent = "";
    try {
      const email = document.getElementById("registerEmail").value.trim();
      const password = document.getElementById("registerPassword").value;

      // Client-side validation
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        msg.textContent = "Please enter a valid email address.";
        return;
      }
      if (password.length < 8) {
        msg.textContent = "Password must be at least 8 characters.";
        return;
      }

      const data = await apiFetch("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setToken(data.token);
      clearCloudCache();
      await hydrateAuthUser();
      await syncFromCloud();
      unlockApp();
      hideAuthScreen();
    } catch (e) {
      msg.textContent = e.message;
    }
  });

logoutBtn?.addEventListener("click", () => {
  flushSave();
  setToken(null);
  authUser = null;
  clearCloudCache();

  // ✅ Reset all in-memory state so previous user's data doesn't bleed through
  rooms = [];
  activeRoomId = null;
  businessProfile = null;
  accessoriesDefs = [];

  // ✅ Clear the UI too
  newCustomer(); // clears customer name, job ref, rooms UI
  document.getElementById("savedCustomersList").innerHTML = "";
  document.getElementById("accessoriesPricingList").innerHTML = "";
  renderQuote();

  setAuthUI();
  lockApp(true);
  showAuthScreen();
});

  hydrateAuthUser();
}

//------------------------------------------------------
// CLOUD-ONLY LOCK
//------------------------------------------------------
function lockApp(isLocked) {
  document.body.classList.toggle("locked", !!isLocked);
  const overlay = document.getElementById("lockOverlay");
  if (overlay) overlay.style.display = isLocked ? "flex" : "none";
}

function unlockApp() {
  document.body.classList.remove("locked");
  const overlay = document.querySelector(".lock-overlay");
  if (overlay) overlay.style.display = "none";
}

function requireAuth() {
  if (isSignedIn()) return true;
  showAuthScreen();
  throw new Error("Please sign in to use MeasureIQ.");
}

async function initCloudOnly() {
  try {
    await hydrateAuthUser();
  } catch {}
  if (!isSignedIn()) {
    showAuthScreen();
    return;
  }
  hideAuthScreen();
  lockApp(false);
  await syncFromCloud();
  showRoomForm(false);
}

//------------------------------------------------------
// SYNC FROM CLOUD — SINGLE FETCH (OPTIMISED)
//------------------------------------------------------
async function syncFromCloud() {
  // ONE fetch, distribute to all consumers
  const cloud = await getCloudData();

  // --- Business Profile ---
  const defaults = {
    businessName: "", contactName: "", address1: "", address2: "",
    town: "", postcode: "", phone: "", email: "", website: "",
    vatNumber: "", showLineItemsOnQuote: false, defaultNotes: "", logoUrl: "",
  };
  const savedBP = cloud.businessProfile && typeof cloud.businessProfile === "object"
    ? cloud.businessProfile : null;
  businessProfile = { ...defaults, ...(savedBP || {}) };
  applyBusinessProfileToUI();

  // --- Accessory Definitions ---
  const userPrices = cloud.accessoryPrices && typeof cloud.accessoryPrices === "object"
    ? cloud.accessoryPrices : {};
  if (SYSTEM_ACCESSORIES.length) {
    accessoriesDefs = buildAccessories(SYSTEM_ACCESSORIES, userPrices);
    renderAccessoriesPricingPanel();
  }

  // --- Saved Customers ---
  renderSavedCustomersList(cloud);

  // --- Normalise rooms ---
  rooms.forEach((r, i) => {
    if (typeof r.collapsed !== "boolean") r.collapsed = i !== 0;
    normaliseRoomLines(r);
  });

  // If active room open, re-render
  const activeRoom = rooms.find((r) => r.id === activeRoomId);
  if (activeRoom) {
    renderRoomLineItems(activeRoom);
    syncAutoQtyLinesToRoomArea();
    calculateRoom(true);
  }

  updateRoomList();
}

//------------------------------------------------------
// TABS
//------------------------------------------------------
function setupTabs() {
  const panels = {
    calculatorSection: document.getElementById("calculatorSection"),
    accessoriesSection: document.getElementById("accessoriesSection"),
    quoteSection: document.getElementById("quoteSection"),
    businessProfileSection: document.getElementById("businessProfileSection"),
  };

  const hamburgerBtn = document.getElementById("hamburgerBtn");
  const hamburgerMenu = document.getElementById("hamburgerMenu");
  const currentTabLabel = document.getElementById("currentTabLabel");

  // Toggle menu open/close
  hamburgerBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = hamburgerMenu.style.display === "block";
    hamburgerMenu.style.display = isOpen ? "none" : "block";
    hamburgerBtn.classList.toggle("open", !isOpen);
  });

  // Close menu when clicking outside
  document.addEventListener("click", () => {
    hamburgerMenu.style.display = "none";
    hamburgerBtn.classList.remove("open");
  });

  // Handle menu item clicks
  document.querySelectorAll(".hamburger-item").forEach((item) => {
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      const target = item.dataset.tab;

      // Switch panels
      Object.entries(panels).forEach(([key, panel]) => {
        if (panel) panel.style.display = key === target ? "block" : "none";
      });

      // Update active state and label
      document.querySelectorAll(".hamburger-item").forEach((i) => i.classList.remove("active"));
      item.classList.add("active");
      currentTabLabel.textContent = item.textContent.replace(/^.{2}/, "").trim(); // strip emoji

      // Close menu
      hamburgerMenu.style.display = "none";
      hamburgerBtn.classList.remove("open");

      // Re-render quote if switching to it
      if (target === "quoteSection") renderQuote();
    });
  });
}

//------------------------------------------------------
// BUSINESS PROFILE
//------------------------------------------------------
function applyBusinessProfileToUI() {
  safeSetValue("bpLogoUrl", businessProfile.logoUrl);
  safeSetValue("bpBusinessName", businessProfile.businessName);
  safeSetValue("bpContactName", businessProfile.contactName);
  safeSetValue("bpAddress1", businessProfile.address1);
  safeSetValue("bpAddress2", businessProfile.address2);
  safeSetValue("bpTown", businessProfile.town);
  safeSetValue("bpPostcode", businessProfile.postcode);
  safeSetValue("bpPhone", businessProfile.phone);
  safeSetValue("bpEmail", businessProfile.email);
  safeSetValue("bpWebsite", businessProfile.website);
  safeSetValue("bpVatNumber", businessProfile.vatNumber);
  safeSetValue("bpDefaultNotes", businessProfile.defaultNotes);

  const bpShow = document.getElementById("bpShowLineItems");
  if (bpShow) bpShow.checked = !!businessProfile.showLineItemsOnQuote;

  const showLineItems = document.getElementById("quoteShowLineItems");
  if (showLineItems && !showLineItems.dataset.initialised) {
    showLineItems.checked = !!businessProfile.showLineItemsOnQuote;
    showLineItems.dataset.initialised = "true";
  }

  const notesArea = document.getElementById("quoteNotes");
  if (notesArea && notesArea.value.trim() === "" && businessProfile.defaultNotes) {
    notesArea.value = businessProfile.defaultNotes;
  }
}

async function saveBusinessProfile() {
  businessProfile = {
    logoUrl: getValue("bpLogoUrl"),
    businessName: getValue("bpBusinessName"),
    contactName: getValue("bpContactName"),
    address1: getValue("bpAddress1"),
    address2: getValue("bpAddress2"),
    town: getValue("bpTown"),
    postcode: getValue("bpPostcode"),
    phone: getValue("bpPhone"),
    email: getValue("bpEmail"),
    website: getValue("bpWebsite"),
    vatNumber: getValue("bpVatNumber"),
    showLineItemsOnQuote: !!document.getElementById("bpShowLineItems").checked,
    defaultNotes: getValue("bpDefaultNotes"),
  };

  if (!isSignedIn()) { requireAuth(); return; }

  // OPTIMISED: merge into cache and flush immediately (no re-fetch)
  markCloudDirty("businessProfile", businessProfile);
  await flushSave();

  const msg = document.getElementById("businessSavedMsg");
  msg.textContent = "Saved";
  setTimeout(() => { msg.textContent = ""; }, 1500);

  applyBusinessProfileToUI();
  renderQuote();
}

//------------------------------------------------------
// ROOMS
//------------------------------------------------------
function showRoomForm(show) {
  document.getElementById("roomForm").style.display = show ? "block" : "none";
  document.getElementById("noRoomMessage").style.display = show ? "none" : "block";
}

function addRoom() {
  const name = prompt("Enter room name:");
  if (!name) return;

  rooms.forEach((r) => (r.collapsed = true));

  const room = {
    id: Date.now(),
    name,
    data: {},
    collapsed: false,
  };

  rooms.push(room);
  activeRoomId = room.id;

  normaliseRoomLines(room);

  updateRoomList();
  loadRoom(room.id);
}

function renameRoom() {
  if (!activeRoomId) return;
  const room = rooms.find((r) => r.id === activeRoomId);
  if (!room) return;

  const newName = prompt("Rename room:", room.name);
  if (!newName) return;

  room.name = newName;
  updateRoomList();
  document.getElementById("roomTitle").textContent = newName;
  calculateRoom(true);
}

function deleteRoom() {
  if (!activeRoomId) return;
  const room = rooms.find((r) => r.id === activeRoomId);
  if (!room) return;

  const ok = confirm(`Delete room "${room.name}"?`);
  if (!ok) return;

  rooms = rooms.filter((r) => r.id !== activeRoomId);
  activeRoomId = rooms.length ? rooms[0].id : null;

  updateRoomList();

  if (activeRoomId) loadRoom(activeRoomId);
  else {
    clearRoomForm();
    showRoomForm(false);
    document.getElementById("roomTitle").textContent = "No room selected";
    document.getElementById("result").innerHTML = "";
  }

  updateStickyFooter();
  renderQuote();
}

function updateRoomList() {
  const container = document.getElementById("roomList");
  if (!container) return;

  container.innerHTML = "";

  if (!rooms.length) {
    container.innerHTML = `<p class="muted" style="margin-top:10px;">No rooms yet. Tap "+ Add Room".</p>`;
    return;
  }

  rooms.forEach((room) => {
    const hasData = room.data?.roomArea && room.data?.lineTotal;

    const item = document.createElement("div");
    item.className = "room-item";
    if (room.id === activeRoomId) item.classList.add("active");
    if (room.collapsed) item.classList.add("collapsed");

    const summary = hasData
      ? `${room.data.roomArea.toFixed(2)} m² • £${room.data.lineTotal.toFixed(2)}`
      : "Not calculated";

    item.innerHTML = `
      <div class="room-header-row">
        <div>
          <strong>${escapeHtml(room.name)}</strong><br>
          <span class="room-summary">${summary}</span>
        </div>
      </div>
    `;

    item.addEventListener("click", () => {
      rooms.forEach((r) => (r.collapsed = true));
      room.collapsed = false;
      activeRoomId = room.id;

      updateRoomList();
      loadRoom(room.id);
    });

    container.appendChild(item);
  });
}

function clearRoomForm() {
  safeSetValue("length", "");
  safeSetValue("widthInput", "");
  document.getElementById("result").innerHTML = "";
  document.getElementById("roomSavedMsg").textContent = "";
  const li = document.getElementById("roomLineItems");
  if (li) li.innerHTML = "";
}

function loadRoom(id) {
  const room = rooms.find((r) => r.id === id);
  if (!room) return;

  rooms.forEach((r) => (r.collapsed = true));
  room.collapsed = false;
  activeRoomId = room.id;

  showRoomForm(true);
  clearRoomForm();

  document.getElementById("roomTitle").textContent = room.name;

  normaliseRoomLines(room);

  const d = room.data || {};
  if (d.length) safeSetValue("length", d.length);
  if (d.width) safeSetValue("widthInput", d.width);

  renderRoomLineItems(room);

  if (d.resultHtml) document.getElementById("result").innerHTML = d.resultHtml;
  else document.getElementById("result").innerHTML = "";

  syncAutoQtyLinesToRoomArea();
  calculateRoom(true);
}

//------------------------------------------------------
// ACCESSORY DEFINITIONS (GLOBAL DEFAULT PRICES)
//------------------------------------------------------
function buildAccessories(system, userPrices = {}) {
  return system.map((acc) => ({
    id: acc.id,
    name: acc.name,
    unit: acc.unit,
    category: acc.category || "Other",
    price: Number(userPrices[acc.id]) || 0,
  }));
}

async function saveAccessoryDefinitions() {
  const container = document.getElementById("accessoriesPricingList");
  if (!container) return;

  const prices = {};

  container.querySelectorAll("tbody tr[data-id]").forEach((row) => {
    const id = row.getAttribute("data-id");
    const priceInput = document.getElementById(`accDefPrice_${id}`);
    prices[id] = parseFloat(priceInput.value) || 0;
  });

  if (!isSignedIn()) { requireAuth(); return; }

  // OPTIMISED: merge into cache and flush immediately (no re-fetch)
  markCloudDirty("accessoryPrices", prices);
  await flushSave();

  const msg = document.getElementById("accessoriesSavedMsg");
  msg.textContent = "Saved";
  setTimeout(() => (msg.textContent = ""), 1500);

  accessoriesDefs = buildAccessories(SYSTEM_ACCESSORIES, prices);

  // Update rooms that haven't overridden unit prices (we keep overrides intact)
  rooms.forEach((r) => {
    if (!r.data?.lines) return;
    r.data.lines.forEach((ln) => {
      if (ln.source === "accessory" && !ln.priceOverridden) {
        const def = accessoriesDefs.find((d) => d.id === ln.sourceId);
        if (def) ln.unitPrice = Number(def.price) || 0;
      }
    });
  });

  const activeRoom = rooms.find((r) => r.id === activeRoomId);
  if (activeRoom) {
    renderRoomLineItems(activeRoom);
    syncAutoQtyLinesToRoomArea();
    calculateRoom(true);
  }

  renderQuote();
}

function renderAccessoriesPricingPanel() {
  const container = document.getElementById("accessoriesPricingList");
  if (!container) return;

  if (!accessoriesDefs.length) {
    container.innerHTML = `<p class="muted">No accessories configured.</p>`;
    return;
  }

  const grouped = accessoriesDefs.reduce((acc, def) => {
    const cat = def.category || "Other";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(def);
    return acc;
  }, {});

  const orderedCategories = Object.keys(grouped).sort((a, b) => {
    if (a === "Other") return 1;
    if (b === "Other") return -1;
    return a.localeCompare(b);
  });

  const rowsHtml = orderedCategories
    .map((category) => {
      const defs = grouped[category];

      const headerRow = `
        <tr class="category-row">
          <td colspan="3"><strong>${escapeHtml(category)}</strong></td>
        </tr>
      `;

      const rows = defs
        .map(
          (def) => `
        <tr data-id="${def.id}">
          <td>${escapeHtml(def.name)}</td>
          <td>${unitLabel(def.unit)}</td>
          <td>
            <input type="number"
              id="accDefPrice_${def.id}"
              step="0.01"
              min="0"
              value="${Number(def.price) || 0}">
          </td>
        </tr>
      `
        )
        .join("");

      return headerRow + rows;
    })
    .join("");

  container.innerHTML = `
    <table class="summary-table accessories-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Unit</th>
          <th>Default Price (£ ex VAT)</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  `;
}

//------------------------------------------------------
// ROOM LINE ITEMS (NEW CORE)
//------------------------------------------------------
function normaliseRoomLines(room) {
  if (!room.data) room.data = {};

  // Create lines array if missing
  if (!Array.isArray(room.data.lines)) room.data.lines = [];

  // Ensure Flooring line exists
  const hasFlooring = room.data.lines.some((l) => l.id === "flooring");
  if (!hasFlooring) {
    room.data.lines.unshift({
      id: "flooring",
      label: "Flooring",
      unit: "sqm",
      selected: true,
      qty: 0,
      autoQty: true,
      unitPrice: 0,
      total: 0,
      source: "system",
    });
  }

  // Ensure accessory lines exist (but NOT auto-selected by default)
  accessoriesDefs.forEach((def) => {
    const existing = room.data.lines.find((l) => l.source === "accessory" && l.sourceId === def.id);
    if (!existing) {
      room.data.lines.push({
        id: `acc_${def.id}`,
        label: def.name,
        unit: def.unit,
        selected: false,
        qty: 0,
        autoQty: def.unit === "sqm",
        unitPrice: Number(def.price) || 0,
        priceOverridden: false,
        total: 0,
        source: "accessory",
        sourceId: def.id,
      });
    }
  });

  // Make sure totals are numeric
  room.data.lines.forEach((ln) => {
    ln.qty = Number(ln.qty) || 0;
    ln.unitPrice = Number(ln.unitPrice) || 0;
    ln.total = Number(ln.total) || 0;
    if (typeof ln.selected !== "boolean") ln.selected = !!ln.selected;
    if (typeof ln.autoQty !== "boolean") ln.autoQty = ln.unit === "sqm";
  });
}

function computeAreaValues() {
  const length = parseFloat(document.getElementById("length").value);
  const width = parseFloat(document.getElementById("widthInput").value);

  if (!length || !width) {
    return { hasGeometry: false, roomArea: 0 };
  }
  return { hasGeometry: true, roomArea: length * width };
}

function syncAutoQtyLinesToRoomArea() {
  if (!activeRoomId) return;
  const room = rooms.find((r) => r.id === activeRoomId);
  if (!room) return;

  const geo = computeAreaValues();
  if (!geo.hasGeometry) return;

  normaliseRoomLines(room);

  room.data.lines.forEach((ln) => {
    if (ln.unit === "sqm" && ln.autoQty) {
      ln.qty = geo.roomArea;
    }
  });

  // Update UI fields if visible
  const container = document.getElementById("roomLineItems");
  if (!container) return;

  room.data.lines.forEach((ln) => {
    const qtyInput = document.getElementById(`lineQty_${ln.id}`);
    if (qtyInput && ln.unit === "sqm" && ln.autoQty) {
      qtyInput.value = Number(ln.qty).toFixed(2);
    }
  });
}

function renderRoomLineItems(room) {
  const container = document.getElementById("roomLineItems");
  if (!container) return;

  normaliseRoomLines(room);

  const rows = room.data.lines.map((ln) => {
    const qtyFixed = (Number(ln.qty) || 0).toFixed(2);
    const priceFixed = (Number(ln.unitPrice) || 0).toFixed(2);
    const totalFixed = (Number(ln.total) || 0).toFixed(2);

    const autoTag =
      ln.unit === "sqm"
        ? `<label class="auto-qty">
             <input type="checkbox" id="lineAuto_${ln.id}" ${ln.autoQty ? "checked" : ""}>
             Auto
           </label>`
        : `<span class="muted tiny">—</span>`;

    const includeChecked = ln.selected ? "checked" : "";

    // Flooring is always included (but still shown as included)
    const includeDisabled = ln.id === "flooring" ? "disabled" : "";
    const includeHelp = ln.id === "flooring"
      ? `<span class="muted tiny">Included</span>`
      : "";

    const unit = unitLabel(ln.unit);

    const removeBtn =
      ln.source === "custom"
        ? `<button class="btn danger small" data-remove="${ln.id}" type="button">Remove</button>`
        : `<span class="muted tiny">—</span>`;

    return `
      <tr data-line="${ln.id}">
        <td class="cell-include">
          <label class="checkbox">
            <input type="checkbox" id="lineOn_${ln.id}" ${includeChecked} ${includeDisabled}>
            <span>${escapeHtml(ln.label)}</span>
          </label>
          ${includeHelp}
        </td>

        <td class="cell-qty">
          <div class="qty-wrap">
            <input type="number" id="lineQty_${ln.id}" step="0.01" min="0" value="${qtyFixed}">
            <span class="unit-pill">${escapeHtml(unit)}</span>
            ${autoTag}
          </div>
        </td>

        <td class="cell-price">
          <input type="number" id="linePrice_${ln.id}" step="0.01" min="0" value="${priceFixed}">
        </td>

        <td class="cell-total">
          <strong id="lineTotal_${ln.id}">£${totalFixed}</strong>
        </td>

        <td class="cell-actions">
          ${removeBtn}
        </td>
      </tr>
    `;
  }).join("");

  container.innerHTML = `
    <table class="line-items-table">
      <thead>
        <tr>
          <th style="width:38%;">Item</th>
          <th style="width:28%;">Qty</th>
          <th style="width:18%;">Unit Price</th>
          <th style="width:12%;">Total</th>
          <th style="width:4%;"></th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>

    <div class="muted tiny" style="margin-top:8px;">
      Tip: For sqm lines, "Auto" uses the room's area as the Qty. Untick it to override the Qty.
    </div>
  `;

  // Wire events
  room.data.lines.forEach((ln) => {
    const on = document.getElementById(`lineOn_${ln.id}`);
    const qty = document.getElementById(`lineQty_${ln.id}`);
    const price = document.getElementById(`linePrice_${ln.id}`);
    const auto = document.getElementById(`lineAuto_${ln.id}`);

    if (on) {
      on.addEventListener("change", () => {
        // Flooring always on
        if (ln.id === "flooring") {
          on.checked = true;
          ln.selected = true;
          return;
        }
        ln.selected = !!on.checked;

        // If just turned on, set sensible defaults
        if (ln.selected) {
          const geo = computeAreaValues();
          if (ln.unit === "sqm" && ln.autoQty && geo.hasGeometry) {
            ln.qty = geo.roomArea;
            if (qty) qty.value = Number(ln.qty).toFixed(2);
          }
          if (ln.qty <= 0 && ln.unit !== "sqm") {
            ln.qty = 1;
            if (qty) qty.value = "1.00";
          }
        }

        calculateRoom(true);
      });
    }

    if (qty) {
      qty.addEventListener("input", () => {
        ln.qty = parseFloat(qty.value) || 0;
        if (ln.unit === "sqm") ln.autoQty = false; // typing implies override
        if (auto) auto.checked = ln.autoQty;
        calculateRoom(true);
      });
    }

    if (price) {
      price.addEventListener("input", () => {
        ln.unitPrice = parseFloat(price.value) || 0;
        if (ln.source === "accessory") ln.priceOverridden = true;
        calculateRoom(true);
      });
    }

    if (auto) {
      auto.addEventListener("change", () => {
        ln.autoQty = !!auto.checked;
        if (ln.autoQty && ln.unit === "sqm") {
          const geo = computeAreaValues();
          if (geo.hasGeometry) {
            ln.qty = geo.roomArea;
            if (qty) qty.value = Number(ln.qty).toFixed(2);
          }
        }
        calculateRoom(true);
      });
    }
  });

  // Remove custom line handlers
  container.querySelectorAll("button[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const lineId = btn.getAttribute("data-remove");
      removeCustomLine(lineId);
    });
  });
}

function addCustomLine() {
  if (!activeRoomId) return;
  const room = rooms.find((r) => r.id === activeRoomId);
  if (!room) return;

  const label = prompt("Custom line name (e.g. Labour, Screed, Discount):");
  if (!label) return;

  normaliseRoomLines(room);

  const id = `custom_${Date.now()}`;
  room.data.lines.push({
    id,
    label,
    unit: "each",
    selected: true,
    qty: 1,
    autoQty: false,
    unitPrice: 0,
    total: 0,
    source: "custom",
  });

  renderRoomLineItems(room);
  calculateRoom(true);
}

function removeCustomLine(lineId) {
  if (!activeRoomId) return;
  const room = rooms.find((r) => r.id === activeRoomId);
  if (!room) return;

  room.data.lines = (room.data.lines || []).filter((l) => l.id !== lineId);
  renderRoomLineItems(room);
  calculateRoom(true);
}

//------------------------------------------------------
// CALCULATE ROOM & AUTO-SAVE (OPTIMISED)
//------------------------------------------------------
function calculateRoom(auto = false) {
  const resultDiv = document.getElementById("result");
  const savedMsg = document.getElementById("roomSavedMsg");
  if (savedMsg) savedMsg.textContent = "";

  if (!activeRoomId) return;

  const room = rooms.find((r) => r.id === activeRoomId);
  if (!room) return;

  const geometry = computeAreaValues();
  if (!geometry.hasGeometry) {
    resultDiv.innerHTML = "";
    return;
  }

  normaliseRoomLines(room);

  // Persist geometry
  room.data.length = parseFloat(document.getElementById("length").value) || 0;
  room.data.width = parseFloat(document.getElementById("widthInput").value) || 0;
  room.data.roomArea = geometry.roomArea;

  // Sync auto sqm lines
  room.data.lines.forEach((ln) => {
    if (ln.unit === "sqm" && ln.autoQty) {
      ln.qty = geometry.roomArea;
      const qtyInput = document.getElementById(`lineQty_${ln.id}`);
      if (qtyInput) qtyInput.value = Number(ln.qty).toFixed(2);
    }
  });

  // Calculate totals
  let lineTotal = 0;
  const breakdown = [];

  room.data.lines.forEach((ln) => {
    const isIncluded = ln.id === "flooring" ? true : !!ln.selected;
    ln.selected = isIncluded;

    if (!isIncluded) {
      ln.total = 0;
      const t = document.getElementById(`lineTotal_${ln.id}`);
      if (t) t.textContent = "£0.00";
      return;
    }

    const qty = Number(ln.qty) || 0;
    const unitPrice = Number(ln.unitPrice) || 0;
    const total = qty * unitPrice;

    ln.total = total;
    lineTotal += total;

    const t = document.getElementById(`lineTotal_${ln.id}`);
    if (t) t.textContent = `£${total.toFixed(2)}`;

    breakdown.push(
      `${escapeHtml(ln.label)}: £${total.toFixed(2)} (${qty.toFixed(2)} ${unitDisplay(ln.unit)} @ £${unitPrice.toFixed(2)})`
    );
  });

  room.data.lineTotal = lineTotal;

  resultDiv.innerHTML = `
    <div class="cost-block">
      <strong>${escapeHtml(room.name)} Summary</strong><br>
      Room area: ${geometry.roomArea.toFixed(2)} m²<br><br>
      ${breakdown.length ? breakdown.join("<br>") : "No items selected"}<br><br>
      <strong>Room total (ex VAT): £${lineTotal.toFixed(2)}</strong>
    </div>
  `;

  room.data.resultHtml = resultDiv.innerHTML;

  updateRoomList();
  updateStickyFooter();
  renderQuote();

  // OPTIMISED: debounced auto-save instead of per-keystroke network calls
  autoUpdateCurrentCustomer();

  if (!auto && savedMsg) {
    savedMsg.textContent = "✓ Room saved";
    setTimeout(() => (savedMsg.textContent = ""), 1500);
  }
}

function updateStickyFooter() {
  const footerRooms = document.getElementById("footerRoomCount");
  const footerTotal = document.getElementById("footerTotal");
  if (!footerRooms || !footerTotal) return;

  const total = rooms.reduce((sum, r) => sum + (r.data?.lineTotal || 0), 0);
  footerRooms.textContent = `${rooms.length} room${rooms.length === 1 ? "" : "s"}`;
  footerTotal.textContent = `£${total.toFixed(2)} ex VAT`;
}

//------------------------------------------------------
// QUOTE BUILDER
//------------------------------------------------------
function renderQuote() {
  const container = document.getElementById("quoteContent");
  if (!container) return;

  if (!rooms.length) {
    container.innerHTML = `<p class="muted">No rooms calculated yet.</p>`;
    return;
  }

  const notes = document.getElementById("quoteNotes")?.value || "";
  const custName = document.getElementById("customerName").value.trim() || "Customer";
  const jobRef = document.getElementById("jobRef").value.trim();
  const dateStr = new Date().toLocaleDateString("en-GB");

  if (!window.currentQuoteNumber) {
      window.currentQuoteNumber = generateQuoteNumber();
 }
 const quoteNumber = window.currentQuoteNumber;



  const showLines = !!document.getElementById("quoteShowLineItems")?.checked;

  let totalExVat = 0;

  const roomRows = rooms
    .map((r) => {
      const d = r.data;
      if (!d || !d.lineTotal) return "";

      totalExVat += d.lineTotal;

      const lineItemsHtml = showLines
        ? buildQuoteLineItems(r)
        : "";

      return `
        <tr>
          <td>
            <strong>${escapeHtml(r.name)}</strong>
            ${lineItemsHtml}
          </td>
          <td>${(d.roomArea || 0).toFixed(2)} m²</td>
          <td>£${(d.lineTotal || 0).toFixed(2)}</td>
        </tr>
      `;
    })
    .join("");

  const vat = totalExVat * VAT_RATE;
  const grandTotal = totalExVat + vat;

container.innerHTML = `
  ${buildBusinessQuoteHeader()}

  <div class="quote-customer-block">
    <strong>Quote No:</strong> ${quoteNumber}<br>
    <strong>Quote for:</strong> ${escapeHtml(custName)}<br>
    ${jobRef ? `<strong>Job Ref:</strong> ${escapeHtml(jobRef)}<br>` : ""}
    <strong>Date:</strong> ${dateStr}
  </div>

    <table class="quote-rooms-table">
      <thead>
        <tr>
          <th>Room</th>
          <th>Area</th>
          <th>Total (ex VAT)</th>
        </tr>
      </thead>
      <tbody>${roomRows}</tbody>
    </table>

    <div class="quote-totals">
      <div><strong>Project total (ex VAT): £${totalExVat.toFixed(2)}</strong></div>
      <div>VAT @ ${(VAT_RATE * 100).toFixed(0)}%: £${vat.toFixed(2)}</div>
      <div><strong>Grand total (inc VAT): £${grandTotal.toFixed(2)}</strong></div>
    </div>

    ${notes.trim()
      ? `
      <div class="quote-notes-display">
        <strong>Notes / Terms</strong><br>
        ${escapeHtml(notes).replace(/\n/g, "<br>")}
      </div>
    `
      : ""}
  `;
}

function buildQuoteLineItems(room) {
  const lines = (room.data?.lines || []).filter((l) => l.id === "flooring" || l.selected);
  if (!lines.length) return "";

  const rows = lines
    .filter((l) => (Number(l.total) || 0) > 0)
    .map((l) => {
      const qty = Number(l.qty) || 0;
      const price = Number(l.unitPrice) || 0;
      const total = Number(l.total) || 0;
      return `
        <div class="quote-line-row">
          <span class="quote-line-name">${escapeHtml(l.label)}</span>
          <span class="quote-line-meta">${qty.toFixed(2)} ${unitDisplay(l.unit)} @ £${price.toFixed(2)}</span>
          <span class="quote-line-total">£${total.toFixed(2)}</span>
        </div>
      `;
    })
    .join("");

  return `<div class="quote-lines">${rows}</div>`;
}

//------------------------------------------------------
// CUSTOMER SAVE / LOAD (CLOUD-ONLY, OPTIMISED)
//------------------------------------------------------
async function saveCustomer() {
  const name = document.getElementById("customerName").value.trim();
  const jobRef = document.getElementById("jobRef").value.trim();

  if (!name) {
    alert("Enter a customer name.");
    return;
  }

  if (!isSignedIn()) { requireAuth(); return; }

  // Ensure this customer has a stable quote number
  if (!window.currentQuoteNumber) window.currentQuoteNumber = generateQuoteNumber();
  const record = { name, jobRef, rooms, quoteNumber: window.currentQuoteNumber, timestamp: Date.now() };

  // OPTIMISED: use cache, no re-fetch
  const cloud = await getCloudData();
  const customers = Array.isArray(cloud.customers) ? cloud.customers : [];

  const idx = customers.findIndex((c) => c.name === name);
  if (idx >= 0) customers[idx] = record;
  else customers.push(record);

  markCloudDirty("customers", customers);
  await flushSave(); // explicit save button = flush immediately

  renderSavedCustomersList(_cloudCache);
  alert("Customer saved!");
}

/** OPTIMISED: debounced auto-save — no network call per keystroke */
function autoUpdateCurrentCustomer() {
  const name = document.getElementById("customerName").value.trim();
  if (!name || !isSignedIn()) return;

  const jobRef = document.getElementById("jobRef").value.trim();
  const record = { name, jobRef, rooms, quoteNumber: window.currentQuoteNumber || null, timestamp: Date.now() };

  if (!_cloudCache) _cloudCache = {};
  const customers = Array.isArray(_cloudCache.customers) ? _cloudCache.customers : [];

  const idx = customers.findIndex((c) => c.name === name);
  if (idx >= 0) customers[idx] = record;
  else customers.push(record);

  // Mark dirty — the debounced scheduler will batch this with other changes
  markCloudDirty("customers", customers);
}

/** Render the saved customers list from a cloud data object (no fetch needed) */
function renderSavedCustomersList(cloud) {
  const list = document.getElementById("savedCustomersList");
  list.innerHTML = "";

  if (!isSignedIn() || !cloud) return;

  const customers = Array.isArray(cloud.customers) ? cloud.customers : [];
  const query = (document.getElementById("customerSearch")?.value || "").trim().toLowerCase();

  const filtered = customers
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    .filter((c) => {
      if (!query) return true;
      return (
        c.name.toLowerCase().includes(query) ||
        (c.jobRef && c.jobRef.toLowerCase().includes(query))
      );
    });

  if (!filtered.length && customers.length > 0 && query) {
    list.innerHTML = `<li class="no-results muted">No customers match "${escapeHtml(query)}"</li>`;
    return;
  }

  filtered.forEach((c) => {
    const li = document.createElement("li");
    const text = document.createElement("span");
    const del = document.createElement("span");

    text.textContent = c.jobRef ? `${c.name} (${c.jobRef})` : c.name;
    del.textContent = "✕";
    del.className = "delete-btn";

    text.addEventListener("click", () => loadCustomer(c));
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteCustomer(c.name);
    });

    li.appendChild(text);
    li.appendChild(del);
    list.appendChild(li);
  });
}

function loadCustomer(c) {
  if (!c) return;

  document.getElementById("customerName").value = c.name || "";
  document.getElementById("jobRef").value = c.jobRef || "";

  // Restore the stable quote number for this customer
  window.currentQuoteNumber = c.quoteNumber || null;

  rooms = Array.isArray(c.rooms) ? c.rooms : [];
  activeRoomId = rooms.length ? rooms[0].id : null;

  rooms.forEach((r, i) => {
    if (typeof r.collapsed !== "boolean") r.collapsed = i !== 0;
    normaliseRoomLines(r);
  });

  updateRoomList();

  if (activeRoomId) loadRoom(activeRoomId);
  else {
    clearRoomForm();
    showRoomForm(false);
    document.getElementById("roomTitle").textContent = "No room selected";
    document.getElementById("result").innerHTML = "";
  }

  updateStickyFooter();
  renderQuote();
}

async function deleteCustomer(name) {
  if (!isSignedIn()) { requireAuth(); return; }

  // OPTIMISED: use cache, no re-fetch
  const cloud = await getCloudData();
  const customers = Array.isArray(cloud.customers) ? cloud.customers : [];

  markCloudDirty("customers", customers.filter((c) => c.name !== name));
  await flushSave();

  rooms = [];
  activeRoomId = null;

  renderSavedCustomersList(_cloudCache);

  clearRoomForm();
  showRoomForm(false);
  document.getElementById("roomTitle").textContent = "No room selected";
  document.getElementById("result").innerHTML = "";

  updateStickyFooter();
  renderQuote();
}

function newCustomer() {
  window.currentQuoteNumber = null;
  document.getElementById("customerName").value = "";
  document.getElementById("jobRef").value = "";
  rooms = [];
  activeRoomId = null;
  updateRoomList();
  clearRoomForm();
  showRoomForm(false);
  document.getElementById("roomTitle").textContent = "No room selected";
  document.getElementById("result").innerHTML = "";
  updateStickyFooter();
  renderQuote();
}

//------------------------------------------------------
// HELPERS
//------------------------------------------------------
function safeSetValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value ?? "";
}

function getValue(id) {
  const el = document.getElementById(id);
  return el ? (el.value || "").trim() : "";
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function unitLabel(unit) {
  const u = String(unit || "").toLowerCase();
  if (u === "sqm") return "m²";
  if (u === "lm") return "lm";
  if (u === "each") return "each";
  if (u === "box") return "box";
  return u || "—";
}

function unitDisplay(unit) {
  const u = String(unit || "").toLowerCase();
  if (u === "sqm") return "m²";
  if (u === "lm") return "lm";
  if (u === "each") return "each";
  if (u === "box") return "box";
  return u || "";
}

function buildBusinessQuoteHeader() {
  if (!businessProfile) return "";

  const {
    logoUrl,
    businessName,
    contactName,
    address1,
    address2,
    town,
    postcode,
    phone,
    email,
    website,
    vatNumber
  } = businessProfile;

  const logoHtml = logoUrl
    ? `<div class="quote-logo"><img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(businessName || "")}" class="quote-logo__img"></div>`
    : "";

  return `
    <div class="quote-header">
      ${logoHtml}
      <div class="quote-business">
        <strong>${escapeHtml(businessName || "")}</strong><br>
        ${contactName ? escapeHtml(contactName) + "<br>" : ""}
        ${address1 ? escapeHtml(address1) + "<br>" : ""}
        ${address2 ? escapeHtml(address2) + "<br>" : ""}
        ${town ? escapeHtml(town) + "<br>" : ""}
        ${postcode ? escapeHtml(postcode) + "<br>" : ""}
        ${phone ? "T: " + escapeHtml(phone) + "<br>" : ""}
        ${email ? "E: " + escapeHtml(email) + "<br>" : ""}
        ${website ? escapeHtml(website) + "<br>" : ""}
        ${vatNumber ? `<strong>VAT:</strong> ${escapeHtml(vatNumber)}` : ""}
      </div>
    </div>
  `;
}

function generateQuoteNumber() {
  const now = new Date();
  return `Q-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,"0")}${String(now.getDate()).padStart(2,"0")}-${now.getTime().toString().slice(-5)}`;
}
