let currentData = [];
let npshChart = null;

// Pump metadata management
let currentPumpMetadata = {
    pumpType: '',
    ratedFlow: 0,
    aorMin: 0,
    aorMax: 0,
    porMin: 0,
    porMax: 0,
    ratedNPSHr: 0
};

// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', function() {
    // Initialize event listeners
    initializeEventListeners();
    
    // Check if key elements exist
    validateRequiredElements();
});

function initializeEventListeners() {
    const fileInput = document.getElementById('csvFile');
    if (fileInput) {
        fileInput.addEventListener('change', handleFileSelect);
        console.log('File input listener attached successfully');
    }
    
    // Ensure other buttons have listeners
    const clearButton = document.querySelector('.btn.btn-secondary');
    if (clearButton) {
        clearButton.addEventListener('click', clearData);
    }
    
    const configButton = document.querySelector('button[onclick="openPumpConfigModal()"]');
    if (configButton) {
        // Remove inline handler and use addEventListener
        configButton.removeAttribute('onclick');
        configButton.addEventListener('click', openPumpConfigModal);
    }
}

function validateRequiredElements() {
    const requiredElements = [
        'csvFile', 'pumpConfigModal', 'loading', 'successAlert', 'errorAlert',
        'dataBody', 'stats', 'chartContainer', 'npshChart', 'pumpMetadata'
    ];
    
    let allFound = true;
    requiredElements.forEach(id => {
        const element = document.getElementById(id);
        if (!element) {
            console.error(`Required element not found: #${id}`);
            allFound = false;
        }
    });
    
    if (allFound) {
        console.log('All required elements found in the DOM');
    }
}

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
    
    // Only add these if pump metadata is available
    if (currentPumpMetadata.pumpType) {
        const datasets = npshChart.data.datasets;
        const maxY = Math.max(...npshaValues, ...npshrValues) * 1.2;

        // Add AOR range as a properly shaded vertical band
        datasets.push({
            label: 'AOR Range',
            data: [
                { x: currentPumpMetadata.aorMin, y: 0 },
                { x: currentPumpMetadata.aorMin, y: maxY },
                { x: currentPumpMetadata.aorMax, y: maxY },
                { x: currentPumpMetadata.aorMax, y: 0 }
            ],
            backgroundColor: 'rgba(108, 142, 191, 0.15)',
            borderColor: 'rgba(108, 142, 191, 0.5)',
            borderWidth: 1,
            fill: true,
            pointRadius: 0,
            pointHoverRadius: 0,
            segment: { borderDash: [5, 5] }
        });
        
        // Add POR range as a properly shaded vertical band with green highlight
        datasets.push({
            label: 'POR Range',
            data: [
                { x: currentPumpMetadata.porMin, y: 0 },
                { x: currentPumpMetadata.porMin, y: maxY },
                { x: currentPumpMetadata.porMax, y: maxY },
                { x: currentPumpMetadata.porMax, y: 0 }
            ],
            backgroundColor: 'rgba(46, 204, 113, 0.2)',
            borderColor: 'rgba(46, 204, 113, 0.6)',
            borderWidth: 1,
            fill: true,
            pointRadius: 0,
            pointHoverRadius: 0,
            segment: { borderDash: [5, 5] }
        });

        // Add vertical line for rated flow with label
        datasets.push({
            label: 'Rated Flow',
            data: [
                { x: currentPumpMetadata.ratedFlow, y: 0 },
                { x: currentPumpMetadata.ratedFlow, y: maxY }
            ],
            borderColor: '#9b59b6',
            borderWidth: 2,
            borderDash: [5, 5],
            pointRadius: 0,
            fill: false
        });
        
        // Add vertical line for runout flow (aorMax)
        datasets.push({
            label: 'Runout Flow',
            data: [
                { x: currentPumpMetadata.aorMax, y: 0 },
                { x: currentPumpMetadata.aorMax, y: maxY }
            ],
            borderColor: '#e67e22',
            borderWidth: 2,
            borderDash: [8, 4],
            pointRadius: 0,
            fill: false
        });
        
        // Add annotations for key points
        npshChart.options.plugins.annotation = {
            annotations: {
                ratedFlowLabel: {
                    type: 'label',
                    xValue: currentPumpMetadata.ratedFlow,
                    yValue: maxY * 0.95,
                    content: [`Rated Flow`, `(${currentPumpMetadata.ratedFlow} m³/h)`],
                    backgroundColor: 'rgba(155, 89, 182, 0.7)',
                    color: 'white',
                    font: {
                        size: 11
                    },
                    padding: 4
                },
                runoutFlowLabel: {
                    type: 'label',
                    xValue: currentPumpMetadata.aorMax,
                    yValue: maxY * 0.85,
                    content: [`Runout Flow`, `(${currentPumpMetadata.aorMax} m³/h)`],
                    backgroundColor: 'rgba(230, 126, 34, 0.7)',
                    color: 'white',
                    font: {
                        size: 11
                    },
                    padding: 4
                },
                aorLabel: {
                    type: 'label',
                    xValue: (currentPumpMetadata.aorMin + currentPumpMetadata.aorMax) / 2,
                    yValue: maxY * 0.10,
                    content: 'Allowable Operating Range',
                    backgroundColor: 'rgba(108, 142, 191, 0.3)',
                    color: '#2c3e50',
                    font: {
                        size: 12
                    },
                    padding: 6
                },
                porLabel: {
                    type: 'label',
                    xValue: (currentPumpMetadata.porMin + currentPumpMetadata.porMax) / 2,
                    yValue: maxY * 0.20,
                    content: 'Preferred Operating Range',
                    backgroundColor: 'rgba(46, 204, 113, 0.3)',
                    color: '#2c3e50',
                    font: {
                        size: 12
                    },
                    padding: 6
                }
            }
        };
    }
    
    // Update chart options to include custom tooltips for pump metadata
    npshChart.options.plugins.tooltip.callbacks.afterBody = function(tooltipItems) {
        const tooltipItem = tooltipItems[0];
        const flowRate = tooltipItem.parsed.x;
        
        if (!currentPumpMetadata.pumpType) return null;
        
        let operationStatus = '';
        let statusEmoji = '';
        let statusInfo = '';
        
        if (flowRate < currentPumpMetadata.aorMin) {
            statusEmoji = '⚠️';
            operationStatus = 'Below Minimum Flow';
            statusInfo = 'Risk of pump overheating and damage';
        } else if (flowRate > currentPumpMetadata.aorMax) {
            statusEmoji = '⚠️';
            operationStatus = 'Above Runout Flow';
            statusInfo = 'Risk of motor overload and bearing damage';
        } else if (flowRate < currentPumpMetadata.porMin || flowRate > currentPumpMetadata.porMax) {
            statusEmoji = '⚠️';
            operationStatus = 'Outside Preferred Range';
            statusInfo = 'Reduced efficiency and increased wear';
        } else {
            statusEmoji = '✅';
            operationStatus = 'Within Preferred Range';
            statusInfo = 'Optimal efficiency and reliability';
        }
        
        // Check if this is the rated flow point
        let specialPoint = '';
        if (Math.abs(flowRate - currentPumpMetadata.ratedFlow) < 5) {
            specialPoint = '⭐ Near Rated Flow Point';
        } else if (Math.abs(flowRate - currentPumpMetadata.aorMax) < 5) {
            specialPoint = '⚡ Near Runout Flow Point';
        }
        
        const result = [
            `Pump: ${currentPumpMetadata.pumpType}`,
            `${statusEmoji} ${operationStatus}`,
            statusInfo
        ];
        
        if (specialPoint) {
            result.push(specialPoint);
        }
        
        return result;
    };
    
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

// Pump metadata management
function loadPumpMetadata(pumpData) {
    currentPumpMetadata = {...pumpData};
    displayPumpMetadata();
    updateChart(); // Redraw chart with new pump data
}

function displayPumpMetadata() {
    const metadataContainer = document.getElementById('pumpMetadata');
    if (!metadataContainer) return;
    
    if (!currentPumpMetadata.pumpType) {
        metadataContainer.style.display = 'none';
        return;
    }
    
    metadataContainer.innerHTML = `
        <div class="metadata-item">
            <span class="metadata-label">Pump Type:</span>
            <span class="metadata-value">${currentPumpMetadata.pumpType}</span>
        </div>
        <div class="metadata-item">
            <span class="metadata-label">Rated Flow:</span>
            <span class="metadata-value">${currentPumpMetadata.ratedFlow} m³/h</span>
        </div>
        <div class="metadata-item">
            <span class="metadata-label">AOR Range:</span>
            <span class="metadata-value">${currentPumpMetadata.aorMin}–${currentPumpMetadata.aorMax} m³/h</span>
        </div>
        <div class="metadata-item">
            <span class="metadata-label">POR Range:</span>
            <span class="metadata-value">${currentPumpMetadata.porMin}–${currentPumpMetadata.porMax} m³/h</span>
        </div>
        <div class="metadata-item">
            <span class="metadata-label">Rated NPSHr:</span>
            <span class="metadata-value">${currentPumpMetadata.ratedNPSHr} m</span>
        </div>
    `;
    
    metadataContainer.style.display = 'flex';
}

// Pump configuration modal functions
function openPumpConfigModal() {
    const modal = document.getElementById('pumpConfigModal');
    if (!modal) return;
    
    // Populate fields with current data if available
    if (currentPumpMetadata.pumpType) {
        document.getElementById('pumpType').value = currentPumpMetadata.pumpType;
        document.getElementById('ratedFlow').value = currentPumpMetadata.ratedFlow;
        document.getElementById('aorMin').value = currentPumpMetadata.aorMin;
        document.getElementById('aorMax').value = currentPumpMetadata.aorMax;
        document.getElementById('porMin').value = currentPumpMetadata.porMin;
        document.getElementById('porMax').value = currentPumpMetadata.porMax;
        document.getElementById('ratedNPSHr').value = currentPumpMetadata.ratedNPSHr;
    }
    
    modal.style.display = 'flex';
}

function closeModal() {
    const modal = document.getElementById('pumpConfigModal');
    if (modal) modal.style.display = 'none';
}

function savePumpConfig() {
    const pumpData = {
        pumpType: document.getElementById('pumpType').value,
        ratedFlow: parseFloat(document.getElementById('ratedFlow').value) || 0,
        aorMin: parseFloat(document.getElementById('aorMin').value) || 0,
        aorMax: parseFloat(document.getElementById('aorMax').value) || 0,
        porMin: parseFloat(document.getElementById('porMin').value) || 0,
        porMax: parseFloat(document.getElementById('porMax').value) || 0,
        ratedNPSHr: parseFloat(document.getElementById('ratedNPSHr').value) || 0
    };
    
    loadPumpMetadata(pumpData);
    closeModal();
    showAlert('Pump configuration saved successfully', 'success');
}

function loadPresetPump() {
    // Predefined pump configurations
    const presets = [
        {
            pumpType: '8x15DMX-3',
            ratedFlow: 480,
            aorMin: 480,
            aorMax: 1073,
            porMin: 653,
            porMax: 1026,
            ratedNPSHr: 16.4
        },
        {
            pumpType: '6x10DMX-2',
            ratedFlow: 320,
            aorMin: 320,
            aorMax: 850,
            porMin: 450,
            porMax: 780,
            ratedNPSHr: 12.8
        }
        // Add more presets as needed
    ];
    
    // For simplicity, just load the first preset
    // In a real app, you might want to show a selection dialog
    loadPumpMetadata(presets[0]);
    closeModal();
    showAlert(`Loaded preset pump configuration: ${presets[0].pumpType}`, 'success');
}