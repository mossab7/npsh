let currentData = [];
let npshChart = null;

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

    // Check if the file has sections marked with # headers
    const hasSections = lines.some(line => line.trim().startsWith('#'));
    
    if (hasSections) {
        return parseSectionedCSV(lines);
    } else {
        return parseStandardCSV(lines);
    }
}

function parseStandardCSV(lines) {
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

function parseSectionedCSV(lines) {
    let currentSection = '';
    const operatingData = [];
    const npshrCurve = [];
    let operatingHeaders = [];
    let npshrHeaders = [];
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Skip empty lines
        if (!line) continue;
        
        // Check for section headers
        if (line.startsWith('#')) {
            currentSection = line.substring(1).trim().toLowerCase();
            continue;
        }
        
        // Process data based on current section
        if (currentSection === 'operating data') {
            if (operatingHeaders.length === 0) {
                operatingHeaders = line.split(',').map(h => h.trim());
            } else {
                const values = line.split(',').map(v => v.trim());
                if (values.length === operatingHeaders.length) {
                    const row = {};
                    operatingHeaders.forEach((header, index) => {
                        row[header] = values[index];
                    });
                    operatingData.push(row);
                }
            }
        } else if (currentSection === 'npshr curve') {
            if (npshrHeaders.length === 0) {
                npshrHeaders = line.split(',').map(h => h.trim());
            } else {
                const values = line.split(',').map(v => v.trim());
                if (values.length === npshrHeaders.length) {
                    const row = {};
                    npshrHeaders.forEach((header, index) => {
                        row[header] = values[index];
                    });
                    npshrCurve.push(row);
                }
            }
        }
    }
    
    // Combine the data by matching flow rates with the NPSHr curve
    if (operatingData.length > 0 && npshrCurve.length > 0) {
        return combineOperatingDataWithNPSHrCurve(operatingData, npshrCurve);
    }
    
    // Fallback to just the operating data if we have it
    return operatingData;
}

function combineOperatingDataWithNPSHrCurve(operatingData, npshrCurve) {
    // Sort the NPSHr curve by flow rate for interpolation
    npshrCurve.sort((a, b) => {
        const flowKeyA = Object.keys(a).find(key => key.toLowerCase().includes('débit') || key.toLowerCase().includes('flow'));
        const flowKeyB = Object.keys(b).find(key => key.toLowerCase().includes('débit') || key.toLowerCase().includes('flow'));
        return parseFloat(a[flowKeyA]) - parseFloat(b[flowKeyB]);
    });
    
    return operatingData.map(opData => {
        // Find the flow rate key in the operating data
        const opFlowKey = Object.keys(opData).find(key => 
            key.toLowerCase().includes('débit') || key.toLowerCase().includes('flow'));
        
        // Find the flow rate key in the NPSHr curve data
        const curveFlowKey = Object.keys(npshrCurve[0]).find(key => 
            key.toLowerCase().includes('débit') || key.toLowerCase().includes('flow'));
        
        // Find the NPSHr key in the curve data
        const npshrKey = Object.keys(npshrCurve[0]).find(key => 
            key.toLowerCase().includes('npshr'));
        
        if (opFlowKey && curveFlowKey && npshrKey) {
            const flowRate = parseFloat(opData[opFlowKey]);
            
            // Interpolate to find the NPSHr value for this flow rate
            const npshrValue = interpolateNPSHr(flowRate, npshrCurve, curveFlowKey, npshrKey);
            
            // Add the interpolated NPSHr to the operating data
            opData['NPSHr (m)'] = npshrValue.toString();
        }
        
        return opData;
    });
}

function interpolateNPSHr(flowRate, npshrCurve, flowKey, npshrKey) {
    // Find the two points to interpolate between
    let lowerPoint = null;
    let upperPoint = null;
    
    for (const point of npshrCurve) {
        const pointFlow = parseFloat(point[flowKey]);
        
        if (pointFlow === flowRate) {
            // Exact match found
            return parseFloat(point[npshrKey]);
        }
        
        if (pointFlow < flowRate) {
            lowerPoint = point;
        } else {
            upperPoint = point;
            break;
        }
    }
    
    // Handle edge cases
    if (!lowerPoint) {
        // Flow rate is below the curve's minimum point
        return parseFloat(npshrCurve[0][npshrKey]);
    }
    
    if (!upperPoint) {
        // Flow rate is above the curve's maximum point
        return parseFloat(npshrCurve[npshrCurve.length - 1][npshrKey]);
    }
    
    // Perform linear interpolation
    const lowerFlow = parseFloat(lowerPoint[flowKey]);
    const upperFlow = parseFloat(upperPoint[flowKey]);
    const lowerNPSHr = parseFloat(lowerPoint[npshrKey]);
    const upperNPSHr = parseFloat(upperPoint[npshrKey]);
    
    const proportion = (flowRate - lowerFlow) / (upperFlow - lowerFlow);
    const interpolatedNPSHr = lowerNPSHr + proportion * (upperNPSHr - lowerNPSHr);
    
    return interpolatedNPSHr;
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
    updateChart();
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

function updateChart() {
    const chartContainer = document.getElementById('chartContainer');
    
    if (currentData.length === 0) {
        chartContainer.style.display = 'none';
        return;
    }
    
    // Sort data by flow rate for proper line chart
    const sortedData = [...currentData].sort((a, b) => a.flow - b.flow);
    
    // Prepare data for chart
    const flowRates = sortedData.map(item => item.flow);
    const npshaValues = sortedData.map(item => item.npsha);
    const npshrValues = sortedData.map(item => item.npshr);
    
    // Calculate margin data (NPSHa - NPSHr)
    const marginValues = sortedData.map(item => item.npsha - item.npshr);
    
    // Determine danger zones (where margin is negative)
    const dangerPoints = sortedData
        .filter(item => item.npsha < item.npshr)
        .map(item => ({ x: item.flow, y: item.npsha }));
    
    // Create or update chart
    const ctx = document.getElementById('npshChart').getContext('2d');
    
    if (npshChart) {
        npshChart.destroy();
    }
    
    npshChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: flowRates,
            datasets: [
                {
                    label: 'NPSHa (Available)',
                    data: npshaValues,
                    borderColor: '#27ae60',
                    backgroundColor: 'rgba(39, 174, 96, 0.2)',
                    borderWidth: 3,
                    tension: 0.3,
                    pointRadius: 4,
                    pointBackgroundColor: '#27ae60'
                },
                {
                    label: 'NPSHr (Required)',
                    data: npshrValues,
                    borderColor: '#e74c3c',
                    backgroundColor: 'rgba(231, 76, 60, 0.2)',
                    borderWidth: 3,
                    tension: 0.3,
                    pointRadius: 4,
                    pointBackgroundColor: '#e74c3c'
                },
                {
                    label: 'Safety Margin',
                    data: marginValues,
                    borderColor: '#3498db',
                    backgroundColor: 'rgba(52, 152, 219, 0.2)',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    tension: 0.3,
                    pointRadius: 0,
                    fill: true,
                    hidden: true // Hidden by default, can be toggled
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: 'NPSH Analysis: Available vs Required',
                    font: {
                        size: 16,
                        weight: 'bold'
                    }
                },
                tooltip: {
                    callbacks: {
                        afterLabel: function(context) {
                            const dataIndex = context.dataIndex;
                            const margin = npshaValues[dataIndex] - npshrValues[dataIndex];
                            const status = margin >= 0 ? '✅ Safe' : '⚠️ Risk';
                            return `Margin: ${margin.toFixed(2)}m (${status})`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Flow Rate (m³/h)',
                        font: {
                            weight: 'bold'
                        }
                    },
                    grid: {
                        display: false
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'NPSH (m)',
                        font: {
                            weight: 'bold'
                        }
                    },
                    beginAtZero: false
                }
            }
        }
    });
    
    // Show the chart container
    chartContainer.style.display = 'block';
}

function clearData() {
    currentData = [];
    document.getElementById('csvFile').value = '';
    document.getElementById('dataBody').innerHTML = '<tr><td colspan="6" class="no-data">No data loaded. Please select a CSV file to analyze.</td></tr>';
    document.getElementById('stats').style.display = 'none';
    document.getElementById('chartContainer').style.display = 'none';

    // Clear chart if it exists
    if (npshChart) {
        npshChart.destroy();
        npshChart = null;
    }
    
    hideAlerts();
    showAlert('Data cleared successfully.', 'success');
}

// Add these helper functions at the end of your file

function showLoading(show) {
    const loading = document.getElementById('loading');
    if (loading) {
        loading.style.display = show ? 'flex' : 'none';
    }
}

function showAlert(message, type) {
    hideAlerts();
    const alertElement = document.getElementById(`${type}Alert`);
    if (alertElement) {
        alertElement.textContent = message;
        alertElement.style.display = 'block';
        
        // Auto-hide success messages after 5 seconds
        if (type === 'success') {
            setTimeout(() => {
                alertElement.style.display = 'none';
            }, 5000);
        }
    }
}

function hideAlerts() {
    document.getElementById('successAlert').style.display = 'none';
    document.getElementById('errorAlert').style.display = 'none';
}