function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Logs");
  var data = JSON.parse(e.postData.contents);
  
  // NEW: Added data.air so it writes to the 4th column (Column D)
  sheet.appendRow([new Date(), data.temp, data.humid, data.air]);
  
  return ContentService.createTextOutput("Success");
}

function doGet() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Logs");
  var rows = sheet.getDataRange().getValues();
  rows.shift(); // Remove headers

  if (rows.length === 0) return ContentService.createTextOutput(JSON.stringify({error: "No data"})).setMimeType(ContentService.MimeType.JSON);

  // Added Number() wrapper to ensure older blank rows don't break the math
  const getAvg = (arr) => arr.length ? (arr.reduce((a, b) => Number(a) + Number(b), 0) / arr.length).toFixed(1) : 0;

  var now = new Date();
  var currentYear = now.getFullYear();
  
  // Look back exactly 30 days to support Weekly boundary crossing
  var thirtyDaysAgo = new Date();
  thirtyDaysAgo = new Date(now.getFullYear(), now.getMonth(), 1);

  var dailyMap = {};
  var monthlyMap = {};

  rows.forEach(row => {
    var d = new Date(row[0]);
    var temp = row[1];
    var humid = row[2];
    
    // NEW: Read the 4th column for Air Quality. If it's an old row and empty, default to 0.
    var air = row[3] ? Number(row[3]) : 0; 

    // A. DAILY/WEEKLY/MONTHLY: Allow data from the last 30 days
    if (d >= thirtyDaysAgo) {
      var dayKey = d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
      
      // NEW: Added the 'a' array for air quality
      if (!dailyMap[dayKey]) dailyMap[dayKey] = { t: [], h: [], a: [] }; 
      
      dailyMap[dayKey].t.push(temp);
      dailyMap[dayKey].h.push(humid);
      dailyMap[dayKey].a.push(air); // NEW
    }

    // B. YEARLY: Current Year Only
    if (d.getFullYear() === currentYear) {
      var monthKey = d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2);
      
      // NEW: Added the 'a' array for air quality
      if (!monthlyMap[monthKey]) monthlyMap[monthKey] = { t: [], h: [], a: [] };
      
      monthlyMap[monthKey].t.push(temp);
      monthlyMap[monthKey].h.push(humid);
      monthlyMap[monthKey].a.push(air); // NEW
    }
  });

  var dailyAverages = Object.keys(dailyMap).sort().map(k => ({
    date: k,
    temp: getAvg(dailyMap[k].t),
    humid: getAvg(dailyMap[k].h),
    air: getAvg(dailyMap[k].a) // NEW: Calculate Daily Air Avg
  }));

  var monthlyAverages = Object.keys(monthlyMap).sort().map(k => ({
    date: k,
    temp: getAvg(monthlyMap[k].t),
    humid: getAvg(monthlyMap[k].h),
    air: getAvg(monthlyMap[k].a) // NEW: Calculate Monthly Air Avg
  }));

  // Summary stats based on the last 30 days of activity
  var recentRows = rows.filter(r => new Date(r[0]) >= thirtyDaysAgo);
  var allT = recentRows.map(r => Number(r[1]) || 0);
  var allH = recentRows.map(r => Number(r[2]) || 0);
  var allA = recentRows.map(r => Number(r[3]) || 0); // NEW

  return ContentService.createTextOutput(JSON.stringify({
    temp: { avg: getAvg(allT), max: Math.max(...allT).toFixed(1), min: Math.min(...allT).toFixed(1) },
    humid: { avg: getAvg(allH), max: Math.max(...allH).toFixed(1), min: Math.min(...allH).toFixed(1) },
    air: { avg: getAvg(allA), max: Math.max(...allA).toFixed(0), min: Math.min(...allA).toFixed(0) }, // NEW
    daily: dailyAverages, 
    monthly: monthlyAverages
  })).setMimeType(ContentService.MimeType.JSON);
}
