#include <WiFi.h>
#include <FirebaseESP32.h>
#include "DHT.h"
#include <HTTPClient.h>

// 1. WiFi & Firebase Credentials
#define WIFI_SSID "fabio" 
#define WIFI_PASSWORD "fabiowiljo1042006"
#define FIREBASE_HOST "cropvault-3095c-default-rtdb.asia-southeast1.firebasedatabase.app" 
#define FIREBASE_AUTH "cmS8cnuXqqDIGJtGRIVVLCHYSpRzceY2zcTbnzww"

// 2. Pin Definitions
#define DHTPIN 15
#define DHTTYPE DHT11
#define BUZZER_PIN 23    // Connected to Buzzer
#define HUMID_LED_PIN 22 // Connected to Humidity LED
#define TEMP_LED_PIN 4   // Connected to Temperature LED

DHT dht(DHTPIN, DHTTYPE);
FirebaseData firebaseData;
FirebaseConfig config;
FirebaseAuth auth;

// Global State Variables
float tempThreshold = 30.0;
float humidThreshold = 70.0;
bool isSilenced = false;

// State Tracking to catch NEW alerts
bool lastTempAlert = false;
bool lastHumidAlert = false;

unsigned long lastLogTime = 0;
const unsigned long logInterval = 900000;

const char* googleScriptUrl = "https://script.google.com/macros/s/AKfycbwtSlgAaLfV_9a7xQd08zp3t_N6jrdyEtCzqacl63xBXO5xcFsQdNLm8s2Z9PbkWbEL-Q/exec";

void logToGoogleSheets(float t, float h) {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    http.begin(googleScriptUrl);
    http.addHeader("Content-Type", "application/json");

    String json = "{\"temp\":" + String(t) + ",\"humid\":" + String(h) + "}";
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
  
  digitalWrite(BUZZER_PIN, LOW);
  digitalWrite(HUMID_LED_PIN, LOW);
  digitalWrite(TEMP_LED_PIN, LOW);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    Serial.print(".");
    delay(300);
  }
  Serial.println("\nConnected!");

  config.host = FIREBASE_HOST;
  config.signer.tokens.legacy_token = FIREBASE_AUTH;
  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);
  
  dht.begin();
  Serial.println("System Initialized.");
}

void loop() {
  // --- 1. FETCH USER SETTINGS FROM FIREBASE ---
  if (Firebase.getFloat(firebaseData, "/thresholds/tempMax")) {
    tempThreshold = firebaseData.floatData();
  }
  
  if (Firebase.getFloat(firebaseData, "/thresholds/humidMax")) {
    humidThreshold = firebaseData.floatData();
  }
  
  if (Firebase.getBool(firebaseData, "/thresholds/silence")) {
    isSilenced = firebaseData.boolData();
  }

  // --- 2. READ SENSOR DATA ---
  float h = dht.readHumidity();
  float t = dht.readTemperature();

  // --- 3. LOGIC & HARDWARE CONTROL ---
  if (!isnan(h) && !isnan(t)) {
    bool currentTempAlert = (t > tempThreshold);
    bool currentHumidAlert = (h > humidThreshold);

    // --- AUTO-UNMUTE LOGIC ---
    // If a sensor WAS normal but is NOW exceeding the threshold, reset silence.
    if ((currentTempAlert && !lastTempAlert) || (currentHumidAlert && !lastHumidAlert)) {
      if (isSilenced) {
        isSilenced = false;
        Firebase.setBool(firebaseData, "/thresholds/silence", false);
        Serial.println("NEW ALERT DETECTED! Resetting Mute status.");
      }
    }

    // Update historical states for next loop iteration
    lastTempAlert = currentTempAlert;
    lastHumidAlert = currentHumidAlert;

    // Log to Google Sheets
    if (millis() - lastLogTime >= logInterval) {
      logToGoogleSheets(t, h);
      lastLogTime = millis();
    }

    // Update Visual LEDs (Always show warning regardless of mute)
    digitalWrite(TEMP_LED_PIN, currentTempAlert ? HIGH : LOW);
    digitalWrite(HUMID_LED_PIN, currentHumidAlert ? HIGH : LOW);

    // Update Audible Buzzer
    if ((currentTempAlert || currentHumidAlert) && !isSilenced) {
      digitalWrite(BUZZER_PIN, HIGH);
      Serial.println("ALARM SOUNDING!");
    } else {
      digitalWrite(BUZZER_PIN, LOW);
    }

    // --- 4. SEND LIVE READINGS TO WEB DASHBOARD ---
    Firebase.setFloat(firebaseData, "/warehouse/temperature", t);
    Firebase.setFloat(firebaseData, "/warehouse/humidity", h);

    Serial.printf("T: %.1f (Lim: %.1f) | H: %.1f (Lim: %.1f) | Mute: %s\n", 
                  t, tempThreshold, h, humidThreshold, isSilenced ? "ON" : "OFF");
  } else {
    Serial.println("Failed to read from DHT sensor!");
  }

  delay(10000); 
}