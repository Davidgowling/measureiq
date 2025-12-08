//------------------------------------------------------
// GLOBAL DATA
//------------------------------------------------------
let products = [];
let rooms = [];
let activeRoomId = null;

const CUSTOMER_KEY = "measureiq_customers_v1";
const ACCESSORY_DEFS_KEY = "measureiq_accessories_definitions_v1";
const BUSINESS_PROFILE_KEY = "measureiq_business_profile_v1";
const VAT_RATE = 0.2;

let accessoriesDefs = []; // dynamic accessories (name, unit, price)
let businessProfile = null;

//------------------------------------------------------
// INITIALISE APP
//------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
    // Load products JSON
    fetch("products.json")
        .then(res => res.json())
        .then(data => {
            products = data;
        })
        .catch(err => console.error("Error loading products.json", err));

    // Buttons & events
    document.getElementById("addRoomBtn").addEventListener("click", addRoom);
    document.getElementById("editRoomBtn").addEventListener("click", renameRoom);
    document.getElementById("deleteRoomBtn").addEventListener("click", deleteRoom);

    document.getElementById("saveCustomerBtn").addEventListener("click", saveCustomer);
    document.getElementById("newCustomerBtn").addEventListener("click", newCustomer);

    document.getElementById("calculateBtn").addEventListener("click", () => calculateRoom(false));

    // Room dimension changes -> live recalc
    ["length", "widthInput", "wastage"].forEach(id => {
        document.getElementById(id).addEventListener("input", () => {
            calculateRoom(true);
        });
    });

    document.getElementById("widthDropdown").addEventListener("change", () => {
        calculateRoom(true);
    });

    // Internal summary print
    document.getElementById("printBtn").addEventListener("click", () => window.print());

    // Accessories pricing
    document.getElementById("saveAccessoriesBtn").addEventListener("click", saveAccessoryDefinitions);
    document.getElementById("addAccessoryBtn").addEventListener("click", addAccessoryDefinition);

    // Range selector modal
    document.getElementById("selectRangeBtn").addEventListener("click", openRangeModal);
    document.getElementById("closeRangeModalBtn").addEventListener("click", closeRangeModal);
    document.getElementById("rangeModal").addEventListener("click", (e) => {
        if (e.target.id === "rangeModal") {
            closeRangeModal();
        }
    });

    // Business profile
    document.getElementById("saveBusinessProfileBtn").addEventListener("click", saveBusinessProfile);

    // Quote controls
    document.getElementById("quoteMarkup").addEventListener("input", () => renderQuote());
    document.getElementById("quoteShowAccessories").addEventListener("change", () => renderQuote());
    document.getElementById("quoteNotes").addEventListener("input", () => renderQuote());
    document.getElementById("quotePrintBtn").addEventListener("click", () => window.print());

    setupTabs();
    loadBusinessProfile();
    loadAccessoryDefinitions();
    loadSavedCustomers();
    showRoomForm(false);
});

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
function loadBusinessProfile() {
    const saved = JSON.parse(localStorage.getItem(BUSINESS_PROFILE_KEY));

    businessProfile = saved || {
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
        defaultMarkup: 35,
        showAccessoriesOnQuote: false,
        defaultNotes: ""
    };

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
    safeSetValue("bpDefaultMarkup", businessProfile.defaultMarkup);
    const bpShowAcc = document.getElementById("bpShowAccessories");
    if (bpShowAcc) bpShowAcc.checked = !!businessProfile.showAccessoriesOnQuote;
    safeSetValue("bpDefaultNotes", businessProfile.defaultNotes);

    // Quote controls: only set defaults if they are currently blank/uninitialised
    const markupInput = document.getElementById("quoteMarkup");
    if (markupInput && (markupInput.value === "" || markupInput.value === "0")) {
        markupInput.value = businessProfile.defaultMarkup || 0;
    }

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

function saveBusinessProfile() {
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
        defaultMarkup: parseFloat(getValue("bpDefaultMarkup")) || 0,
        showAccessoriesOnQuote: !!document.getElementById("bpShowAccessories").checked,
        defaultNotes: getValue("bpDefaultNotes")
    };

    localStorage.setItem(BUSINESS_PROFILE_KEY, JSON.stringify(businessProfile));

    const msg = document.getElementById("businessSavedMsg");
    msg.textContent = "Saved";
    setTimeout(() => { msg.textContent = ""; }, 1500);

    applyBusinessProfileToUI();
    renderQuote();
}

//------------------------------------------------------
// PRODUCTS / RANGES
//------------------------------------------------------
function openRangeModal() {
    const modal = document.getElementById("rangeModal");
    const list = document.getElementById("rangeList");

    if (!products.length) {
        list.innerHTML = `<p class="muted">No product ranges found yet.</p>`;
        modal.style.display = "flex";
        return;
    }

    // Group products by 'group' field for headings
    const groupsMap = {};
    products.forEach(p => {
        const groupName = p.group || (p.format === "sheet" ? "Sheet Products" : "Pack Products");
        if (!groupsMap[groupName]) groupsMap[groupName] = [];
        groupsMap[groupName].push(p);
    });

    // Desired group order
    const desiredOrder = [
        "Carpet & Vinyl (Sheet)",
        "LVT & Hard Flooring (Pack)",
        "Wood & Laminate (Pack)"
    ];

    const groupNames = [];
    desiredOrder.forEach(g => {
        if (groupsMap[g]) groupNames.push(g);
    });
    Object.keys(groupsMap).forEach(g => {
        if (!groupNames.includes(g)) groupNames.push(g);
    });

    let html = "";
    groupNames.forEach(groupName => {
        const groupProducts = groupsMap[groupName];
        if (!groupProducts || !groupProducts.length) return;

        html += `<div class="range-group-title">${escapeHtml(groupName)}</div>`;
        groupProducts.forEach(p => {
            const line = p.format === "pack"
                ? `Pack ${p.packSize} m² – £${p.priceExVat.toFixed(2)} ex VAT`
                : `Sheet / Roll – £${p.priceExVat.toFixed(2)} per m² ex VAT`;

            html += `
                <button class="range-btn" data-product-id="${escapeHtml(p.id)}">
                    <strong>${escapeHtml(p.brand)} – ${escapeHtml(p.rangeName)}</strong>
                    <span class="muted">${line}</span>
                </button>
            `;
        });
    });

    list.innerHTML = html || `<p class="muted">No product ranges found.</p>`;
    modal.style.display = "flex";

    list.querySelectorAll(".range-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const productId = btn.getAttribute("data-product-id");
            selectRangeForActiveRoom(productId);
            closeRangeModal();
        });
    });
}

function closeRangeModal() {
    document.getElementById("rangeModal").style.display = "none";
}

function selectRangeForActiveRoom(productId) {
    if (!activeRoomId) return;
    const product = products.find(p => p.id === productId);
    if (!product) return;

    const room = rooms.find(r => r.id === activeRoomId);
    if (!room) return;

    if (!room.data) room.data = {};
    room.data.productId = productId;

    applyProductToUI(product);
    calculateRoom(true);
}

function getActiveRoomProduct() {
    if (!activeRoomId) return null;
    const room = rooms.find(r => r.id === activeRoomId);
    if (!room || !room.data || !room.data.productId) return null;
    return products.find(p => p.id === room.data.productId) || null;
}

function applyProductToUI(product) {
    const packSizeEl = document.getElementById("packSize");
    const priceEl = document.getElementById("price");
    const widthDropdown = document.getElementById("widthDropdown");
    const widthDropdownLabel = document.getElementById("widthDropdownLabel");
    const wastageInput = document.getElementById("wastage");
    const rangeDisplay = document.getElementById("selectedRangeDisplay");

    packSizeEl.value = "";
    priceEl.value = "";
    widthDropdown.style.display = "none";
    widthDropdownLabel.style.display = "none";
    widthDropdown.innerHTML = "";
    wastageInput.disabled = false;
    rangeDisplay.textContent = product ? `${product.brand} – ${product.rangeName}` : "None selected";

    if (!product) return;

    priceEl.value = product.priceExVat;

    if (product.format === "pack") {
        packSizeEl.value = product.packSize;
        wastageInput.disabled = false;
        if (!wastageInput.value || wastageInput.value < 0) {
            wastageInput.value = 10;
        }
    } else if (product.format === "sheet") {
        widthDropdown.style.display = "block";
        widthDropdownLabel.style.display = "block";

        (product.rollWidths || []).forEach(w => {
            const opt = document.createElement("option");
            opt.value = w;
            opt.textContent = `${w} m`;
            widthDropdown.appendChild(opt);
        });

        wastageInput.value = 0;
        wastageInput.disabled = true;

        autoSelectRollWidth(product);
    }
}

// Auto-select roll width >= room width, otherwise largest, no warnings
function autoSelectRollWidth(product) {
    const widthDropdown = document.getElementById("widthDropdown");
    const roomWidth = parseFloat(document.getElementById("widthInput").value);
    if (!product || product.format !== "sheet" || !Array.isArray(product.rollWidths) || !roomWidth) return;
    const sorted = [...product.rollWidths].sort((a, b) => a - b);
    let chosen = sorted[sorted.length - 1];
    for (const w of sorted) {
        if (w >= roomWidth) {
            chosen = w;
            break;
        }
    }
    widthDropdown.value = chosen;
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
    document.getElementById("selectedRangeDisplay").textContent = "None selected";

    document.getElementById("length").value = "";
    document.getElementById("widthInput").value = "";
    document.getElementById("wastage").value = 10;
    document.getElementById("wastage").disabled = false;
    document.getElementById("packSize").value = "";
    document.getElementById("price").value = "";
    document.getElementById("result").innerHTML = "";
    document.getElementById("roomSavedMsg").textContent = "";

    const widthDropdown = document.getElementById("widthDropdown");
    const widthDropdownLabel = document.getElementById("widthDropdownLabel");
    widthDropdown.style.display = "none";
    widthDropdownLabel.style.display = "none";
    widthDropdown.innerHTML = "";

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

    if (d.productId) {
        const product = products.find(p => p.id === d.productId);
        applyProductToUI(product || null);
    } else {
        applyProductToUI(null);
    }

    if (d.length) document.getElementById("length").value = d.length;
    if (d.width) document.getElementById("widthInput").value = d.width;

    if (d.sheetWidth) {
        const dd = document.getElementById("widthDropdown");
        if (dd && dd.options.length) dd.value = d.sheetWidth;
    }

    if (d.wastage !== undefined) {
        document.getElementById("wastage").value = d.wastage;
    }

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
function loadAccessoryDefinitions() {
    const saved = JSON.parse(localStorage.getItem(ACCESSORY_DEFS_KEY));

    if (saved && Array.isArray(saved) && saved.length) {
        accessoriesDefs = saved;
    } else {
        accessoriesDefs = [
            { id: "underlay", name: "Underlay", unit: "sqm", price: 0 },
            { id: "gripper", name: "Gripper", unit: "lm", price: 0 },
            { id: "adhesive", name: "Adhesive", unit: "sqm", price: 0 },
            { id: "fitting", name: "Fitting / Labour", unit: "sqm", price: 0 },
            { id: "doorbars", name: "Door bars", unit: "item", price: 0 }
        ];
    }

    renderAccessoriesPricingPanel();
    renderRoomAccessoriesPanel(getActiveRoomAccessories());
}

function saveAccessoryDefinitions() {
    const container = document.getElementById("accessoriesPricingList");
    if (!container) return;

    const rows = container.querySelectorAll("tbody tr");
    const updated = [];

    rows.forEach(row => {
        const id = row.getAttribute("data-id");
        const name = document.getElementById(`accDefName_${id}`).value.trim() || "Accessory";
        const unit = document.getElementById(`accDefUnit_${id}`).value;
        const price = parseFloat(document.getElementById(`accDefPrice_${id}`).value) || 0;

        updated.push({ id, name, unit, price });
    });

    accessoriesDefs = updated;
    localStorage.setItem(ACCESSORY_DEFS_KEY, JSON.stringify(accessoriesDefs));

    const msg = document.getElementById("accessoriesSavedMsg");
    msg.textContent = "Saved";
    setTimeout(() => { msg.textContent = ""; }, 1500);

    renderRoomAccessoriesPanel(getActiveRoomAccessories());
    calculateRoom(true);
    renderQuote();
}

function addAccessoryDefinition() {
    const name = document.getElementById("newAccName").value.trim();
    const unit = document.getElementById("newAccUnit").value;
    const price = parseFloat(document.getElementById("newAccPrice").value) || 0;

    if (!name) {
        alert("Enter an accessory name.");
        return;
    }

    const id = "acc_" + Date.now();

    accessoriesDefs.push({ id, name, unit, price });
    localStorage.setItem(ACCESSORY_DEFS_KEY, JSON.stringify(accessoriesDefs));

    document.getElementById("newAccName").value = "";
    document.getElementById("newAccPrice").value = "";

    renderAccessoriesPricingPanel();
    renderRoomAccessoriesPanel(getActiveRoomAccessories());
    calculateRoom(true);
    renderQuote();
}

function deleteAccessoryDefinition(id) {
    accessoriesDefs = accessoriesDefs.filter(a => a.id !== id);
    localStorage.setItem(ACCESSORY_DEFS_KEY, JSON.stringify(accessoriesDefs));
    renderAccessoriesPricingPanel();
    renderRoomAccessoriesPanel(getActiveRoomAccessories());
    calculateRoom(true);
    renderQuote();
}

function renderAccessoriesPricingPanel() {
    const container = document.getElementById("accessoriesPricingList");
    if (!container) return;

    if (!accessoriesDefs.length) {
        container.innerHTML = `<p class="muted">No accessories yet. Add one below.</p>`;
        return;
    }

    const rowsHtml = accessoriesDefs.map(def => `
        <tr data-id="${def.id}">
            <td>
                <input type="text" id="accDefName_${def.id}" value="${escapeHtml(def.name)}">
            </td>
            <td>
                <select id="accDefUnit_${def.id}">
                    <option value="sqm"${def.unit === "sqm" ? " selected" : ""}>per m²</option>
                    <option value="lm"${def.unit === "lm" ? " selected" : ""}>per metre</option>
                    <option value="item"${def.unit === "item" ? " selected" : ""}>per item</option>
                </select>
            </td>
            <td>
                <input type="number" id="accDefPrice_${def.id}" step="0.01" min="0" value="${def.price}">
            </td>
            <td>
                <button class="btn danger small" data-del-id="${def.id}">Delete</button>
            </td>
        </tr>
    `).join("");

    container.innerHTML = `
        <table class="summary-table accessories-table">
            <thead>
                <tr>
                    <th>Name</th>
                    <th>Unit</th>
                    <th>Price (£ ex VAT)</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>
                ${rowsHtml}
            </tbody>
        </table>
    `;

    container.querySelectorAll("[data-del-id]").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = btn.getAttribute("data-del-id");
            deleteAccessoryDefinition(id);
        });
    });
}

function getActiveRoomAccessories() {
    const room = rooms.find(r => r.id === activeRoomId);
    if (!room || !room.data || !room.data.accessories) return null;
    return room.data.accessories;
}

//------------------------------------------------------
// RENDER ACCESSORIES IN ROOM PANEL
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
            qtyVal = geometry.areaForAccessories;
        } else {
            qtyVal = 0;
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
                        q = geo.areaForAccessories;
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
    const wastage = parseFloat(document.getElementById("wastage").value) || 0;
    const product = getActiveRoomProduct();

    if (!length || !width) {
        return {
            hasGeometry: false,
            roomArea: 0,
            areaPlusWaste: 0,
            areaForAccessories: 0
        };
    }

    const roomArea = length * width;
    let areaPlusWaste = roomArea;

    if (product && product.format === "pack") {
        areaPlusWaste = roomArea * (1 + wastage / 100);
    }

    const areaForAccessories = product && product.format === "pack" ? areaPlusWaste : roomArea;

    return {
        hasGeometry: true,
        roomArea,
        areaPlusWaste,
        areaForAccessories
    };
}

//------------------------------------------------------
// CALCULATE ROOM & AUTO-SAVE
//------------------------------------------------------
function calculateRoom(auto = false) {
    const resultDiv = document.getElementById("result");
    const savedMsg = document.getElementById("roomSavedMsg");
    savedMsg.textContent = "";

    if (!activeRoomId) {
        if (!auto) alert("Please add a room first.");
        resultDiv.innerHTML = "";
        return;
    }

    const room = rooms.find(r => r.id === activeRoomId);
    if (!room) return;

    const product = getActiveRoomProduct();
    if (!product) {
        if (!auto) alert("Please click 'Select Range' and choose a product range.");
        resultDiv.innerHTML = "";
        return;
    }

    const length = parseFloat(document.getElementById("length").value);
    const width = parseFloat(document.getElementById("widthInput").value);
    const widthDropdown = document.getElementById("widthDropdown");
    const wastage = parseFloat(document.getElementById("wastage").value) || 0;
    const packSize = parseFloat(document.getElementById("packSize").value);
    const price = parseFloat(document.getElementById("price").value);

    if (!length || length <= 0) {
        if (!auto) alert("Please enter a valid room length.");
        resultDiv.innerHTML = "";
        return;
    }

    if (!width || width <= 0) {
        if (!auto) alert("Please enter a valid room width.");
        resultDiv.innerHTML = "";
        return;
    }

    let sheetWidthUsed = null;
    if (product.format === "sheet" && widthDropdown.style.display !== "none") {
        const val = parseFloat(widthDropdown.value);
        sheetWidthUsed = isNaN(val) ? null : val;
    }

    if (!price || price <= 0) {
        if (!auto) alert("Product is missing a valid trade price.");
        resultDiv.innerHTML = "";
        return;
    }

    const geometry = computeAreaValues();
    if (!geometry.hasGeometry) {
        if (!auto) alert("Please enter valid room dimensions.");
        resultDiv.innerHTML = "";
        return;
    }

    const roomArea = geometry.roomArea;
    const areaPlusWaste = geometry.areaPlusWaste;

    let materialTotal = 0;
    let packsNeeded = null;

    if (product.format === "pack") {
        if (!packSize || packSize <= 0) {
            if (!auto) alert("This product has no valid pack size.");
            resultDiv.innerHTML = "";
            return;
        }
        packsNeeded = Math.ceil(areaPlusWaste / packSize);
        materialTotal = packsNeeded * price;
    } else if (product.format === "sheet") {
        materialTotal = roomArea * price;
    }

    let accessoryTotal = 0;
    let breakdownLines = [];
    let accessoriesSelections = {};

    accessoriesDefs.forEach(def => {
        const cb = document.getElementById(`acc_${def.id}`);
        const qtyInput = document.getElementById(`accQty_${def.id}`);
        if (!cb || !qtyInput) return;

        const selected = cb.checked;
        let qtyVal = parseFloat(qtyInput.value);
        if (!isFinite(qtyVal) || qtyVal < 0) qtyVal = 0;

        if (selected && qtyVal <= 0) {
            if (def.id === "doorbars") {
                qtyVal = 1;
            } else if (def.unit === "sqm" && geometry.hasGeometry) {
                qtyVal = geometry.areaForAccessories;
            }
            if (qtyVal > 0) {
                qtyInput.value = qtyVal.toFixed(2);
            }
        }

        let cost = 0;
        if (selected && qtyVal > 0 && def.price > 0) {
            cost = qtyVal * def.price;
            accessoryTotal += cost;

            const uLabel = unitDisplay(def.unit);
            breakdownLines.push(
                `${def.name}: £${cost.toFixed(2)} ex VAT (${qtyVal.toFixed(2)} ${uLabel} @ £${def.price.toFixed(2)})`
            );
        }

        accessoriesSelections[def.id] = {
            selected,
            qty: qtyVal,
            unit: def.unit,
            unitPrice: def.price,
            cost
        };
    });

    const lineTotal = materialTotal + accessoryTotal;

    const roomName = room.name || "Room";
    let html = `
        <strong>${escapeHtml(roomName)} Summary</strong><br>
        Room area: ${roomArea.toFixed(2)} m²<br>
    `;

    if (product.format === "pack") {
        html += `Area incl. ${wastage}% wastage: ${areaPlusWaste.toFixed(2)} m²<br>`;
    }

    if (product.format === "sheet" && sheetWidthUsed) {
        html += `Roll width selected: ${sheetWidthUsed} m<br>`;
    }

    html += `<br><strong>Material (ex VAT)</strong><br>`;
    if (product.format === "pack") {
        html += `Packs required: ${packsNeeded}<br>`;
    }
    html += `Material total: £${materialTotal.toFixed(2)} ex VAT<br>`;

    html += `<br><strong>Accessories (ex VAT)</strong><br>`;
    if (breakdownLines.length) {
        html += breakdownLines.join("<br>") + "<br>";
    } else {
        html += "None<br>";
    }

    html += `<br><strong>Room total (ex VAT):</strong> £${lineTotal.toFixed(2)}`;

    resultDiv.innerHTML = `<div class="cost-block">${html}</div>`;

    room.data = {
        productId: product.id,
        length,
        width,
        sheetWidth: sheetWidthUsed,
        wastage,
        roomArea,
        areaPlusWaste,
        packsNeeded,
        materialTotal,
        accessoryTotal,
        lineTotal,
        accessories: accessoriesSelections,
        resultHtml: resultDiv.innerHTML
    };

    updateSummary();
    autoUpdateCurrentCustomer();

    if (!auto) {
        savedMsg.textContent = "✓ Room calculated & saved to project";
        setTimeout(() => {
            savedMsg.textContent = "";
        }, 1500);
    }

    renderQuote();
}

//------------------------------------------------------
// SUMMARY (INTERNAL)
//------------------------------------------------------
function updateSummary() {
    const contentDiv = document.getElementById("summaryContent");

    if (!rooms.length) {
        contentDiv.innerHTML = `<p class="muted">No rooms calculated yet.</p>`;
        return;
    }

    let grandTotal = 0;

    const rows = rooms.map(r => {
        const d = r.data;
        if (!d || !d.lineTotal) return "";

        const product = products.find(p => p.id === d.productId);
        const productName = product ? `${product.brand} – ${product.rangeName}` : "Product";

        grandTotal += d.lineTotal;

        return `
            <tr>
                <td>${escapeHtml(r.name)}</td>
                <td>${escapeHtml(productName)}</td>
                <td>${d.roomArea.toFixed(2)} m²</td>
                <td>${product && product.format === "pack" ? (d.packsNeeded || 0) : "N/A"}</td>
                <td>£${d.materialTotal.toFixed(2)} ex VAT</td>
                <td>£${d.accessoryTotal.toFixed(2)} ex VAT</td>
                <td>£${d.lineTotal.toFixed(2)} ex VAT</td>
            </tr>
        `;
    }).join("");

    if (!rows.trim()) {
        contentDiv.innerHTML = `<p class="muted">No rooms calculated yet.</p>`;
        return;
    }

    const tableHtml = `
        <table class="summary-table">
            <thead>
                <tr>
                    <th>Room</th>
                    <th>Product</th>
                    <th>Area</th>
                    <th>Packs</th>
                    <th>Material</th>
                    <th>Accessories</th>
                    <th>Total</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
        <div class="summary-total">Grand Total (ex VAT): £${grandTotal.toFixed(2)}</div>
    `;

    contentDiv.innerHTML = tableHtml;
}

//------------------------------------------------------
// QUOTE BUILDER (CLIENT FACING)
//------------------------------------------------------
function renderQuote() {
    const container = document.getElementById("quoteContent");
    if (!container) return;

    if (!businessProfile) {
        loadBusinessProfile();
    }

    // Get quote controls
    const markupInput = document.getElementById("quoteMarkup");
    const showAccCheckbox = document.getElementById("quoteShowAccessories");
    const notesArea = document.getElementById("quoteNotes");

    if (markupInput && (markupInput.value === "" || markupInput.value === "0") && businessProfile) {
        markupInput.value = businessProfile.defaultMarkup || 0;
    }

    let markup = parseFloat(markupInput ? markupInput.value : "0");
    if (!isFinite(markup) || markup < 0) markup = 0;
    if (markupInput) markupInput.value = markup;

    if (showAccCheckbox && !showAccCheckbox.dataset.initialised && businessProfile) {
        showAccCheckbox.checked = !!businessProfile.showAccessoriesOnQuote;
        showAccCheckbox.dataset.initialised = "true";
    }

    const showAccessories = showAccCheckbox ? showAccCheckbox.checked : false;

    if (notesArea && notesArea.value.trim() === "" && businessProfile && businessProfile.defaultNotes) {
        notesArea.value = businessProfile.defaultNotes;
    }

    const notes = notesArea ? notesArea.value : "";

    if (!rooms.length) {
        container.innerHTML = `<p class="muted">No rooms calculated yet. Add a room and click "Calculate &amp; Save" to build a quote.</p>`;
        return;
    }

    const custName = document.getElementById("customerName").value.trim() || "Customer";
    const jobRef = document.getElementById("jobRef").value.trim();
    const today = new Date();
    const dateStr = today.toLocaleDateString("en-GB");

    const bp = businessProfile || {};
    const addressLines = [
        bp.address1,
        bp.address2,
        [bp.town, bp.postcode].filter(Boolean).join(" ")
    ].filter(line => line && line.trim().length > 0);

    // Calculate totals with markup
    let totalRetailMaterial = 0;
    let totalAccessories = 0;
    let totalExVat = 0;

    const rows = rooms.map(r => {
        const d = r.data;
        if (!d || !d.lineTotal) return "";

        const product = products.find(p => p.id === d.productId);
        const productName = product ? `${product.brand} – ${product.rangeName}` : "Product";

        const tradeMat = d.materialTotal || 0;
        const acc = d.accessoryTotal || 0;
        const matRetail = tradeMat * (1 + markup / 100);

        const roomTotalExVat = matRetail + acc;

        totalRetailMaterial += matRetail;
        totalAccessories += acc;
        totalExVat += roomTotalExVat;

        if (showAccessories) {
            return `
                <tr>
                    <td>${escapeHtml(r.name)}</td>
                    <td>${escapeHtml(productName)}</td>
                    <td>${d.roomArea.toFixed(2)} m²</td>
                    <td>£${matRetail.toFixed(2)}</td>
                    <td>£${acc.toFixed(2)}</td>
                    <td>£${roomTotalExVat.toFixed(2)}</td>
                </tr>
            `;
        } else {
            return `
                <tr>
                    <td>${escapeHtml(r.name)}</td>
                    <td>${escapeHtml(productName)}</td>
                    <td>${d.roomArea.toFixed(2)} m²</td>
                    <td>£${roomTotalExVat.toFixed(2)}</td>
                </tr>
            `;
        }
    }).join("");

    if (!rows.trim()) {
        container.innerHTML = `<p class="muted">No rooms calculated yet.</p>`;
        return;
    }

    const vatAmount = totalExVat * VAT_RATE;
    const grandTotal = totalExVat + vatAmount;

    const headerHtml = `
        <div class="quote-header">
            <div class="quote-business">
                <strong>${escapeHtml(bp.businessName || "Your Business Name")}</strong><br>
                ${bp.contactName ? escapeHtml(bp.contactName) + "<br>" : ""}
                ${addressLines.map(escapeHtml).join("<br>")}
                ${bp.phone ? "<br>Tel: " + escapeHtml(bp.phone) : ""}
                ${bp.email ? "<br>Email: " + escapeHtml(bp.email) : ""}
                ${bp.website ? "<br>Web: " + escapeHtml(bp.website) : ""}
                ${bp.vatNumber ? "<br>VAT: " + escapeHtml(bp.vatNumber) : ""}
            </div>
            <div class="quote-meta">
                Prepared by: ${escapeHtml(bp.contactName || "")}
                <br>Date: ${escapeHtml(dateStr)}
            </div>
        </div>
    `;

    const customerHtml = `
        <div class="quote-customer">
            <strong>Quote for:</strong> ${escapeHtml(custName)}<br>
            ${jobRef ? "<strong>Job Ref:</strong> " + escapeHtml(jobRef) + "<br>" : ""}
        </div>
    `;

    const tableHeader = showAccessories
        ? `
            <tr>
                <th>Room</th>
                <th>Product</th>
                <th>Area</th>
                <th>Material (ex VAT)</th>
                <th>Accessories (ex VAT)</th>
                <th>Room Total (ex VAT)</th>
            </tr>
        `
        : `
            <tr>
                <th>Room</th>
                <th>Product</th>
                <th>Area</th>
                <th>Room Total (ex VAT)</th>
            </tr>
        `;

    const tableHtml = `
        <table class="quote-rooms-table">
            <thead>${tableHeader}</thead>
            <tbody>${rows}</tbody>
        </table>
    `;

    const totalsHtml = `
        <div class="quote-totals">
            <div>Material total (ex VAT, after markup): £${totalRetailMaterial.toFixed(2)}</div>
            ${showAccessories ? `<div>Accessories total (ex VAT): £${totalAccessories.toFixed(2)}</div>` : ""}
            <div><strong>Project total (ex VAT): £${totalExVat.toFixed(2)}</strong></div>
            <div>VAT @ ${(VAT_RATE * 100).toFixed(0)}%: £${vatAmount.toFixed(2)}</div>
            <div><strong>Grand total (inc VAT): £${grandTotal.toFixed(2)}</strong></div>
        </div>
    `;

    const notesHtml = notes.trim()
        ? `
        <div class="quote-notes-display">
            <strong>Notes / Terms</strong><br>
            ${escapeHtml(notes).replace(/\n/g, "<br>")}
        </div>
    `
        : "";

    container.innerHTML = headerHtml + customerHtml + tableHtml + totalsHtml + notesHtml;
}

//------------------------------------------------------
// CUSTOMER SAVE / LOAD / NEW
//------------------------------------------------------
function saveCustomer() {
    const name = document.getElementById("customerName").value.trim();
    const jobRef = document.getElementById("jobRef").value.trim();

    if (!name) {
        alert("Enter a customer name.");
        return;
    }

    let saved = JSON.parse(localStorage.getItem(CUSTOMER_KEY)) || [];
    const existingIndex = saved.findIndex(c => c.name === name);

    const record = {
        name,
        jobRef,
        rooms,
        timestamp: Date.now()
    };

    if (existingIndex >= 0) {
        saved[existingIndex] = record;
    } else {
        saved.push(record);
    }

    localStorage.setItem(CUSTOMER_KEY, JSON.stringify(saved));
    loadSavedCustomers();

    alert("Customer saved!");
}

function autoUpdateCurrentCustomer() {
    const name = document.getElementById("customerName").value.trim();
    if (!name) return;

    let saved = JSON.parse(localStorage.getItem(CUSTOMER_KEY)) || [];
    const idx = saved.findIndex(c => c.name === name);
    if (idx === -1) return;

    const jobRef = document.getElementById("jobRef").value.trim();

    saved[idx] = {
        ...saved[idx],
        name,
        jobRef,
        rooms,
        timestamp: Date.now()
    };

    localStorage.setItem(CUSTOMER_KEY, JSON.stringify(saved));
    loadSavedCustomers();
}

function loadSavedCustomers() {
    const list = document.getElementById("savedCustomersList");
    list.innerHTML = "";

    const saved = JSON.parse(localStorage.getItem(CUSTOMER_KEY)) || [];

    saved.sort((a, b) => b.timestamp - a.timestamp);

    saved.forEach(c => {
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
    document.getElementById("customerName").value = c.name;
    document.getElementById("jobRef").value = c.jobRef || "";

    rooms = c.rooms || [];
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

function deleteCustomer(name) {
    let saved = JSON.parse(localStorage.getItem(CUSTOMER_KEY)) || [];
    saved = saved.filter(c => c.name !== name);
    localStorage.setItem(CUSTOMER_KEY, JSON.stringify(saved));
    loadSavedCustomers();
}

function newCustomer() {
    document.getElementById("customerName").value = "";
    document.getElementById("jobRef").value = "";

    rooms = [];
    activeRoomId = null;

    updateRoomList();
    clearRoomForm();
    showRoomForm(false);
    document.getElementById("roomTitle").textContent = "No room selected";
    document.getElementById("result").innerHTML = "";
    document.getElementById("summaryContent").innerHTML = `<p class="muted">No rooms calculated yet.</p>`;
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
