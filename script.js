//------------------------------------------------------
// GLOBAL DATA
//------------------------------------------------------
let rooms = [];
let activeRoomId = null;
let SYSTEM_ACCESSORIES = [];


const CUSTOMER_KEY = "measureiq_customers_v1";
const ACCESSORY_DEFS_KEY = "measureiq_accessories_definitions_v1";
const BUSINESS_PROFILE_KEY = "measureiq_business_profile_v1";
const AUTH_TOKEN_KEY = "measureiq_auth_token_v1";
const API_BASE = "https://measureiq-production.up.railway.app";

let authUser = null; // { email }
const VAT_RATE = 0.2;

let accessoriesDefs = []; // dynamic accessories (name, unit, price)
let businessProfile = null;

//------------------------------------------------------
// INITIALISE APP
//------------------------------------------------------

function unlockApp() {
    document.body.classList.remove("locked");
    const overlay = document.querySelector(".lock-overlay");
    if (overlay) overlay.style.display = "none";
}

document.addEventListener("DOMContentLoaded", () => {
    // Load system accessories
    fetch("data/accessories.json")
        .then(res => res.json())
        .then(data => {
            SYSTEM_ACCESSORIES = (data.systemAccessories || []).map(acc => ({
                id: acc.id,
                name: acc.name,
                unit: acc.unit,
                category: acc.category || "Other"
            }));   
        })
        .catch(err => console.error("Error loading data/accessories.json", err));

    // Buttons & events
    document.getElementById("addRoomBtn").addEventListener("click", addRoom);
    document.getElementById("editRoomBtn").addEventListener("click", renameRoom);
    document.getElementById("deleteRoomBtn").addEventListener("click", deleteRoom);

    document.getElementById("saveCustomerBtn").addEventListener("click", saveCustomer);
    document.getElementById("newCustomerBtn").addEventListener("click", newCustomer);

    document.getElementById("calculateBtn").addEventListener("click", () => calculateRoom(false));

    ["length", "widthInput"].forEach(id => {
    const el = document.getElementById(id);
    el?.addEventListener("input", () => calculateRoom(true));
    });

    // Internal summary print
    document.getElementById("printBtn").addEventListener("click", () => window.print());

    // Items & pricing
    document.getElementById("saveAccessoriesBtn").addEventListener("click", saveAccessoryDefinitions);

    // Business profile
    document.getElementById("saveBusinessProfileBtn").addEventListener("click", saveBusinessProfile);

    // Quote controls
    document.getElementById("quoteShowAccessories").addEventListener("change", () => renderQuote());
    document.getElementById("quoteNotes").addEventListener("input", () => renderQuote());
    document.getElementById("quotePrintBtn").addEventListener("click", () => window.print());

    setupTabs();
    setupAuthUI();
    initCloudOnly(); // Cloud-only: require login, then load data from Neon
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

    const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers
    });

    let data = null;
    const contentType = res.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
        data = await res.json();
    } else {
        data = await res.text();
    }

    if (!res.ok) {
        const msg =
            (data && data.error)
                ? data.error
                : (typeof data === "string" ? data : "Request failed");
        throw new Error(msg);
    }

    return data;
}

function setAuthUI() {
    const status = document.getElementById("authStatus");
    const logoutBtn = document.getElementById("logoutBtn");
    const openBtn = document.getElementById("openAuthBtn");

    const signedIn = !!authUser;

    if (signedIn) {
        status.textContent = `Signed in as ${authUser.email || "user"}`;
        logoutBtn.style.display = "inline-block";
        openBtn.style.display = "none";
    } else {
        status.textContent = "Not signed in";
        logoutBtn.style.display = "none";
        openBtn.style.display = "inline-block";
    }
}

function openAuthModal() {
    // 🔑 KEY FIX: hide lock overlay when auth modal opens
    lockApp(false);

    document.getElementById("authModal").style.display = "flex";
}


function closeAuthModal() {
    document.getElementById("authModal").style.display = "none";
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
        // Token invalid/expired
        setToken(null);
        authUser = null;
    }
    setAuthUI();
}

function setupAuthUI() {
    const openBtn = document.getElementById("openAuthBtn");
    const closeBtn = document.getElementById("closeAuthModalBtn");
    const modal = document.getElementById("authModal");
    const logoutBtn = document.getElementById("logoutBtn");

    openBtn?.addEventListener("click", openAuthModal);
    document.getElementById("lockSignInBtn")?.addEventListener("click", openAuthModal);
    closeBtn?.addEventListener("click", closeAuthModal);
    modal?.addEventListener("click", (e) => {
        if (e.target?.id === "authModal") closeAuthModal();
    });

    document.getElementById("loginBtn")?.addEventListener("click", async (e) => {
        e.preventDefault();
        const msg = document.getElementById("loginMsg");
        msg.textContent = "";
        try {
            const email = document.getElementById("loginEmail").value.trim();
            const password = document.getElementById("loginPassword").value;
            const data = await apiFetch("/api/auth/login", {
                method: "POST",
                body: JSON.stringify({ email, password })
            });
            setToken(data.token);
            await hydrateAuthUser();
            await syncFromCloud();
            unlockApp();
            closeAuthModal();
        } catch (e) {
            msg.textContent = e.message;
        }
    });

    // Forgot password
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
            body: JSON.stringify({ email })
        });

        msg.textContent =
            "If an account exists for that email, a password reset link has been sent.";
    } catch {
        msg.textContent = "Something went wrong. Please try again.";
    }
});


    document.getElementById("registerBtn")?.addEventListener("click", async (e) => {
        e.preventDefault();
        const msg = document.getElementById("registerMsg");
        msg.textContent = "";
        try {
            const email = document.getElementById("registerEmail").value.trim();
            const password = document.getElementById("registerPassword").value;
            const data = await apiFetch("/api/auth/register", {
                method: "POST",
                body: JSON.stringify({ email, password })
            });
            setToken(data.token);
            await hydrateAuthUser();
            await syncToCloud();
            unlockApp();
            closeAuthModal();
        } catch (e) {
            msg.textContent = e.message;
        }
    });

    logoutBtn?.addEventListener("click", () => {
        setToken(null);
        authUser = null;
        setAuthUI();
        lockApp(true);
        openAuthModal();
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

function requireAuth() {
    if (isSignedIn()) return true;
    lockApp(true);
    openAuthModal();
    throw new Error("Please sign in to use MeasureIQ.");
}

async function initCloudOnly() {
    try {
        await hydrateAuthUser();
    } catch {}
    if (!isSignedIn()) {
        lockApp(true);
        openAuthModal();
        // Do not load any data until signed in
        return;
    }
    lockApp(false);
    await syncFromCloud();
    showRoomForm(false);
}


// When switching to cloud mode, prefer loading from cloud into the UI.
async function syncFromCloud() {
    await Promise.all([
        loadBusinessProfile(),
        loadAccessoryDefinitions(),
        loadSavedCustomers()
    ]);
}

// On first register, push any existing local data up to the cloud.
async function syncToCloud() {
    // Cloud-only: no local data to migrate
}

//------------------------------------------------------
// TABS
//------------------------------------------------------
function setupTabs() {
    const buttons = document.querySelectorAll(".tab-btn");
    const panels = {
        calculatorSection: document.getElementById("calculatorSection"),
        accessoriesSection: document.getElementById("accessoriesSection"),
        summarySection: document.getElementById("summarySection"),
        quoteSection: document.getElementById("quoteSection"),
        businessProfileSection: document.getElementById("businessProfileSection")
    };

    buttons.forEach(btn => {
        btn.addEventListener("click", () => {
            const target = btn.dataset.tab;

            buttons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            Object.entries(panels).forEach(([id, panel]) => {
                panel.style.display = (id === target) ? "block" : "none";
            });

            if (target === "quoteSection") {
                renderQuote();
            }
        });
    });
}

//------------------------------------------------------
// BUSINESS PROFILE
//------------------------------------------------------
async function loadBusinessProfile() {
    // Cloud-only: business profile is stored inside user_data.data.businessProfile
    let cloud = null;

    if (isSignedIn()) {
        try {
            cloud = await apiFetch("/api/load", { method: "GET" });
        } catch (e) {
            cloud = null;
        }
    }

    const defaults = {
        businessName: "",
        contactName: "",
        address1: "",
        address2: "",
        town: "",
        postcode: "",
        phone: "",
        email: "",
        website: "",
        vatNumber: "",
        showAccessoriesOnQuote: false,
        defaultNotes: ""
    };

    const saved = cloud && cloud.businessProfile && typeof cloud.businessProfile === "object"
        ? cloud.businessProfile
        : null;

    businessProfile = { ...defaults, ...(saved || {}) };

    applyBusinessProfileToUI();
}

function applyBusinessProfileToUI() {
    // Populate Business Profile form
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
    const bpShowAcc = document.getElementById("bpShowAccessories");
    if (bpShowAcc) bpShowAcc.checked = !!businessProfile.showAccessoriesOnQuote;
    safeSetValue("bpDefaultNotes", businessProfile.defaultNotes);

    // Quote controls: only set defaults if they are currently blank/uninitialised

    const showAccCheckbox = document.getElementById("quoteShowAccessories");
    if (showAccCheckbox && !showAccCheckbox.dataset.initialised) {
        showAccCheckbox.checked = !!businessProfile.showAccessoriesOnQuote;
        showAccCheckbox.dataset.initialised = "true";
    }

    const notesArea = document.getElementById("quoteNotes");
    if (notesArea && notesArea.value.trim() === "" && businessProfile.defaultNotes) {
        notesArea.value = businessProfile.defaultNotes;
    }
}

async function saveBusinessProfile() {
    businessProfile = {
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
        showAccessoriesOnQuote: !!document.getElementById("bpShowAccessories").checked,
        defaultNotes: getValue("bpDefaultNotes")
    };

    if (!isSignedIn()) {
        requireAuth();
        return;
    }

    const cloud = await apiFetch("/api/load", { method: "GET" });
    cloud.businessProfile = businessProfile;

    await apiFetch("/api/save", {
        method: "POST",
        body: JSON.stringify(cloud)
    });

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

    const room = {
        id: Date.now(),
        name,
        data: {}
    };

    rooms.push(room);
    activeRoomId = room.id;

    updateRoomList();
    loadRoom(room.id);
}

function renameRoom() {
    if (!activeRoomId) return;
    const room = rooms.find(r => r.id === activeRoomId);
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
    const room = rooms.find(r => r.id === activeRoomId);
    if (!room) return;

    const ok = confirm(`Delete room "${room.name}"?`);
    if (!ok) return;

    rooms = rooms.filter(r => r.id !== activeRoomId);
    activeRoomId = rooms.length ? rooms[0].id : null;

    updateRoomList();

    if (activeRoomId) {
        loadRoom(activeRoomId);
    } else {
        clearRoomForm();
        showRoomForm(false);
        document.getElementById("roomTitle").textContent = "No room selected";
        document.getElementById("result").innerHTML = "";
    }

    updateSummary();
    renderQuote();
}

function updateRoomList() {
    const list = document.getElementById("roomList");
    list.innerHTML = "";

    rooms.forEach(room => {
        const li = document.createElement("li");
        const btn = document.createElement("button");

        btn.className = "btn secondary";
        btn.textContent = room.name;

        if (room.id === activeRoomId) btn.style.fontWeight = "700";

        btn.addEventListener("click", () => {
            activeRoomId = room.id;
            updateRoomList();
            loadRoom(room.id);
        });

        li.appendChild(btn);
        list.appendChild(li);
    });
}

function clearRoomForm() {
    document.getElementById("length").value = "";
    document.getElementById("widthInput").value = "";
    document.getElementById("result").innerHTML = "";
    document.getElementById("roomSavedMsg").textContent = "";

    const container = document.getElementById("roomAccessories");
    if (container) {
        container.innerHTML = "";
    }
}

function loadRoom(id) {
    const room = rooms.find(r => r.id === id);
    if (!room) return;

    showRoomForm(true);
    clearRoomForm();
    document.getElementById("roomTitle").textContent = room.name;

    const d = room.data || {};

    if (d.length) document.getElementById("length").value = d.length;
    if (d.width) document.getElementById("widthInput").value = d.width;

    renderRoomAccessoriesPanel(d.accessories || null);

    if (d.resultHtml) {
        document.getElementById("result").innerHTML = d.resultHtml;
    } else {
        document.getElementById("result").innerHTML = "";
    }

    calculateRoom(true); // refresh totals silently
}

//------------------------------------------------------
// ACCESSORY DEFINITIONS (GLOBAL LIST)
//------------------------------------------------------
function buildAccessories(system, userPrices = {}) {
    return system.map(acc => ({
        id: acc.id,
        name: acc.name,
        unit: acc.unit,
        category: acc.category || "Other",
        price: Number(userPrices[acc.id]) || 0
    }));
}

async function loadAccessoryDefinitions() {
    let cloud = null;

    if (isSignedIn()) {
        try {
            cloud = await apiFetch("/api/load", { method: "GET" });
        } catch {
            cloud = null;
        }
    }

    const userPrices =
        cloud && cloud.accessoryPrices && typeof cloud.accessoryPrices === "object"
            ? cloud.accessoryPrices
            : {};

    accessoriesDefs = buildAccessories(SYSTEM_ACCESSORIES, userPrices);

    renderAccessoriesPricingPanel();
    renderRoomAccessoriesPanel(getActiveRoomAccessories());
}

async function saveAccessoryDefinitions() {
    const container = document.getElementById("accessoriesPricingList");
    if (!container) return;

    const prices = {};

    container.querySelectorAll("tbody tr[data-id]").forEach(row => {
        const id = row.getAttribute("data-id");
        const priceInput = document.getElementById(`accDefPrice_${id}`);
        prices[id] = parseFloat(priceInput.value) || 0;
    });

    if (!isSignedIn()) {
        requireAuth();
        return;
    }

    const cloud = await apiFetch("/api/load", { method: "GET" });
    cloud.accessoryPrices = prices;

    await apiFetch("/api/save", {
        method: "POST",
        body: JSON.stringify(cloud)
    });

    const msg = document.getElementById("accessoriesSavedMsg");
    msg.textContent = "Saved";
    setTimeout(() => (msg.textContent = ""), 1500);

    accessoriesDefs = buildAccessories(SYSTEM_ACCESSORIES, prices);
    renderRoomAccessoriesPanel(getActiveRoomAccessories());
    calculateRoom(true);
    renderQuote();
}

function renderAccessoriesPricingPanel() {
    const container = document.getElementById("accessoriesPricingList");
    if (!container) return;

    if (!accessoriesDefs.length) {
        container.innerHTML = `<p class="muted">No accessories configured.</p>`;
        return;
    }

    // Group by category
    const grouped = accessoriesDefs.reduce((acc, def) => {
        const cat = def.category || "Other";
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(def);
        return acc;
    }, {});

    // Stable category order (alphabetical, but "Other" last)
    const orderedCategories = Object.keys(grouped).sort((a, b) => {
        if (a === "Other") return 1;
        if (b === "Other") return -1;
        return a.localeCompare(b);
    });

    const rowsHtml = orderedCategories.map(category => {
        const defs = grouped[category];

        const headerRow = `
            <tr class="category-row">
                <td colspan="3"><strong>${escapeHtml(category)}</strong></td>
            </tr>
        `;

        const rows = defs.map(def => `
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
        `).join("");

        return headerRow + rows;
    }).join("");

    container.innerHTML = `
        <table class="summary-table accessories-table">
            <thead>
                <tr>
                    <th>Name</th>
                    <th>Unit</th>
                    <th>Price (£ ex VAT)</th>
                </tr>
            </thead>
            <tbody>
                ${rowsHtml}
            </tbody>
        </table>
    `;
}


function getActiveRoomAccessories() {
    const room = rooms.find(r => r.id === activeRoomId);
    if (!room || !room.data || !room.data.accessories) return null;
    return room.data.accessories;
}

//------------------------------------------------------
// RENDER LINE ITEMS IN ROOM PANEL
//------------------------------------------------------
function renderRoomAccessoriesPanel(savedAccessories) {
    const container = document.getElementById("roomAccessories");
    if (!container) return;

    container.innerHTML = "";

    if (!accessoriesDefs.length) {
        container.innerHTML = `<p class="muted">No accessories defined. Add them in the "Accessories Pricing" tab.</p>`;
        return;
    }

    const geometry = computeAreaValues();

    accessoriesDefs.forEach(def => {
        const row = document.createElement("div");
        row.className = "accessory-room-row";

        const label = document.createElement("label");
        label.className = "checkbox";

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.id = `acc_${def.id}`;

        const stored = savedAccessories && savedAccessories[def.id];
        if (stored && stored.selected) cb.checked = true;

        const text = document.createElement("span");
        text.textContent = `${def.name} (${unitLabel(def.unit)})`;

        label.appendChild(cb);
        label.appendChild(text);

        const qtyWrapper = document.createElement("div");
        qtyWrapper.className = "accessory-qty";

        const qtyLabel = document.createElement("span");
        qtyLabel.textContent = "Qty:";

        const qtyInput = document.createElement("input");
        qtyInput.type = "number";
        qtyInput.step = "0.01";
        qtyInput.min = "0";
        qtyInput.id = `accQty_${def.id}`;

        let qtyVal = 0;

        if (stored && typeof stored.qty === "number") {
            qtyVal = stored.qty;
        } else if (def.id === "doorbars") {
            qtyVal = 1;
        } else if (def.unit === "sqm" && geometry.hasGeometry) {
            qtyVal = geometry.roomArea;
        }

        qtyInput.value = qtyVal.toFixed(2);

        qtyWrapper.appendChild(qtyLabel);
        qtyWrapper.appendChild(qtyInput);

        row.appendChild(label);
        row.appendChild(qtyWrapper);

        container.appendChild(row);

        cb.addEventListener("change", () => {
            if (cb.checked) {
                const geo = computeAreaValues();
                let q = parseFloat(qtyInput.value);

                if (!q || q <= 0) {
                    if (def.id === "doorbars") {
                        q = 1;
                    } else if (def.unit === "sqm" && geo.hasGeometry) {
                        q = geo.roomArea;
                    } else {
                        q = 0;
                    }
                    qtyInput.value = q.toFixed(2);
                }
            }

            calculateRoom(true);
            renderQuote();
        });

        qtyInput.addEventListener("input", () => {
            calculateRoom(true);
            renderQuote();
        });
    });
}


//------------------------------------------------------
// GEOMETRY CALC
//------------------------------------------------------
function computeAreaValues() {
    const length = parseFloat(document.getElementById("length").value);
    const width = parseFloat(document.getElementById("widthInput").value);

    if (!length || !width) {
        return {
            hasGeometry: false,
            roomArea: 0
        };
    }

    return {
        hasGeometry: true,
        roomArea: length * width
    };
}


//------------------------------------------------------
// CALCULATE ROOM & AUTO-SAVE
//------------------------------------------------------
function calculateRoom(auto = false) {
    const resultDiv = document.getElementById("result");
    const savedMsg = document.getElementById("roomSavedMsg");
    savedMsg.textContent = "";

    if (!activeRoomId) return;

    const room = rooms.find(r => r.id === activeRoomId);
    if (!room) return;

    const geometry = computeAreaValues();
    if (!geometry.hasGeometry) {
        resultDiv.innerHTML = "";
        return;
    }

    let lineTotal = 0;
    let breakdown = [];
    let accessoriesSelections = {};

    accessoriesDefs.forEach(def => {
        const cb = document.getElementById(`acc_${def.id}`);
        const qtyInput = document.getElementById(`accQty_${def.id}`);
        if (!cb || !qtyInput || !cb.checked) return;

        let qty = parseFloat(qtyInput.value);
        if (!isFinite(qty) || qty <= 0) return;

        const cost = qty * def.price;
        lineTotal += cost;

        breakdown.push(
            `${def.name}: £${cost.toFixed(2)} (${qty.toFixed(2)} ${unitDisplay(def.unit)} @ £${def.price.toFixed(2)})`
        );

        accessoriesSelections[def.id] = {
            selected: true,
            qty,
            unit: def.unit,
            unitPrice: def.price,
            cost
        };
    });

    resultDiv.innerHTML = `
        <div class="cost-block">
            <strong>${escapeHtml(room.name)} Summary</strong><br>
            Room area: ${geometry.roomArea.toFixed(2)} m²<br><br>
            ${breakdown.length ? breakdown.join("<br>") : "No items selected"}<br><br>
            <strong>Room total (ex VAT): £${lineTotal.toFixed(2)}</strong>
        </div>
    `;

    room.data = {
    length: parseFloat(document.getElementById("length").value),
    width: parseFloat(document.getElementById("widthInput").value),
    roomArea: geometry.roomArea,
    lineTotal,
    accessories: accessoriesSelections,
    resultHtml: resultDiv.innerHTML
    };


    updateSummary();
    autoUpdateCurrentCustomer();
    renderQuote();

    if (!auto) {
        savedMsg.textContent = "✓ Room saved";
        setTimeout(() => (savedMsg.textContent = ""), 1500);
    }
}

//------------------------------------------------------
// SUMMARY (INTERNAL)
//------------------------------------------------------
function updateSummary() {
    const contentDiv = document.getElementById("summaryContent");
    if (!contentDiv) return;

    if (!rooms.length) {
        contentDiv.innerHTML = `<p class="muted">No rooms calculated yet.</p>`;
        return;
    }

    let grandTotal = 0;

    const rows = rooms.map(r => {
        const d = r.data;
        if (!d || !d.lineTotal) return "";

        grandTotal += d.lineTotal;

        return `
            <tr>
                <td>${escapeHtml(r.name)}</td>
                <td>${d.roomArea.toFixed(2)} m²</td>
                <td>£${d.lineTotal.toFixed(2)} ex VAT</td>
            </tr>
        `;
    }).join("");

    if (!rows.trim()) {
        contentDiv.innerHTML = `<p class="muted">No rooms calculated yet.</p>`;
        return;
    }

    contentDiv.innerHTML = `
        <table class="summary-table">
            <thead>
                <tr>
                    <th>Room</th>
                    <th>Area</th>
                    <th>Total (ex VAT)</th>
                </tr>
            </thead>
            <tbody>
                ${rows}
            </tbody>
        </table>
        <div class="summary-total">
            Grand Total (ex VAT): £${grandTotal.toFixed(2)}
        </div>
    `;
}


//------------------------------------------------------
// QUOTE BUILDER (CLIENT FACING)
//------------------------------------------------------
function renderQuote() {
    const container = document.getElementById("quoteContent");
    if (!container) return;

    if (!rooms.length) {
        container.innerHTML = `<p class="muted">No rooms calculated yet.</p>`;
        return;
    }

    const notes = document.getElementById("quoteNotes")?.value || "";

    const custName =
        document.getElementById("customerName").value.trim() || "Customer";

    const jobRef = document.getElementById("jobRef").value.trim();
    const dateStr = new Date().toLocaleDateString("en-GB");

    let totalExVat = 0;

    const rows = rooms.map(r => {
        const d = r.data;
        if (!d || !d.lineTotal) return "";

        totalExVat += d.lineTotal;

        return `
            <tr>
                <td>${escapeHtml(r.name)}</td>
                <td>${d.roomArea.toFixed(2)} m²</td>
                <td>£${d.lineTotal.toFixed(2)}</td>
            </tr>
        `;
    }).join("");

    const vat = totalExVat * VAT_RATE;
    const grandTotal = totalExVat + vat;

    container.innerHTML = `
        <div class="quote-customer">
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
            <tbody>${rows}</tbody>
        </table>

        <div class="quote-totals">
            <div><strong>Project total (ex VAT): £${totalExVat.toFixed(2)}</strong></div>
            <div>VAT @ ${(VAT_RATE * 100).toFixed(0)}%: £${vat.toFixed(2)}</div>
            <div><strong>Grand total (inc VAT): £${grandTotal.toFixed(2)}</strong></div>
        </div>

        ${notes.trim() ? `
            <div class="quote-notes-display">
                <strong>Notes / Terms</strong><br>
                ${escapeHtml(notes).replace(/\n/g, "<br>")}
            </div>` : ""}
    `;
}


//------------------------------------------------------
// CUSTOMER SAVE / LOAD / NEW  (CLOUD-ONLY, JSONB)
//------------------------------------------------------
async function saveCustomer() {
    const name = document.getElementById("customerName").value.trim();
    const jobRef = document.getElementById("jobRef").value.trim();

    if (!name) {
        alert("Enter a customer name.");
        return;
    }

    if (!isSignedIn()) {
        requireAuth();
        return;
    }

    const record = {
        name,
        jobRef,
        rooms,
        timestamp: Date.now()
    };

    // Load existing cloud data
    const cloud = await apiFetch("/api/load", { method: "GET" });

    const customers = Array.isArray(cloud.customers) ? cloud.customers : [];

    // Upsert by name
    const idx = customers.findIndex(c => c.name === name);
    if (idx >= 0) customers[idx] = record;
    else customers.push(record);

    cloud.customers = customers;

    await apiFetch("/api/save", {
        method: "POST",
        body: JSON.stringify(cloud)
    });

    await loadSavedCustomers();
    alert("Customer saved!");
}

async function autoUpdateCurrentCustomer() {
    const name = document.getElementById("customerName").value.trim();
    if (!name || !isSignedIn()) return;

    const jobRef = document.getElementById("jobRef").value.trim();

    const record = {
        name,
        jobRef,
        rooms,
        timestamp: Date.now()
    };

    try {
        const cloud = await apiFetch("/api/load", { method: "GET" });
        const customers = Array.isArray(cloud.customers) ? cloud.customers : [];

        const idx = customers.findIndex(c => c.name === name);
        if (idx >= 0) customers[idx] = record;
        else customers.push(record);

        cloud.customers = customers;

        apiFetch("/api/save", {
            method: "POST",
            body: JSON.stringify(cloud)
        }).catch(() => {});
    } catch {
        // silent
    }
}

async function loadSavedCustomers() {
    const list = document.getElementById("savedCustomersList");
    list.innerHTML = "";

    if (!isSignedIn()) return;

    let cloud;
    try {
        cloud = await apiFetch("/api/load", { method: "GET" });
    } catch (e) {
        console.error("Failed to load cloud data", e);
        return;
    }

    const customers = Array.isArray(cloud.customers) ? cloud.customers : [];

    customers
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        .forEach(c => {
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

//------------------------------------------------------
// CUSTOMER + ROOM LOAD / DELETE / NEW (CLOUD-ONLY)
//------------------------------------------------------

function loadCustomer(c) {
    if (!c) return;

    currentCustomer = c;

    document.getElementById("customerName").value = c.name || "";
    document.getElementById("jobRef").value = c.jobRef || "";

    // Rooms ALWAYS come from the customer
    rooms = Array.isArray(c.rooms) ? c.rooms : [];
    activeRoomId = rooms.length ? rooms[0].id : null;

    updateRoomList();

    if (activeRoomId) {
        loadRoom(activeRoomId);
    } else {
        clearRoomForm();
        showRoomForm(false);
        document.getElementById("roomTitle").textContent = "No room selected";
        document.getElementById("result").innerHTML = "";
    }

    updateSummary();
    renderQuote();
}

async function deleteCustomer(name) {
    if (!isSignedIn()) {
        requireAuth();
        return;
    }

    const cloud = await apiFetch("/api/load", { method: "GET" });
    const customers = Array.isArray(cloud.customers) ? cloud.customers : [];

    cloud.customers = customers.filter(c => c.name !== name);

    await apiFetch("/api/save", {
        method: "POST",
        body: JSON.stringify(cloud)
    });

    currentCustomer = null;
    rooms = [];
    activeRoomId = null;

    await loadSavedCustomers();

    clearRoomForm();
    showRoomForm(false);
    document.getElementById("roomTitle").textContent = "No room selected";
    document.getElementById("result").innerHTML = "";
    document.getElementById("summaryContent").innerHTML =
        `<p class="muted">No rooms calculated yet.</p>`;

    renderQuote();
}

function newCustomer() {
    if (!isSignedIn()) {
        requireAuth();
        return;
    }

    currentCustomer = null;

    document.getElementById("customerName").value = "";
    document.getElementById("jobRef").value = "";

    rooms = [];
    activeRoomId = null;

    updateRoomList();
    clearRoomForm();
    showRoomForm(false);
    document.getElementById("roomTitle").textContent = "No room selected";
    document.getElementById("result").innerHTML = "";
    document.getElementById("summaryContent").innerHTML =
        `<p class="muted">No rooms calculated yet.</p>`;

    renderQuote();
}


//------------------------------------------------------
// HELPERS
//------------------------------------------------------
function unitLabel(unit) {
    if (unit === "sqm") return "per m²";
    if (unit === "lm") return "per m";
    return "per item";
}

function unitDisplay(unit) {
    if (unit === "sqm") return "m²";
    if (unit === "lm") return "m";
    return "item(s)";
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function safeSetValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value != null ? value : "";
}

function getValue(id) {
    const el = document.getElementById(id);
    return el ? el.value : "";
}
