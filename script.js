// ─── FIREBASE CONFIGURATION ───────────────────────────────────────
const firebaseConfig = {
  databaseURL: "https://cropvault-3095c-default-rtdb.asia-southeast1.firebasedatabase.app"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// ─── STATE & LIVE DATA ───────────────────────────────────────────
let currentTemp = 0;
let currentHumid = 0;
let currentAir = 0; 
let crops = []; 

let historicalData = {
  weekly: { temp: new Array(7).fill(0), humid: new Array(7).fill(0), air: new Array(7).fill(0) }, 
  monthly: { temp: new Array(31).fill(0), humid: new Array(31).fill(0), air: new Array(31).fill(0) },
  yearly: { temp: new Array(12).fill(0), humid: new Array(12).fill(0), air: new Array(12).fill(0) }
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
    currentTemp = data.temperature || 0;
    currentHumid = data.humidity || 0;
    currentAir = data.airQuality || 0; 
    
    updateLiveReadings();
    
    const currentCropName = document.getElementById('cropName').textContent;
    if (currentCropName !== "—") {
      const crop = crops.find(c => c.name === currentCropName);
      if (crop) showCrop(crop, false); 
    }
  }
});

// ─── SYNC THRESHOLDS & SILENCE TO FIREBASE ────────────────────────
function syncThresholdsToFirebase() {
  const tMin = parseFloat(document.getElementById('tempMinThreshold').value) || 10;
  const tMax = parseFloat(document.getElementById('tempThreshold').value) || 30;
  const hMin = parseFloat(document.getElementById('humidMinThreshold').value) || 50;
  const hMax = parseFloat(document.getElementById('humidThreshold').value) || 70;
  const aMax = parseInt(document.getElementById('airThreshold').value) || 1000; 

  localStorage.setItem('tempMinThreshold', tMin);
  localStorage.setItem('tempThreshold', tMax);
  localStorage.setItem('humidMinThreshold', hMin);
  localStorage.setItem('humidThreshold', hMax);
  localStorage.setItem('airThreshold', aMax); 
  
  db.ref('thresholds/tempMin').set(tMin);
  db.ref('thresholds/tempMax').set(tMax);
  db.ref('thresholds/humidMin').set(hMin);
  db.ref('thresholds/humidMax').set(hMax);
  db.ref('thresholds/airMax').set(aMax); 
}

function silenceBuzzer() {
  const btn = document.getElementById('silenceBtn');
  const currentlySilenced = btn.classList.contains('active');
  const newState = !currentlySilenced;
  
  if (newState) {
    btn.classList.add('active');
    btn.textContent = "Alarm Muted";
  } else {
    btn.classList.remove('active');
    btn.textContent = "Mute Alarm";
  }
  
  db.ref('thresholds/silence').set(newState);
}

// ─── LIVE READINGS UI UPDATE ─────────────────────────────────────
function updateLiveReadings() {
  const tMin = parseFloat(document.getElementById('tempMinThreshold').value) || 10;
  const tMax = parseFloat(document.getElementById('tempThreshold').value) || 30;
  const hMin = parseFloat(document.getElementById('humidMinThreshold').value) || 50;
  const hMax = parseFloat(document.getElementById('humidThreshold').value) || 70;
  const aMax = parseInt(document.getElementById('airThreshold').value) || 1000;

  document.getElementById('tempValue').innerHTML = `${currentTemp.toFixed(1)}<span class="reading-unit">°C</span>`;
  document.getElementById('humidValue').innerHTML = `${currentHumid.toFixed(1)}<span class="reading-unit">%</span>`;
  document.getElementById('airValue').innerHTML = `${currentAir}<span class="reading-unit"> Level</span>`; 

  const tHigh = currentTemp > tMax;
  const tLow = currentTemp < tMin;
  const hHigh = currentHumid > hMax;
  const hLow = currentHumid < hMin;
  const aOver = currentAir > aMax;

  document.getElementById('tempStatus').textContent = tHigh ? '● Too High' : (tLow ? '● Too Low' : '● Normal');
  document.getElementById('humidStatus').textContent = hHigh ? '● Too High' : (hLow ? '● Too Low' : '● Normal');
  document.getElementById('airStatus').textContent = aOver ? '● Exceeded' : '● Normal'; 
  
  const isAnyAlert = tHigh || tLow || hHigh || hLow || aOver; 
  
  document.getElementById('tempCard').className = 'reading-card' + ((tHigh || tLow) ? ' danger' : '');
  document.getElementById('humidCard').className = 'reading-card' + ((hHigh || hLow) ? ' warn' : '');
  document.getElementById('airCard').className = 'reading-card' + (aOver ? ' danger' : ''); 

  const banner = document.getElementById('alertBanner');
  const sBtn = document.getElementById('silenceBtn');

  if (isAnyAlert) {
    document.getElementById('alertText').textContent = `Alert: Warehouse parameters out of safe range!`;
    banner.style.display = 'flex';
    banner.className = 'alert-banner ' + ((tHigh || tLow || aOver) ? 'danger' : 'warning'); 
  } else {
    banner.style.display = 'none';
    
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
      labels: [], 
      datasets: [{
        label: 'Live Reading',
        data: [], 
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

function drawChart() {
  if (!myChart) {
    initChart();
  }

  let labels = [];
  if (period === 'weekly') {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    labels = [];
    for (let i = 6; i >= 0; i--) {
      let d = new Date();
      d.setDate(d.getDate() - i);
      labels.push(days[d.getDay()]); 
    }
  } else if (period === 'monthly') {
    labels = Array.from({length: 31}, (_, i) => i + 1);
  } else if (period === 'yearly') {
    labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  }

  myChart.data.labels = labels;
  myChart.data.datasets[0].data = historicalData[period][metric];
  
  myChart.data.datasets[0].label = metric === 'temp' ? 'Temperature (°C)' : metric === 'humid' ? 'Humidity (%)' : 'Air Quality / Gas Level';
  myChart.data.datasets[0].borderColor = metric === 'temp' ? '#f85149' : metric === 'humid' ? '#58a6ff' : '#d29922';
  myChart.data.datasets[0].backgroundColor = metric === 'temp' ? 'rgba(248, 81, 73, 0.1)' : metric === 'humid' ? 'rgba(88, 166, 255, 0.1)' : 'rgba(210, 153, 34, 0.1)';

  myChart.update();
}

// ─── CROP UI LOGIC ───────────────────────────────────────────────
function initCropUI() {
  const qc = document.getElementById('quickCrops');
  const savedTempMin = localStorage.getItem('tempMinThreshold');
  const savedTempMax = localStorage.getItem('tempThreshold');
  const savedHumidMin = localStorage.getItem('humidMinThreshold');
  const savedHumidMax = localStorage.getItem('humidThreshold');
  const savedAir = localStorage.getItem('airThreshold'); 

  if (savedTempMin) document.getElementById('tempMinThreshold').value = savedTempMin;
  if (savedTempMax) document.getElementById('tempThreshold').value = savedTempMax;
  if (savedHumidMin) document.getElementById('humidMinThreshold').value = savedHumidMin;
  if (savedHumidMax) document.getElementById('humidThreshold').value = savedHumidMax;
  if (savedAir) document.getElementById('airThreshold').value = savedAir; 

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

  document.getElementById('tempMinThreshold').addEventListener('change', syncThresholdsToFirebase);
  document.getElementById('tempThreshold').addEventListener('change', syncThresholdsToFirebase);
  document.getElementById('humidMinThreshold').addEventListener('change', syncThresholdsToFirebase);
  document.getElementById('humidThreshold').addEventListener('change', syncThresholdsToFirebase);
  document.getElementById('airThreshold').addEventListener('change', syncThresholdsToFirebase); 
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
  
  document.getElementById('cropTemp').textContent = `${crop.tempMax}°C`;
  document.getElementById('cropTempRange').textContent = `${crop.tempMin}°C - ${crop.tempMax}°C`;
  
  document.getElementById('cropHumid').textContent = `${crop.humidMax}%`;
  document.getElementById('cropHumidRange').textContent = `${crop.humidMin}% - ${crop.humidMax}%`;
  
  document.getElementById('cropAir').textContent = crop.airMax ? `${crop.airMax} Level` : '—';
  
  document.getElementById('cropNotes').innerHTML = `<strong>📋 Storage Notes:</strong> ${crop.notes}`;

  if (updateThresholds) {
    document.getElementById('tempMinThreshold').value = crop.tempMin;
    document.getElementById('tempThreshold').value = crop.tempMax;
    document.getElementById('humidMinThreshold').value = crop.humidMin;
    document.getElementById('humidThreshold').value = crop.humidMax;
    if (crop.airMax) {
      document.getElementById('airThreshold').value = crop.airMax; 
    }
    syncThresholdsToFirebase();
  }

  const tOk = currentTemp >= crop.tempMin && currentTemp <= crop.tempMax;
  const hOk = currentHumid >= crop.humidMin && currentHumid <= crop.humidMax;
  const aOk = currentAir <= (crop.airMax || 4095); 

  document.getElementById('tempCompareBadge').innerHTML = `<div class="compare-badge ${tOk?'ok':'bad'}">${tOk?'✓ Suitable':'✗ Out of Range'}</div>`;
  document.getElementById('humidCompareBadge').innerHTML = `<div class="compare-badge ${hOk?'ok':'bad'}">${hOk?'✓ Suitable':'✗ Out of Range'}</div>`;
  document.getElementById('airCompareBadge').innerHTML = `<div class="compare-badge ${aOk?'ok':'bad'}">${aOk?'✓ Safe for this crop':'● DANGEROUS LEVEL'}</div>`; 
}

// ─── CONTROLS ─────────────────────────────────────────────────────
const googleSheetsUrl = "https://script.google.com/macros/s/AKfycbwFFom4uUb-vFJlWxtzb8u22f2I3xCwQxG1JwaeiBdqLHUoB0_YbkriJdi53HxBHqHT6A/exec"; 

async function fetchStats() {
  try {
    const response = await fetch(googleSheetsUrl);
    const data = await response.json();
    const currentMetric = metric; 

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    console.log(JSON.stringify(data.daily.slice(-3)));
    if (period === 'weekly') {
      const weeklyArr = new Array(7).fill(0);
      for (let i = 0; i < 7; i++) {
        let d = new Date();
        d.setDate(now.getDate() - (6 - i)); 
        
        let dateKey = d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
        let dayData = data.daily.find(item => item.date === dateKey);
        
        if (dayData && dayData[currentMetric] !== undefined) {
          weeklyArr[i] = parseFloat(dayData[currentMetric]);
        }
      }
      historicalData.weekly[currentMetric] = weeklyArr;

    } else if (period === 'monthly') {
      const monthlyArr = new Array(31).fill(0);
      
      data.daily.forEach(dayData => {
        const dateParts = dayData.date.split('-'); 
        const year = parseInt(dateParts[0]);
        const month = parseInt(dateParts[1]) - 1; 
        const day = parseInt(dateParts[2]);

        if (month === currentMonth && year === currentYear && dayData[currentMetric] !== undefined) {
          monthlyArr[day - 1] = parseFloat(dayData[currentMetric]);
        }
      });
      historicalData.monthly[currentMetric] = monthlyArr;

    } else if (period === 'yearly') {
      const yearlyArr = new Array(12).fill(0);
      
      data.monthly.forEach(monthData => {
        const parts = monthData.date.split('-');
        const year = parseInt(parts[0]);
        const monthIndex = parseInt(parts[1]) - 1; 

        if (year === currentYear && monthData[currentMetric] !== undefined) {
          yearlyArr[monthIndex] = parseFloat(monthData[currentMetric]);
        }
      });
      historicalData.yearly[currentMetric] = yearlyArr;
    }

    const currentData = historicalData[period][metric].filter(val => val > 0);

    if (currentData.length > 0) {
      const maxVal = Math.max(...currentData).toFixed(metric === 'air' ? 0 : 1);
      const minVal = Math.min(...currentData).toFixed(metric === 'air' ? 0 : 1);
      const avgVal = (currentData.reduce((a, b) => a + b, 0) / currentData.length).toFixed(metric === 'air' ? 0 : 1);

      const unit = (metric === 'temp' ? '°C' : metric === 'humid' ? '%' : ' Level');

      document.getElementById('statAvg').innerHTML = `${avgVal}<span class="stat-box-unit">${unit}</span>`;
      document.getElementById('statMax').innerHTML = `${maxVal}<span class="stat-box-unit">${unit}</span>`;
      document.getElementById('statMin').innerHTML = `${minVal}<span class="stat-box-unit">${unit}</span>`;
    } else {
      document.getElementById('statAvg').innerHTML = `--`;
      document.getElementById('statMax').innerHTML = `--`;
      document.getElementById('statMin').innerHTML = `--`;
    }

    drawChart(); 

  } catch (error) {
    console.error("Error fetching stats:", error);
  }
}

fetchStats();

// ─── ESP32 OFFLINE DETECTION ─────────────────────────────────────
setInterval(() => {
  db.ref('warehouse/lastSeen').once('value', (snap) => {
    const lastSeen = snap.val();
    if (!lastSeen) return;
    const ageSeconds = Math.floor(Date.now() / 1000) - lastSeen;
    const banner = document.getElementById('alertBanner');
    if (ageSeconds > 30) {
      document.getElementById('alertText').textContent = 
        ` ESP32 offline! Last data received ${Math.floor(ageSeconds / 60)} min ago.`;
      banner.style.display = 'flex';
      banner.className = 'alert-banner danger';
    }
  });
}, 15000); // checks every 15 seconds

function setMetric(m, el) {
  metric = m;
  document.querySelectorAll('.metric-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  fetchStats(); 
}

function setPeriod(p, el) {
  period = p;
  document.querySelectorAll('.period-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  fetchStats(); 
}

document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('isLoggedIn'); 
  window.location.href = 'login.html'; 
});

loadCrops();
