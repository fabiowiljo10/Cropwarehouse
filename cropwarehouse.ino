#include <WiFi.h>
#include <FirebaseESP32.h>
#include "DHT.h"
#include <HTTPClient.h>
#include <time.h>

// 1. WiFi & Firebase Credentials
#define WIFI_SSID "fabio" 
#define WIFI_PASSWORD "fabiowiljo1042006"
#define FIREBASE_HOST "cropvault-3095c-default-rtdb.asia-southeast1.firebasedatabase.app" 
#define FIREBASE_AUTH "cmS8cnuXqqDIGJtGRIVVLCHYSpRzceY2zcTbnzww"

// --- 🤖 TELEGRAM BOT CREDENTIALS ---
#define TELEGRAM_BOT_TOKEN "8795426574:AAEyjR93rzLu-UT_slSy8sRVGuznydathZ8"
#define TELEGRAM_CHAT_ID "7308374502"

// 2. Pin Definitions
#define DHTPIN 15
#define DHTTYPE DHT11
#define BUZZER_PIN 23
#define HUMID_LED_PIN 22
#define TEMP_LED_PIN 4
#define AIR_LED_PIN 2
#define MQ_PIN 34

DHT dht(DHTPIN, DHTTYPE);

FirebaseData firebaseData;
FirebaseConfig config;
FirebaseAuth auth;

// Global State Variables
float tempMin      = 10.0;
float tempMax      = 30.0;
float humidMin     = 50.0;
float humidMax     = 70.0;
int   airThreshold = 1000;
bool  isSilenced   = false;

// State Tracking to catch NEW alerts
bool lastTempAlert  = false;
bool lastHumidAlert = false;
bool lastAirAlert   = false;

unsigned long lastLogTime = 0;
const unsigned long logInterval = 900000;

const char* googleScriptUrl = "https://script.google.com/macros/s/AKfycbwFFom4uUb-vFJlWxtzb8u22f2I3xCwQxG1JwaeiBdqLHUoB0_YbkriJdi53HxBHqHT6A/exec";

// --- TELEGRAM SEND FUNCTION ---
void sendTelegramMessage(String message) {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    message.replace(" ", "%20");
    message.replace("\n", "%0A");

    String url = "https://api.telegram.org/bot" + String(TELEGRAM_BOT_TOKEN) +
                 "/sendMessage?chat_id=" + String(TELEGRAM_CHAT_ID) +
                 "&text=" + message;
    
    http.begin(url);
    int httpResponseCode = http.GET();
    
    if (httpResponseCode > 0) {
      Serial.printf("Telegram Sent! Code: %d\n", httpResponseCode);
    } else {
      Serial.printf("Telegram Error: %s\n", http.errorToString(httpResponseCode).c_str());
    }
    http.end();
  }
}

void logToGoogleSheets(float t, float h, int air) {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    http.begin(googleScriptUrl);
    http.addHeader("Content-Type", "application/json");

    String json = "{\"temp\":" + String(t) +
                  ",\"humid\":" + String(h) +
                  ",\"air\":" + String(air) + "}";

    int httpResponseCode = http.POST(json);
    Serial.printf("Google Sheets Log Code: %d\n", httpResponseCode);
    http.end();
  }
}

void setup() {
  Serial.begin(115200);

  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(HUMID_LED_PIN, OUTPUT);
  pinMode(TEMP_LED_PIN, OUTPUT);
  pinMode(AIR_LED_PIN, OUTPUT);

  digitalWrite(BUZZER_PIN, LOW);
  digitalWrite(HUMID_LED_PIN, LOW);
  digitalWrite(TEMP_LED_PIN, LOW);
  digitalWrite(AIR_LED_PIN, LOW);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    Serial.print(".");
    delay(300);
  }
  Serial.println("\nConnected!");

  // Sync time via NTP and wait until it's ready
  configTime(0, 0, "pool.ntp.org");
  struct tm timeinfo;
  while (!getLocalTime(&timeinfo)) {
    Serial.println("Waiting for NTP...");
    delay(500);
  }
  Serial.println("NTP Synced!");

  sendTelegramMessage("✅ CropVault System Online! Monitoring started.");

  config.host = FIREBASE_HOST;
  config.signer.tokens.legacy_token = FIREBASE_AUTH;
  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);
  
  dht.begin();
  Serial.println("System Initialized.");
}

void loop() {
  // --- 1. FETCH USER SETTINGS FROM FIREBASE ---
  if (Firebase.getFloat(firebaseData, "/thresholds/tempMin")) {
    tempMin = firebaseData.floatData();
  }
  if (Firebase.getFloat(firebaseData, "/thresholds/tempMax")) {
    tempMax = firebaseData.floatData();
  }
  if (Firebase.getFloat(firebaseData, "/thresholds/humidMin")) {
    humidMin = firebaseData.floatData();
  }
  if (Firebase.getFloat(firebaseData, "/thresholds/humidMax")) {
    humidMax = firebaseData.floatData();
  }
  if (Firebase.getInt(firebaseData, "/thresholds/airMax")) {
    airThreshold = firebaseData.intData();
  }
  if (Firebase.getBool(firebaseData, "/thresholds/silence")) {
    isSilenced = firebaseData.boolData();
  }

  // --- 2. READ SENSOR DATA ---
  float h   = dht.readHumidity();
  float t   = dht.readTemperature();
  int   air = analogRead(MQ_PIN);

  // --- 3. LOGIC & HARDWARE CONTROL ---
  if (!isnan(h) && !isnan(t)) {
    bool currentTempAlert  = (t < tempMin  || t > tempMax);
    bool currentHumidAlert = (h < humidMin || h > humidMax);
    bool currentAirAlert   = (air > airThreshold);

    // --- AUTO-UNMUTE & TELEGRAM LOGIC ---
    if ((currentTempAlert  && !lastTempAlert)  ||
        (currentHumidAlert && !lastHumidAlert) ||
        (currentAirAlert   && !lastAirAlert)) {

      String alertMsg = "🚨 CROPVAULT ALERT! 🚨\n";

      if (currentTempAlert) {
        if (t < tempMin) alertMsg += "Temp is LOW: "  + String(t) + "C (Min: " + String(tempMin) + ")\n";
        else             alertMsg += "Temp is HIGH: " + String(t) + "C (Max: " + String(tempMax) + ")\n";
      }
      if (currentHumidAlert) {
        if (h < humidMin) alertMsg += "Humidity is LOW: "  + String(h) + "% (Min: " + String(humidMin) + ")\n";
        else              alertMsg += "Humidity is HIGH: " + String(h) + "% (Max: " + String(humidMax) + ")\n";
      }
      if (currentAirAlert) {
        alertMsg += "Air Quality BAD: " + String(air) + " (Limit: " + String(airThreshold) + ")";
      }

      sendTelegramMessage(alertMsg);

      if (isSilenced) {
        isSilenced = false;
        Firebase.setBool(firebaseData, "/thresholds/silence", false);
        Serial.println("NEW ALERT DETECTED! Resetting Mute status.");
      }
    }

    // Update historical states for next loop iteration
    lastTempAlert  = currentTempAlert;
    lastHumidAlert = currentHumidAlert;
    lastAirAlert   = currentAirAlert;

    // Log to Google Sheets every 15 min
    if (millis() - lastLogTime >= logInterval) {
      logToGoogleSheets(t, h, air);
      lastLogTime = millis();
    }

    // Update Visual LEDs
    digitalWrite(TEMP_LED_PIN,  currentTempAlert  ? HIGH : LOW);
    digitalWrite(HUMID_LED_PIN, currentHumidAlert ? HIGH : LOW);
    digitalWrite(AIR_LED_PIN,   currentAirAlert   ? HIGH : LOW);

    // Update Audible Buzzer
    if ((currentTempAlert || currentHumidAlert || currentAirAlert) && !isSilenced) {
      digitalWrite(BUZZER_PIN, HIGH);
      Serial.println("ALARM SOUNDING!");
    } else {
      digitalWrite(BUZZER_PIN, LOW);
    }

    // --- 4. SEND LIVE READINGS TO WEB DASHBOARD ---
    Firebase.setFloat(firebaseData, "/warehouse/temperature", t);
    Firebase.setFloat(firebaseData, "/warehouse/humidity",    h);
    Firebase.setInt(firebaseData,   "/warehouse/airQuality",  air);
    Firebase.setInt(firebaseData,   "/warehouse/lastSeen",    (int)time(nullptr)); // ← NEW

    Serial.printf("T: %.1f (%.1f-%.1f) | H: %.1f (%.1f-%.1f) | Air: %d (Lim: %d) | Mute: %s\n",
                  t, tempMin, tempMax,
                  h, humidMin, humidMax,
                  air, airThreshold,
                  isSilenced ? "ON" : "OFF");
  } else {
    Serial.println("Failed to read from DHT sensor!");
  }

  delay(10000);
}
