// ─── FIREBASE CONFIGURATION ───────────────────────────────────────
const firebaseConfig = {
  databaseURL: "https://cropvault-3095c-default-rtdb.asia-southeast1.firebasedatabase.app"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// ─── STATE & LIVE DATA ───────────────────────────────────────────
let currentTemp = 0;
let currentHumid = 0;
let crops = []; 

let historicalData = {
  weekly: { temp: new Array(7).fill(0), humid: new Array(7).fill(0) },
  monthly: { temp: new Array(30).fill(0), humid: new Array(30).fill(0) },
  yearly: { temp: new Array(12).fill(0), humid: new Array(12).fill(0) }
};

let period = 'weekly';
let metric = 'temp';

// ─── LOAD DATA FROM LOCAL JSON ───────────────────────────────────
async function loadCrops() {
  try {
    const response = await fetch('crops.json');
    crops = await response.json();
    initCropUI(); 
  } catch (error) {
    console.error("Critical error: Could not load crops.json.", error);
  }
}

// ─── FIREBASE REAL-TIME LISTENER ──────────────────────────────────
db.ref('warehouse').on('value', (snapshot) => {
  const data = snapshot.val();
  if (data) {
    currentTemp = data.temperature;
    currentHumid = data.humidity;
    
    updateLiveReadings();
    
    // Sync with Crop Guide logic
    const currentCropName = document.getElementById('cropName').textContent;
    if (currentCropName !== "—") {
      const crop = crops.find(c => c.name === currentCropName);
      if (crop) showCrop(crop, false); 
    }
  }
});

// ─── SYNC THRESHOLDS & SILENCE TO FIREBASE ────────────────────────
function syncThresholdsToFirebase() {
  const tMax = parseFloat(document.getElementById('tempThreshold').value) || 30;
  const hMax = parseFloat(document.getElementById('humidThreshold').value) || 70;

  localStorage.setItem('tempThreshold', tMax);
  localStorage.setItem('humidThreshold', hMax);
  
  db.ref('thresholds/tempMax').set(tMax);
  db.ref('thresholds/humidMax').set(hMax);
}

function silenceBuzzer() {
  const btn = document.getElementById('silenceBtn');
  const currentlySilenced = btn.classList.contains('active');
  const newState = !currentlySilenced;
  
  // UI Update
  if (newState) {
    btn.classList.add('active');
    btn.textContent = "Alarm Muted";
  } else {
    btn.classList.remove('active');
    btn.textContent = "Mute Alarm";
  }
  
  // Send to ESP32 via Firebase
  db.ref('thresholds/silence').set(newState);
}

// ─── LIVE READINGS UI UPDATE ─────────────────────────────────────
function updateLiveReadings() {
  const tempThresh = parseFloat(document.getElementById('tempThreshold').value) || 30;
  const humidThresh = parseFloat(document.getElementById('humidThreshold').value) || 70;

  document.getElementById('tempValue').innerHTML = `${currentTemp.toFixed(1)}<span class="reading-unit">°C</span>`;
  document.getElementById('humidValue').innerHTML = `${currentHumid.toFixed(1)}<span class="reading-unit">%</span>`;

  const tOver = currentTemp > tempThresh;
  const hOver = currentHumid > humidThresh;
  document.getElementById('tempStatus').textContent = tOver ? '● Exceeded' : '● Normal';
  document.getElementById('humidStatus').textContent = hOver ? '● Exceeded' : '● Normal';
  const isAnyAlert = tOver || hOver;
  
  document.getElementById('tempCard').className = 'reading-card' + (tOver ? ' danger' : '');
  document.getElementById('humidCard').className = 'reading-card' + (hOver ? ' warn' : '');

  const banner = document.getElementById('alertBanner');
  const sBtn = document.getElementById('silenceBtn');

  if (isAnyAlert) {
    document.getElementById('alertText').textContent = `Alert: Thresholds Exceeded`;
    banner.style.display = 'flex';
    banner.className = 'alert-banner ' + (tOver ? 'danger' : 'warning');
  } else {
    // Only clear banner and reset silence when levels are safe
    banner.style.display = 'none';
    
    // Auto-reset the silence flag in Firebase and UI when alarm condition clears
    db.ref('thresholds/silence').once('value', (snap) => {
        if(snap.val() === true) {
            db.ref('thresholds/silence').set(false);
            sBtn.classList.remove('active');
            sBtn.textContent = "Mute Alarm";
        }
    });
  }
}

// ─── CHART DRAWING ────────────────────────────────────────────────
let myChart;

function initChart() {
  const ctx = document.getElementById('liveChart').getContext('2d');
  myChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [], // Start empty
      datasets: [{
        label: 'Live Reading',
        data: [], // Start empty
        borderColor: '#3fb950',
        backgroundColor: 'rgba(63, 185, 80, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.4 
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: false, grid: { color: '#30363d' } },
        x: { grid: { display: false } }
      }
    }
  });
}

// Update the chart whenever data changes
function drawChart() {
  if (!myChart) {
    initChart();
  }

  // 1. Define labels based on the selected period
  let labels = [];
  if (period === 'weekly') {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  labels = [];
  for (let i = 6; i >= 0; i--) {
    let d = new Date();
    d.setDate(d.getDate() - i);
    labels.push(days[d.getDay()]); // This puts "Today" at the far right
  
}
  } else if (period === 'monthly') {
    // Generates 1 to 30
    labels = Array.from({length: 31}, (_, i) => i + 1);
  } else if (period === 'yearly') {
    labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  }

  // 2. Apply new data and labels to the chart
  myChart.data.labels = labels;
  myChart.data.datasets[0].data = historicalData[period][metric];
  
  // 3. Update Visuals
  myChart.data.datasets[0].label = metric === 'temp' ? 'Temperature (°C)' : 'Humidity (%)';
  myChart.data.datasets[0].borderColor = metric === 'temp' ? '#f85149' : '#58a6ff';
  myChart.data.datasets[0].backgroundColor = metric === 'temp' ? 'rgba(248, 81, 73, 0.1)' : 'rgba(88, 166, 255, 0.1)';

  myChart.update();
}

// ─── CROP UI LOGIC ───────────────────────────────────────────────
function initCropUI() {
  const qc = document.getElementById('quickCrops');
  const savedTemp = localStorage.getItem('tempThreshold');
  const savedHumid = localStorage.getItem('humidThreshold');

  if (savedTemp) {
    document.getElementById('tempThreshold').value = savedTemp;
  }
  if (savedHumid) {
    document.getElementById('humidThreshold').value = savedHumid;
  }
  const quickCropNames = ['Rice','Wheat','Potato','Onion','Banana','Soybean','Coffee'];
  
  quickCropNames.forEach(name => {
    const crop = crops.find(c => c.name === name);
    if (crop) {
      const btn = document.createElement('button');
      btn.className = 'quick-chip';
      btn.textContent = `${crop.emoji} ${crop.name}`;
      btn.onclick = () => { showCrop(crop, true); document.getElementById('cropSearchInput').value = name; };
      qc.appendChild(btn);
    }
  });

  const input = document.getElementById('cropSearchInput');
  const list = document.getElementById('autocompleteList');

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { list.classList.remove('open'); return; }
    const matches = crops.filter(c => c.name.toLowerCase().includes(q));
    
    list.innerHTML = '';
    matches.slice(0, 8).forEach(crop => {
      const item = document.createElement('div');
      item.className = 'autocomplete-item';
      item.innerHTML = `<span>${crop.emoji} ${crop.name}</span>`;
      item.onclick = () => { selectCrop(crop); };
      list.appendChild(item);
    });
    list.classList.add('open');
  });

  document.getElementById('tempThreshold').addEventListener('change', syncThresholdsToFirebase);
  document.getElementById('humidThreshold').addEventListener('change', syncThresholdsToFirebase);
}

function selectCrop(crop) {
  document.getElementById('cropSearchInput').value = crop.name;
  document.getElementById('autocompleteList').classList.remove('open');
  showCrop(crop, true); 
}

function showCrop(crop, updateThresholds = false) {
  document.getElementById('cropResult').classList.add('visible');
  document.getElementById('cropEmoji').textContent = crop.emoji;
  document.getElementById('cropName').textContent = crop.name;
  document.getElementById('cropCategory').textContent = crop.category;
  document.getElementById('cropTemp').textContent = `${crop.tempMin}–${crop.tempMax}°C`;
  document.getElementById('cropHumid').textContent = `${crop.humidMin}–${crop.humidMax}%`;
  document.getElementById('cropNotes').innerHTML = `<strong>📋 Storage Notes:</strong> ${crop.notes}`;

  if (updateThresholds) {
    document.getElementById('tempThreshold').value = crop.tempMax;
    document.getElementById('humidThreshold').value = crop.humidMax;
    syncThresholdsToFirebase();
  }

  const tOk = currentTemp >= crop.tempMin && currentTemp <= crop.tempMax;
  const hOk = currentHumid >= crop.humidMin && currentHumid <= crop.humidMax;

  document.getElementById('tempCompareBadge').innerHTML = `<div class="compare-badge ${tOk?'ok':'bad'}">${tOk?'✓ Suitable':'✗ Out of Range'}</div>`;
  document.getElementById('humidCompareBadge').innerHTML = `<div class="compare-badge ${hOk?'ok':'bad'}">${hOk?'✓ Suitable':'✗ Out of Range'}</div>`;
}

// ─── CONTROLS ─────────────────────────────────────────────────────
const googleSheetsUrl = "https://script.google.com/macros/s/AKfycbwtSlgAaLfV_9a7xQd08zp3t_N6jrdyEtCzqacl63xBXO5xcFsQdNLm8s2Z9PbkWbEL-Q/exec"; // Same URL as in your ESP32

async function fetchStats() {
  try {
    const response = await fetch(googleSheetsUrl);
    const data = await response.json();
    const currentMetric = metric; 

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    // 1. Logic for WEEKLY View
    if (period === 'weekly') {
  const weeklyArr = new Array(7).fill(0);
  for (let i = 0; i < 7; i++) {
    let d = new Date();
    d.setDate(now.getDate() - (6 - i)); // Look from 6 days ago up to Today
    
    let dateKey = d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
    let dayData = data.daily.find(item => item.date === dateKey);
    
    if (dayData) {
      weeklyArr[i] = parseFloat(dayData[currentMetric]);
    }
  }
  historicalData.weekly[currentMetric] = weeklyArr;



    // 2. Logic for MONTHLY View (With filtering)
    }  else if (period === 'monthly') {
  const monthlyArr = new Array(31).fill(0);
  
  data.daily.forEach(dayData => {
    // Split the "2026-02-05" string sent by the updated Apps Script
    const dateParts = dayData.date.split('-'); 
    const year = parseInt(dateParts[0]);
    const month = parseInt(dateParts[1]) - 1; 
    const day = parseInt(dateParts[2]);

    if (month === currentMonth && year === currentYear) {
      monthlyArr[day - 1] = parseFloat(dayData[currentMetric]);
    }
  });
  historicalData.monthly[currentMetric] = monthlyArr;

    // 3. Logic for YEARLY View
    } // 3. Logic for YEARLY View (Fixed for full year visibility)
 else if (period === 'yearly') {
  const yearlyArr = new Array(12).fill(0);
  
  // Directly map the data returned from Google Sheets
  data.monthly.forEach(monthData => {
    // Split "2026-07" into ["2026", "07"]
    const parts = monthData.date.split('-');
    const year = parseInt(parts[0]);
    const monthIndex = parseInt(parts[1]) - 1; // 07 becomes index 6 (July)

    if (year === currentYear) {
      yearlyArr[monthIndex] = parseFloat(monthData[currentMetric]);
    }
  });
  historicalData.yearly[currentMetric] = yearlyArr;
}

    // 4. Update Stat Boxes based on the FILTERED data
    const currentData = historicalData[period][metric].filter(val => val > 0);

    if (currentData.length > 0) {
      const maxVal = Math.max(...currentData).toFixed(1);
      const minVal = Math.min(...currentData).toFixed(1);
      const avgVal = (currentData.reduce((a, b) => a + b, 0) / currentData.length).toFixed(1);

      const unit = (metric === 'temp' ? '°C' : '%');
      document.getElementById('statAvg').innerHTML = `${avgVal}<span class="stat-box-unit">${unit}</span>`;
      document.getElementById('statMax').innerHTML = `${maxVal}<span class="stat-box-unit">${unit}</span>`;
      document.getElementById('statMin').innerHTML = `${minVal}<span class="stat-box-unit">${unit}</span>`;
    } else {
      document.getElementById('statAvg').innerHTML = `--`;
      document.getElementById('statMax').innerHTML = `--`;
      document.getElementById('statMin').innerHTML = `--`;
    }

    drawChart(); //

  } catch (error) {
    console.error("Error fetching stats:", error);
  }
}

// Call this once when the page loads
fetchStats();
// And call it whenever the user switches between Temp/Humid
function setMetric(m, el) {
  metric = m;
  document.querySelectorAll('.metric-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  fetchStats(); // Fresh fetch for the new metric
}

function setPeriod(p, el) {
  period = p;
  // Update UI active state
  document.querySelectorAll('.period-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  
  // Fetch fresh stats from Google Sheets for the new period
  fetchStats(); 
}
document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('isLoggedIn'); // Clear login flag
  window.location.href = 'login.html'; // Redirect back to login
});

loadCrops();

