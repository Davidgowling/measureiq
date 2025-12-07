//------------------------------------------------------
// LOAD PRODUCTS FROM JSON
//------------------------------------------------------
let products = [];

fetch("products.json")
    .then(response => response.json())
    .then(data => {
        products = data;
        loadProducts();
    })
    .catch(err => console.error("Failed to load products.json", err));


//------------------------------------------------------
// ROOM + PROJECT DATA
//------------------------------------------------------
let rooms = [];
let activeRoomId = null;


//------------------------------------------------------
// CLEAR FORM EACH TIME A NEW ROOM IS SELECTED
//------------------------------------------------------
function clearForm() {
    document.getElementById("productSelect").value = "";
    document.getElementById("length").value = "";
    document.getElementById("widthInput").value = "";
    document.getElementById("wastage").value = 10;
    document.getElementById("packSize").value = "";
    document.getElementById("price").value = "";
    document.getElementById("widthDropdown").style.display = "none";
    document.getElementById("widthInput").style.display = "block";
    document.getElementById("widthDropdown").innerHTML = "";
    document.getElementById("result").innerHTML = "";
}


//------------------------------------------------------
// ADD ROOM
//------------------------------------------------------
document.getElementById("addRoomBtn").addEventListener("click", () => {
    const roomName = prompt("Enter room name:");
    if (!roomName) return;

    const room = {
        id: Date.now(),
        name: roomName,
        data: {}
    };

    rooms.push(room);
    activeRoomId = room.id;

    updateRoomList();
    clearForm();
    loadRoom(room.id);
});


//------------------------------------------------------
// RENDER ROOM LIST
//------------------------------------------------------
function updateRoomList() {
    const list = document.getElementById("roomList");
    list.innerHTML = "";

    rooms.forEach(room => {
        const li = document.createElement("li");
        li.textContent = room.name;
        li.style.cursor = "pointer";

        li.onclick = () => {
            clearForm();
            loadRoom(room.id);
        };

        list.appendChild(li);
    });

    updateSummary();
}


//------------------------------------------------------
// LOAD SELECTED ROOM
//------------------------------------------------------
function loadRoom(id) {
    activeRoomId = id;
    const room = rooms.find(r => r.id === id);

    document.getElementById("roomCalculator").style.display = "block";
    document.getElementById("roomTitle").textContent = room.name;

    if (room.data && Object.keys(room.data).length > 0) {
        document.getElementById("length").value = room.data.length ?? "";
        document.getElementById("widthInput").value = room.data.width ?? "";
        document.getElementById("productSelect").value = room.data.productId ?? "";

        if (room.data.productId) {
            updateProductDetails();
        }
    }
}


//------------------------------------------------------
// EDIT ROOM NAME
//------------------------------------------------------
document.getElementById("editRoomBtn").addEventListener("click", () => {
    const room = rooms.find(r => r.id === activeRoomId);
    const newName = prompt("Enter new room name:", room.name);
    if (!newName) return;

    room.name = newName;
    updateRoomList();
    loadRoom(room.id);
});


//------------------------------------------------------
// DELETE ROOM
//------------------------------------------------------
document.getElementById("deleteRoomBtn").addEventListener("click", () => {
    if (!confirm("Are you sure you want to delete this room?")) return;

    rooms = rooms.filter(r => r.id !== activeRoomId);
    activeRoomId = null;

    document.getElementById("roomCalculator").style.display = "none";
    updateRoomList();
    updateSummary();
});


//------------------------------------------------------
// POPULATE PRODUCTS
//------------------------------------------------------
function loadProducts() {
    const select = document.getElementById("productSelect");

    products.forEach(product => {
        const option = document.createElement("option");
        option.value = product.id;
        option.textContent = `${product.brand} – ${product.rangeName}`;
        select.appendChild(option);
    });
}


//------------------------------------------------------
// UPDATE PRODUCT DETAILS ON SELECTION
//------------------------------------------------------
function updateProductDetails() {
    const productId = parseInt(document.getElementById("productSelect").value);
    const product = products.find(p => p.id === productId);

    const packSizeInput = document.getElementById("packSize");
    const priceInput = document.getElementById("price");
    const widthInput = document.getElementById("widthInput");
    const widthDropdown = document.getElementById("widthDropdown");

    if (!product) {
        clearForm();
        return;
    }

    priceInput.value = product.tradePrice;

    if (product.type === "pack") {
        packSizeInput.value = product.packSize;
        widthInput.style.display = "block";
        widthDropdown.style.display = "none";
        widthDropdown.innerHTML = "";
    }

    if (product.type === "sheet") {
        packSizeInput.value = "";
        widthInput.style.display = "none";
        widthDropdown.style.display = "block";
        widthDropdown.innerHTML = "";

        product.availableWidths.forEach(width => {
            let opt = document.createElement("option");
            opt.value = width;
            opt.textContent = `${width}m Width`;
            widthDropdown.appendChild(opt);
        });
    }
}


//------------------------------------------------------
// CALCULATE ROOM
//------------------------------------------------------
function calculateRoom() {
    const productId = parseInt(document.getElementById("productSelect").value);
    const product = products.find(p => p.id === productId);
    if (!product) { alert("Please select a product."); return; }

    const length = parseFloat(document.getElementById("length").value);
    const wastage = parseFloat(document.getElementById("wastage").value);
    const packSize = parseFloat(document.getElementById("packSize").value);
    const tradePrice = parseFloat(document.getElementById("price").value);

    let width = (product.type === "pack")
        ? parseFloat(document.getElementById("widthInput").value)
        : parseFloat(document.getElementById("widthDropdown").value);

    if (!length || !width) {
        alert("Please enter valid dimensions.");
        return;
    }

    const area = length * width;
    const totalArea = area * (1 + wastage / 100);
    let totalCost = 0;
    let output = "";
    const room = rooms.find(r => r.id === activeRoomId);

    if (product.type === "pack") {
        const packsNeeded = Math.ceil(totalArea / packSize);
        totalCost = (packsNeeded * tradePrice).toFixed(2);

        room.data = { length, width, productId, packsNeeded, totalCost };

        output = `
            <h3>${room.name} — Pack</h3>
            <p><strong>Area:</strong> ${area.toFixed(2)} m²</p>
            <p><strong>Packs Needed:</strong> ${packsNeeded}</p>
            <p><strong>Total Cost:</strong> £${totalCost}</p>
        `;
    }

    if (product.type === "sheet") {
        totalCost = (totalArea * tradePrice).toFixed(2);

        room.data = { length, width, productId, totalCost };

        output = `
            <h3>${room.name} — Sheet</h3>
            <p><strong>Area:</strong> ${area.toFixed(2)} m²</p>
            <p><strong>Total Cost:</strong> £${totalCost}</p>
        `;
    }

    document.getElementById("result").innerHTML = output;
    updateSummary();
}


//------------------------------------------------------
// SUMMARY SECTION
//------------------------------------------------------
function updateSummary() {
    const summary = document.getElementById("summary");
    const content = document.getElementById("summaryContent");

    if (rooms.length === 0) {
        summary.style.display = "none";
        return;
    }

    let html = "";
    let grandTotal = 0;

    rooms.forEach(room => {
        if (!room.data.totalCost) return;

        grandTotal += parseFloat(room.data.totalCost);

        html += `
            <div class="summary-room">
                <h3>${room.name}</h3>
                <p><strong>Total Cost:</strong> £${room.data.totalCost}</p>
            </div>
        `;
    });

    html += `<h2>Grand Total: £${grandTotal.toFixed(2)}</h2>`;

    content.innerHTML = html;
    summary.style.display = "block";
}


//------------------------------------------------------
// PRINT / PDF EXPORT
//------------------------------------------------------
document.getElementById("printBtn").addEventListener("click", () => {
    window.print();
});


//------------------------------------------------------
// BIND CALCULATE BUTTON
//------------------------------------------------------
document.getElementById("calculateBtn").addEventListener("click", calculateRoom);
