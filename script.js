function calculate() {
    const length = parseFloat(document.getElementById("length").value);
    const width = parseFloat(document.getElementById("width").value);
    const wastage = parseFloat(document.getElementById("wastage").value);

    if (!length || !width) {
        document.getElementById("result").innerText = "Please enter valid numbers.";
        return;
    }

    const area = length * width;
    const totalWithWastage = area * (1 + wastage / 100);

    document.getElementById("result").innerText = 
        `Total area needed: ${totalWithWastage.toFixed(2)} m²`;
}
document.getElementById("calculateBtn").addEventListener("click", calculate);