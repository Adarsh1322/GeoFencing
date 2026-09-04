# GeoFencing: Geolocation Tracking & Geofence-Based Attendance System

A production-quality React Native application built with **React Native CLI (Pure JavaScript)** for real-time employee attendance verification within an exact **100-meter office geofence**.

---

## 🌟 Key Features

1. **Real-Time GPS Geolocation Tracking**:
   - High-precision continuous location tracking via `react-native-geolocation-service`.
   - GPS telemetry displaying live latitude, longitude, and accuracy in meters.
   - Lifecycle-safe watcher implementation with automatic cleanup on unmount to prevent memory leaks.

2. **Mathematical Geofencing (Haversine Formula)**:
   - Pure spherical geometry implementation calculating accurate aerial distance between user and office coordinates.
   - Strict conditional gate enforcing:
     $$\text{distance} \le 100\text{ m} \implies \text{Punch Allowed}, \quad > 100\text{ m} \implies \text{Punch Blocked}$$

3. **Interactive Google Maps Integration**:
   - Visualized 100m geofence zone using `<Circle>` overlay.
   - Distinct office and user location pins with dynamic color changes (Green inside, Red outside).
   - Floating interactive controls: 🛰️ **Satellite / Standard Toggle** and 🎯 **Quick Recenter** button.

4. **Robust Android 12–15 Runtime Permissions**:
   - Modern `PermissionsAndroid.requestMultiple([ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION])` implementation for Android 12+ compatibility.
   - Intelligent permanent denial handling (`NEVER_ASK_AGAIN`) with a modal providing direct device Settings routing (`Linking.openSettings()`).
   - `AppState` lifecycle listener that automatically detects permission grants when returning from Settings without requiring app restarts.

5. **Two-Tier Native + Animated Bootsplash**:
   - **Tier 1 (Native 0ms)**: Android `SplashTheme` with branded deep slate canvas and centered native logo.
   - **Tier 2 (Animated JS)**: Seamless React Native intro animation with smooth scaling, branding, and fade-out transition.

6. **Offline-First Local Storage**:
   - Local persistence powered by `@react-native-async-storage/async-storage`.
   - Reverse chronological ordering (newest attendance records first).
   - Works 100% offline without external backend dependencies.

7. **Interviewer Live Simulation Controls**:
   - Segmented interactive pills allowing rapid live testing:
     - `📡 Live GPS`: Real hardware coordinates.
     - `🟢 Inside (28m)`: Simulates coordinate inside 100m zone (enables punch-in).
     - `🔴 Outside (245m)`: Simulates coordinate outside 100m zone (demonstrates gating).

---

## 🏗️ Project Architecture

```text
src/
├── constants/
│   ├── geofence.js              # Office coordinates & 100m radius constant
│   └── colors.js                # Centralized design tokens
├── utils/
│   ├── distance.js              # Mathematical Haversine formula
│   └── dateFormatter.js         # Timestamp and date formatters
├── storage/
│   └── attendanceStorage.js     # AsyncStorage CRUD operations
├── components/
│   ├── GeofenceBadge.js         # Live status pill with pulsating radar dot
│   ├── StatusCard.js            # Telemetry, distance cards & instructions
│   ├── AttendanceItem.js        # History card with verified badge
│   └── SplashScreen.js          # Animated enterprise Bootsplash
├── screens/
│   ├── AttendanceScreen.js      # Main tracking, MapView & punch actions
│   └── HistoryScreen.js         # History logs, statistics & pull-to-refresh
├── navigation/
│   └── AppNavigator.js          # Stack navigation
└── styles/                      # Separated modular StyleSheets
```

---

## 🚀 Getting Started

### 1. Prerequisites
- Node.js >= 18
- Android SDK & Java JDK 17
- Android device or emulator with Google Play Services

### 2. Installation
```bash
git clone https://github.com/Adarsh1322/GeoFencing.git
cd GeoFencing
npm install
```

### 3. Running the App
```bash
# Start Metro bundler
npm start

# Run on connected Android device / emulator
npm run android
```

### 4. Running Automated Tests & Linting
```bash
# Run Jest Unit Tests
npm test

# Run ESLint validation
npm run lint
```

### 5. Building Release APK
```bash
cd android
./gradlew assembleRelease
# Output located at: android/app/build/outputs/apk/release/app-release.apk
```

---

## 📋 Technology Stack
- **Framework**: React Native CLI 0.87.1 (New Architecture / Fabric Enabled)
- **Language**: JavaScript (ES6+)
- **Navigation**: `@react-navigation/native` & `@react-navigation/native-stack`
- **Maps**: `react-native-maps` (Google Maps SDK for Android)
- **Location**: `react-native-geolocation-service`
- **Storage**: `@react-native-async-storage/async-storage`
- **Testing**: Jest (`__tests__/distance.test.js`, `__tests__/attendanceStorage.test.js`)
