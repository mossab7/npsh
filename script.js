let currentData = [];

document.getElementById('csvFile').addEventListener('change', handleFileSelect);

function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.csv')) {
        showAlert('Please select a valid CSV file.', 'error');
        return;
    }

    showLoading(true);
    hideAlerts();

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const csv = e.target.result;
            const data = parseCSV(csv);
            processData(data);
            showAlert(`Successfully loaded ${data.length} records from ${file.name}`, 'success');
        } catch (error) {
            showAlert(`Error reading file: ${error.message}`, 'error');
        } finally {
            showLoading(false);
        }
    };
    reader.readAsText(file);
}

function parseCSV(csv) {
    const lines = csv.trim().split('\n');
    if (lines.length < 2) {
        throw new Error('CSV file must contain at least a header and one data row');
    }

    const headers = lines[0].split(',').map(h => h.trim());
    const data = [];

    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        if (values.length === headers.length) {
            const row = {};
            headers.forEach((header, index) => {
                row[header] = values[index];
            });
            data.push(row);
        }
    }

    return data;
}

function processData(data) {
    currentData = [];
    let safeCount = 0;
    let dangerCount = 0;

    data.forEach(row => {
        try {
            const temp = parseFloat(row['Température (°C)'] || row['Temperature (°C)'] || row['Temperature']);
            const pressure = parseFloat(row['Pression (bar)'] || row['Pressure (bar)'] || row['Pressure']);
            const flow = parseFloat(row['Débit (m3/h)'] || row['Flow (m3/h)'] || row['Flow Rate']);
            const npshr = parseFloat(row['NPSHr (m)'] || row['NPSHr']);
            const npsha = parseFloat(row['NPSHa (m)'] || row['NPSHa']);

            if (isNaN(temp) || isNaN(pressure) || isNaN(flow) || isNaN(npshr) || isNaN(npsha)) {
                return; // Skip invalid rows
            }

            const isSafe = npsha >= npshr;
            const status = isSafe ? '✅ OK' : '⚠️ Cavitation Risk';
            
            if (isSafe) {
                safeCount++;
            } else {
                dangerCount++;
            }

            currentData.push({
                temp,
                pressure,
                flow,
                npshr,
                npsha,
                status,
                isSafe
            });
        } catch (error) {
            // Skip invalid rows
        }
    });

    updateTable();
    updateStats(safeCount, dangerCount);
}

function updateTable() {
    const tbody = document.getElementById('dataBody');
    
    if (currentData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="no-data">No valid data found in the CSV file.</td></tr>';
        return;
    }

    tbody.innerHTML = currentData.map(row => `
        <tr class="${row.isSafe ? 'row-safe' : 'row-danger'}">
            <td>${row.temp.toFixed(1)}</td>
            <td>${row.pressure.toFixed(2)}</td>
            <td>${row.flow.toFixed(1)}</td>
            <td>${row.npshr.toFixed(2)}</td>
            <td>${row.npsha.toFixed(2)}</td>
            <td><span class="${row.isSafe ? 'status-ok' : 'status-warning'}">${row.status}</span></td>
        </tr>
    `).join('');
}

function updateStats(safeCount, dangerCount) {
    const total = safeCount + dangerCount;
    const riskPercentage = total > 0 ? ((dangerCount / total) * 100).toFixed(1) : 0;

    document.getElementById('totalRecords').textContent = total;
    document.getElementById('safeCount').textContent = safeCount;
    document.getElementById('dangerCount').textContent = dangerCount;
    document.getElementById('riskPercentage').textContent = `${riskPercentage}%`;

    document.getElementById('stats').style.display = total > 0 ? 'grid' : 'none';
}

function clearData() {
    currentData = [];
    document.getElementById('csvFile').value = '';
    document.getElementById('dataBody').innerHTML = '<tr><td colspan="6" class="no-data">No data loaded. Please select a CSV file to analyze.</td></tr>';
    document.getElementById('stats').style.display = 'none';
    hideAlerts();
    showAlert('Data cleared successfully.', 'success');
}

function showLoading(show) {
    document.getElementById('loading').style.display = show ? 'flex' : 'none';
}

function showAlert(message, type) {
    const alertId = type === 'success' ? 'successAlert' : 'errorAlert';
    const alertElement = document.getElementById(alertId);
    alertElement.textContent = message;
    alertElement.style.display = 'block';
    
    setTimeout(() => {
        alertElement.style.display = 'none';
    }, 5000);
}

function hideAlerts() {
    document.getElementById('successAlert').style.display = 'none';
    document.getElementById('errorAlert').style.display = 'none';
}