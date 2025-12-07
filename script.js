//------------------------------------------------------
// GLOBAL DATA
//------------------------------------------------------
let products = [];
let rooms = [];
let activeRoomId = null;

const CUSTOMER_KEY = "measureiq_customers_v1";
const ACCESSORY_DEFS_KEY = "measureiq_accessories_definitions_v1";

let accessoriesDefs = []; // dynamic accessories (name, unit, price)

//------------------------------------------------------
// INITIALISE APP
//------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
    // Load products JSON
    fetch("products.json")
        .then(res => res.json())
        .then(data => {
            products = data;
            populateProductSelect();
        })
        .catch(err => console.error("Error loading products.json", err));

    // Buttons & events
    document.getElementById("addRoomBtn").addEventListener("click", addRoom);
    document.getElementById("editRoomBtn").addEventListener("click", renameRoom);
    document.getElementById("deleteRoomBtn").addEventListener("click", deleteRoom);

    document.getElementById("saveCustomerBtn").addEventListener("click", saveCustomer);
    document.getElementById("newCustomerBtn").addEventListener("click", newCustomer);

    document.getElementById("calculateBtn").addEventListener("click", () => calculateRoom(false));

    document.getElementById("productSelect").addEventListener("change", () => {
        updateProductDetails();
        calculateRoom(true);
    });

    ["length", "widthInput", "wastage"].forEach(id => {
        document.getElementById(id).addEventListener("input", () => {
            calculateRoom(true);
        });
    });

    document.getElementById("widthDropdown").addEventListener("change", () => {
        calculateRoom(true);
    });

    document.getElementById("printBtn").addEventListener("click", () => window.print());

    document.getElementById("saveAccessoriesBtn").addEventListener("click", saveAccessoryDefinitions);
    document.getElementById("addAccessoryBtn").addEventListener("click", addAccessoryDefinition);

    setupTabs();
    loadAccessoryDefinitions();
    loadSavedCustomers();
});

//------------------------------------------------------
// TABS
//------------------------------------------------------
function setupTabs() {
    const buttons = document.querySelectorAll(".tab-btn");
    const panels = {
        calculatorSection: document.getElementById("calculatorSection"),
        accessoriesSection: document.getElementById("accessoriesSection"),
        summarySection: document.getElementById("summarySection")
    };

    buttons.forEach(btn => {
        btn.addEventListener("click", () => {
            const target = btn.dataset.tab;

            buttons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            Object.entries(panels).forEach(([id, panel]) => {
                panel.style.display = (id === target) ? "block" : "none";
            });
        });
    });
}

//------------------------------------------------------
// PRODUCTS
//------------------------------------------------------
function populateProductSelect() {
    const select = document.getElementById("productSelect");
    select.innerHTML = `<option value="">-- Choose a product --</option>`;

    products.forEach((p, index) => {
        const opt = document.createElement("option");
        opt.value = index;
        opt.textContent = `${p.brand} - ${p.rangeName}`;
        select.appendChild(opt);
    });
}

function updateProductDetails() {
    const index = document.getElementById("productSelect").value;
    const packSize = document.getElementById("packSize");
    const price = document.getElementById("price");
    const widthDropdown = document.getElementById("widthDropdown");
    const widthLabel = document.getElementById("widthDropdownLabel");
    const wastageInput = document.getElementById("wastage");

    // Reset first
    packSize.value = "";
    price.value = "";
    widthDropdown.style.display = "none";
    widthLabel.style.display = "none";
    widthDropdown.innerHTML = "";
    wastageInput.disabled = false;

    if (index === "") return;

    const p = products[index];

    // Price (per pack or per m²)
    if (p.tradePrice) {
        price.value = p.tradePrice;
    }

    // Pack products
    if (p.type === "pack") {
        packSize.value = p.packSize;
        wastageInput.disabled = false;
    }

    // Sheet products
    if (p.type === "sheet") {
        widthDropdown.style.display = "block";
        widthLabel.style.display = "block";

        p.availableWidths.forEach(w => {
            const opt = document.createElement("option");
            opt.value = w;
            opt.textContent = `${w} m`;
            widthDropdown.appendChild(opt);
        });

        // For sheet goods, ignore wastage (set to 0 and disable)
        wastageInput.value = 0;
        wastageInput.disabled = true;
    }
}

//------------------------------------------------------
// ROOMS
//------------------------------------------------------
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
        document.getElementById("roomTitle").textContent = "No room selected";
        document.getElementById("result").innerHTML = "";
    }

    updateSummary();
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
    document.getElementById("productSelect").value = "";
    document.getElementById("length").value = "";
    document.getElementById("widthInput").value = "";
    document.getElementById("wastage").value = 10;
    document.getElementById("wastage").disabled = false;
    document.getElementById("packSize").value = "";
    document.getElementById("price").value = "";
    document.getElementById("result").innerHTML = "";
    document.getElementById("roomSavedMsg").textContent = "";

    const widthDropdown = document.getElementById("widthDropdown");
    const widthLabel = document.getElementById("widthDropdownLabel");
    widthDropdown.style.display = "none";
    widthLabel.style.display = "none";
    widthDropdown.innerHTML = "";

    const container = document.getElementById("roomAccessories");
    if (container) {
        container.innerHTML = "";
    }
}

function loadRoom(id) {
    const room = rooms.find(r => r.id === id);
    if (!room) return;

    clearRoomForm();
    document.getElementById("roomTitle").textContent = room.name;

    const d = room.data || {};

    if (d.productIndex !== undefined) {
        document.getElementById("productSelect").value = d.productIndex;
        updateProductDetails();
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
        // Seed with some sensible defaults
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
}

function deleteAccessoryDefinition(id) {
    accessoriesDefs = accessoriesDefs.filter(a => a.id !== id);
    localStorage.setItem(ACCESSORY_DEFS_KEY, JSON.stringify(accessoriesDefs));
    renderAccessoriesPricingPanel();
    renderRoomAccessoriesPanel(getActiveRoomAccessories());
    calculateRoom(true);
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
                    <th>Price (£)</th>
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
        }
        qtyInput.value = qtyVal.toFixed(2);

        qtyWrapper.appendChild(qtyLabel);
        qtyWrapper.appendChild(qtyInput);

        row.appendChild(label);
        row.appendChild(qtyWrapper);

        container.appendChild(row);

        // Auto recalc when user changes selection / qty
        cb.addEventListener("change", () => calculateRoom(true));
        qtyInput.addEventListener("input", () => calculateRoom(true));
    });
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

    const productIndexStr = document.getElementById("productSelect").value;
    if (productIndexStr === "") {
        if (!auto) alert("Please select a product.");
        resultDiv.innerHTML = "";
        return;
    }

    const p = products[productIndexStr];

    const length = parseFloat(document.getElementById("length").value);
    const widthInputEl = document.getElementById("widthInput");
    const widthDropdown = document.getElementById("widthDropdown");
    const wastage = parseFloat(document.getElementById("wastage").value) || 0;
    const packSize = parseFloat(document.getElementById("packSize").value);
    const price = parseFloat(document.getElementById("price").value);

    if (!length || length <= 0) {
        if (!auto) alert("Please enter a valid room length.");
        resultDiv.innerHTML = "";
        return;
    }

    const width = parseFloat(widthInputEl.value);
    if (!width || width <= 0) {
        if (!auto) alert("Please enter a valid room width.");
        resultDiv.innerHTML = "";
        return;
    }

    let sheetWidthUsed = null;
    if (p.type === "sheet" && widthDropdown.style.display !== "none") {
        const val = parseFloat(widthDropdown.value);
        sheetWidthUsed = isNaN(val) ? null : val;
    }

    if (!price || price <= 0) {
        if (!auto) alert("Product is missing a valid trade price.");
        resultDiv.innerHTML = "";
        return;
    }

    const roomArea = length * width;
    let areaPlusWaste = roomArea;

    if (p.type === "pack") {
        areaPlusWaste = roomArea * (1 + wastage / 100);
    }

    let materialTotal = 0;
    let packsNeeded = null;

    if (p.type === "pack") {
        if (!packSize || packSize <= 0) {
            if (!auto) alert("This product has no valid pack size.");
            resultDiv.innerHTML = "";
            return;
        }
        packsNeeded = Math.ceil(areaPlusWaste / packSize);
        materialTotal = packsNeeded * price;
    } else if (p.type === "sheet") {
        // Sheet goods: price per m², no extra wastage logic
        materialTotal = roomArea * price;
    }

    // Accessories cost (qty always user-entered, default 0.00)
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

        let cost = 0;
        if (selected && qtyVal > 0 && def.price > 0) {
            cost = qtyVal * def.price;
            accessoryTotal += cost;

            const uLabel = unitDisplay(def.unit);
            breakdownLines.push(
                `${def.name}: £${cost.toFixed(2)} (${qtyVal.toFixed(2)} ${uLabel} @ £${def.price.toFixed(2)})`
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

    // Build result HTML with clearer breakdown
    let html = `
        <strong>Room Summary</strong><br>
        Room area: ${roomArea.toFixed(2)} m²<br>
    `;

    if (p.type === "pack") {
        html += `Area incl. ${wastage}% wastage: ${areaPlusWaste.toFixed(2)} m²<br>`;
    }

    if (p.type === "sheet" && sheetWidthUsed) {
        html += `Roll width selected: ${sheetWidthUsed} m<br>`;
    }

    html += `<br><strong>Material</strong><br>`;
    if (p.type === "pack") {
        html += `Packs required: ${packsNeeded}<br>`;
    }
    html += `Material total: £${materialTotal.toFixed(2)}<br>`;

    html += `<br><strong>Accessories</strong><br>`;
    if (breakdownLines.length) {
        html += breakdownLines.join("<br>") + "<br>";
    } else {
        html += "None<br>";
    }

    html += `<br><strong>Room total:</strong> £${lineTotal.toFixed(2)}`;

    resultDiv.innerHTML = `<div class="cost-block">${html}</div>`;

    // Save to room
    const room = rooms.find(r => r.id === activeRoomId);
    if (room) {
        room.data = {
            productIndex: parseInt(productIndexStr, 10),
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
    }

    // Auto-update project summary
    updateSummary();

    // Auto-update saved customer (if one exists with this name)
    autoUpdateCurrentCustomer();

    // Show a subtle "saved" message on manual calculate
    if (!auto) {
        savedMsg.textContent = "✓ Room saved to project";
        setTimeout(() => {
            savedMsg.textContent = "";
        }, 1500);
    }
}

//------------------------------------------------------
// SUMMARY
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

        const p = products[d.productIndex];
        const productName = p ? `${p.brand} - ${p.rangeName}` : "Product";

        grandTotal += d.lineTotal;

        return `
            <tr>
                <td>${r.name}</td>
                <td>${productName}</td>
                <td>${d.roomArea.toFixed(2)} m²</td>
                <td>${p && p.type === "pack" ? (d.packsNeeded || 0) : "N/A"}</td>
                <td>£${d.materialTotal.toFixed(2)}</td>
                <td>£${d.accessoryTotal.toFixed(2)}</td>
                <td>£${d.lineTotal.toFixed(2)}</td>
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
        <div class="summary-total">Grand Total: £${grandTotal.toFixed(2)}</div>
    `;

    contentDiv.innerHTML = tableHtml;
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
        document.getElementById("roomTitle").textContent = "No room selected";
        document.getElementById("result").innerHTML = "";
    }

    updateSummary();
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
    document.getElementById("roomTitle").textContent = "No room selected";
    document.getElementById("result").innerHTML = "";
    document.getElementById("summaryContent").innerHTML = `<p class="muted">No rooms calculated yet.</p>`;
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
