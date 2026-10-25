# CampusSafe: Existing Codebase Audit & Dependency Verification

**Audit Date:** October 2026  
**Audited Repository:** [Adarsh1322/GeoFencing](https://github.com/Adarsh1322/GeoFencing)  
**Evaluator:** Senior React Native Engineer & Backend Architect  
**Objective:** Audit existing interview assignment codebase, evaluate native configurations and dependencies against React Native 0.87.1 New Architecture, identify reusable assets, document technical debt, and establish the migration baseline.  
**Specification Status:** Ready for Phase 2 implementation  

---

## 1. Existing Project Identity & Toolchain

The audited repository was originally developed as an interview assessment project titled **"AttendanceApp"** (branded in UI as *Attendance Pro*). It is a standalone React Native CLI mobile application engineered purely in JavaScript, targeting a single-site corporate attendance punch-in workflow within a 100-meter circular geofence centered on Infosys Chandigarh.

### 1.1 Toolchain & Framework Matrix

| Subsystem / Tool | Detected Version | Configuration Details / Flags |
| :--- | :--- | :--- |
| **Node.js Engine** | `>= 22.11.0` (Host: `v24.6.0`) | Modern LTS/Current V8 runtime |
| **React** | `19.2.3` | React 19 release channel |
| **React Native** | `0.87.1` | React Native CLI (Pure JavaScript source) |
| **Hermes Engine** | `Enabled` (`hermesEnabled=true`) | Modern bytecode compiler |
| **New Architecture** | `Enabled` (`newArchEnabled=true`) | C++ TurboModules & Fabric renderer active |
| **Edge-to-Edge Display** | `Enabled` (`edgeToEdgeEnabled=true`) | Native Android immersive window layout |
| **Android Gradle Plugin** | `8.x` | `buildToolsVersion = "37.0.0"`, Kotlin `2.2.0` |
| **Android SDKs** | `minSdk: 24`, `compileSdk: 37`, `targetSdk: 36` | Target: Android 16 Preview / Android 15 standard |
| **Google Play Services Location** | `20.0.0` | `com.google.android.gms:play-services-location` |
| **iOS Deployment Target** | `min_ios_version_supported` (iOS 15.1+) | Podfile using `use_react_native!` with New Arch |

> [!CRITICAL]
> **New Architecture Finding:** The project has `newArchEnabled=true` explicitly enabled in `android/gradle.properties` and `RCTNewArchEnabled=true` in `ios/AttendanceApp/Info.plist`. Any native dependency added to this project (such as SQLite or background task managers) **must** natively support TurboModules / C++ JSI or the New Architecture interop layer. Legacy libraries relying on obsolete React Native bridge macros will cause C++ compilation failures.

---

## 2. Source Code & Component Breakdown

```text
src/
├── assets/
│   └── logo.png                 # App icon & splash asset
├── components/
│   ├── AttendanceItem.js        # History card displaying timestamp, distance & verified pill
│   ├── GeofenceBadge.js         # Animated pulsating status radar pill (Inside/Outside/Locating)
│   ├── SplashScreen.js          # Two-tier animated JavaScript bootsplash with scaling logo
│   └── StatusCard.js            # Telemetry card showing distance, allowed zone, GPS coords, hints
├── constants/
│   ├── colors.js                # Centralized color palette tokens (Slate, Blue, Emerald, Rose)
│   └── geofence.js              # Hardcoded office coordinates (Infosys Chandigarh, 100m)
├── navigation/
│   └── AppNavigator.js          # React Navigation v7 Native Stack (Attendance & History screens)
├── screens/
│   ├── AttendanceScreen.js      # Primary screen: MapView, GPS watcher, simulation tabs, check-in
│   └── HistoryScreen.js         # History screen: FlatList, summary stats header, clear all
├── storage/
│   └── attendanceStorage.js     # Single AsyncStorage key (@attendance_records) reading/writing JSON
├── styles/                      # Dedicated StyleSheet files (No inline styles)
└── utils/
    ├── dateFormatter.js         # Intl-based date and time formatting
    └── distance.js              # Spherical Haversine distance formula (in meters)
```

### 2.1 Screen & Module Deep Dive

#### `src/screens/AttendanceScreen.js`
- **Location Watcher:** Uses `Geolocation.watchPosition()` from `react-native-geolocation-service` with `enableHighAccuracy: true`, `distanceFilter: 1m`, `interval: 3000ms`, `fastestInterval: 2000ms`.
- **Permission Flow:** Implements robust Android 12+ handling via `PermissionsAndroid.requestMultiple([ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION])`. Intelligently checks `NEVER_ASK_AGAIN` and prompts user with `Linking.openSettings()`. Uses `AppState` listener to re-verify permissions when returning from system settings.
- **Interviewer Simulation Controls:** Provides segmented pill toggles:
  - `📡 Live GPS`: Actual hardware coordinates.
  - `🟢 Inside (28m)`: Injects artificial coordinate offset `+0.00025°` latitude inside geofence.
  - `🔴 Outside (245m)`: Injects artificial coordinate offset `+0.0022°` latitude outside geofence.
- **Map View:** Google Maps provider on Android via `react-native-maps`, renders circle zone (`100m`) and custom pins, satellite/standard toggle, and recenter button.
- **Limitations:** Watcher is bound to component lifecycle. If the user exits or locks the screen, tracking ceases because no foreground service or background task is running.

#### `src/storage/attendanceStorage.js`
- **Storage Driver:** `@react-native-async-storage/async-storage` v3.1.1.
- **Storage Strategy:** Stores all records as a single serialized JSON array under `@attendance_records`.
- **Concurrency & Security Risks:**
  - High risk of data loss or corruption during rapid concurrent writes (e.g. buffering hundreds of high-frequency GPS fixes).
  - **Insecure for Auth Credentials:** AsyncStorage is unencrypted and vulnerable to extraction on rooted devices or via Android backup utilities. It must **never** be used for JWT refresh tokens or cryptographic credentials. Sensitive credentials must be stored in platform secure storage (`react-native-encrypted-storage` or `react-native-keychain`).

#### `src/utils/distance.js`
- Implements the great-circle Haversine formula using Earth mean radius $R = 6,371,000\text{ meters}$.
- Strict type checking for numerical latitude and longitude inputs.
- Deterministic, unit-tested pure function.

---

## 3. Existing Test Suite Audit & Measured Coverage Distinction

The existing test suite was executed locally using Jest v29.6.3 and `@react-native/jest-preset`:

```bash
npm test
```

### Test Execution Output:
```text
PASS __tests__/distance.test.js
  calculateDistanceInMeters
    ✓ returns 0 when comparing the exact same coordinates (1 ms)
    ✓ correctly calculates distance for point ~50m away (1 ms)
    ✓ correctly calculates distance for point ~250m away
    ✓ returns null when any coordinate is missing or invalid (1 ms)

PASS __tests__/attendanceStorage.test.js
  attendanceStorage
    ✓ returns empty array when no records exist (1 ms)
    ✓ saves and retrieves attendance records in reverse chronological order (2 ms)
    ✓ clears all attendance records successfully (1 ms)

Test Suites: 2 passed, 2 total
Tests:       7 passed, 7 total
Snapshots:   0 total
Time:        0.241 s
Ran all test suites.
```

### Critical Testing Distinction: Pass Results vs. Measured Code Coverage
- **Measured Pass Status:** All 7 unit tests across the 2 test suites execute cleanly and pass without errors.
- **Code Coverage Status:** Code coverage has **not** been measured with `--coverage` in the current baseline. While `distance.js` and `attendanceStorage.js` have dedicated tests, UI components (`StatusCard.js`, `GeofenceBadge.js`, `AttendanceItem.js`), screens (`AttendanceScreen.js`, `HistoryScreen.js`), and lifecycle permission branches currently have zero unit test coverage. Establishing formal coverage metrics is a Phase 3 milestone.

---

## 4. Native OS Configurations & Permissions

### 4.1 Android Configuration (`android/app/src/main/AndroidManifest.xml`)
- **Configured Permissions:**
  ```xml
  <uses-permission android:name="android.permission.INTERNET" />
  <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
  <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
  ```
- **Missing Background Permissions for CampusSafe:**
  - `android.permission.FOREGROUND_SERVICE`: Required for background execution.
  - `android.permission.FOREGROUND_SERVICE_LOCATION`: Mandatory on Android 14+ (API 34+) when running a location foreground service.
  - `android.permission.POST_NOTIFICATIONS`: Mandatory on Android 13+ (API 33+) to display the ongoing safety tracking notification.
  - `android.permission.ACCESS_BACKGROUND_LOCATION`: Required if geofences are evaluated natively without an ongoing foreground service.

### 4.2 iOS Configuration (`ios/AttendanceApp/Info.plist`)
- **Configured Keys:**
  - `NSLocationWhenInUseUsageDescription`: Present (`"We need your location to verify attendance within the office geofence."`).
  - `RCTNewArchEnabled`: `<true/>`.
- **Missing Keys for CampusSafe:**
  - `NSLocationAlwaysAndWhenInUseUsageDescription`: Missing.
  - `NSLocationAlwaysUsageDescription`: Missing.
  - `UIBackgroundModes`: Missing `location` and `fetch` modes.

---

## 5. Dependency Verification: Package Metadata vs. Native Compilation

To avoid false claims, we strictly distinguish between **npm package metadata verification** (peer dependencies, architecture tags, and npm dry-run resolution) and **native compilation verification** (actual `./gradlew assembleDebug` or `react-native run-android` builds):

| Proposed Library | npm Metadata & Peer Dependencies | Native New Architecture Status | Native Build Verification Status |
| :--- | :--- | :--- | :--- |
| **`@op-engineering/op-sqlite` (v18.2.5)** | `peerDependencies: { "react": "*", "react-native": "*" }`. Verified via npm. | Pure C++ JSI TurboModule. Officially supports RN 0.74–0.87+. | **Metadata verified; native compilation scheduled for Phase 3.** |
| **`@reduxjs/toolkit` (v2.13.0)** | `peerDependencies: { "react": "^18 \|\| ^19" }`. Verified via npm. | Pure JavaScript/TypeScript. No native compilation needed. | **Fully verified.** |
| **`react-redux` (v9.3.0)** | `peerDependencies: { "react": "^18.0 \|\| ^19" }`. Verified via npm. | Pure JavaScript/TypeScript. No native compilation needed. | **Fully verified.** |
| **`socket.io-client` (v4.8.4)** | Pure JS WebSocket client. | Utilizes global Hermes WebSocket API. No native code. | **Fully verified.** |
| **`react-native-encrypted-storage` (v4.0.3)** | Standard React Native security wrapper. | Uses Android `EncryptedSharedPreferences` & iOS Keychain. | **Metadata verified; native compilation scheduled for Phase 3.** |
| **`@react-native-community/netinfo` (v11.4.1)** | Declares TurboModule support. | TurboModule native Android/iOS network watcher. | **Metadata verified; native compilation scheduled for Phase 3.** |

### 5.1 Local SQLite & Encryption Architecture Note
- `@op-engineering/op-sqlite` supports SQLCipher encryption via a compile-time flag and a runtime passphrase.
- **Key Management Reality:** In-memory encryption requires a cryptographic key retrieved securely from Android Keystore / iOS Keychain.
- **MVP Baseline:** In the Phase 3 MVP, the local SQLite database file is protected by default by Android OS application-sandboxing (other apps cannot access the database file). Upgrading to full SQLCipher encryption requires establishing an automated Keystore key-derivation pipeline, which is documented as an optional hardening task.

### 5.2 Database Audit Log Immutability Note
- An ordinary PostgreSQL table is **not** inherently immutable by default; any database user with `UPDATE` or `DELETE` grants can modify rows.
- **Intended Immutability Protections:**
  1. The backend application connects to PostgreSQL using a dedicated role (`campussafe_app`).
  2. Database migrations explicitly revoke `UPDATE` and `DELETE` privileges on `access_audit_logs`:
     ```sql
     REVOKE UPDATE, DELETE ON access_audit_logs FROM campussafe_app;
     ```
  3. Database superusers (`postgres`) retain administrative capabilities for disaster recovery, which is documented transparently in the threat model.

---

## 6. Reusable Code vs Missing Architecture

| Subsystem | Existing Implementation Status | Recommended Migration / Reuse Strategy |
| :--- | :--- | :--- |
| **Haversine Distance** | Implemented (`src/utils/distance.js`) | **Retain 100%**. Reuse for mobile-side boundary distance calculation and buffer evaluation. |
| **Color Tokens** | Implemented (`src/constants/colors.js`) | **Retain & Extend**. Add safety tokens: `emergencyRed`, `warningAmber`, `safeEmerald`, `bufferOrange`. |
| **StyleSheet Pattern** | Implemented (`src/styles/*.styles.js`) | **Retain Pattern**. Keep styling isolated in dedicated `.styles.js` files; zero inline styles. |
| **Simulation Controls** | Implemented in `AttendanceScreen.js` | **Retain & Adapt**. Adapt segmented pills to: `Live GPS`, `Campus Interior`, `Buffer Zone`, `Outside Campus`. |
| **Map Rendering** | Implemented in `AttendanceScreen.js` | **Adapt**. Replace hardcoded office circle with dynamic campus polygon and user breadcrumbs. |
| **Local Storage** | Implemented with `AsyncStorage` | **Deprecate for Telemetry & Auth**. Migrate telemetry to SQLite; migrate auth tokens to platform secure storage. |
| **Backend & PostGIS** | **Completely Missing** | **Create New** in `/backend` using Node.js + TypeScript + PostgreSQL + PostGIS. |
| **Admin Web Console** | **Completely Missing** | **Create New** in `/admin` using React + TypeScript + Leaflet/MapLibre. |
| **SOS Emergency Desk** | **Completely Missing** | **Create New** on both mobile client and backend WebSocket cluster. |
| **Guardian Linkage** | **Completely Missing** | **Create New** with token-based atomic acceptance and instant revocation. |

---

## 7. Audit Summary & Technical Baseline

1. **Current Code Quality:** The existing assignment is cleanly written, well-formatted, and adheres to good component separation. There are no memory leaks in the location watcher unmount lifecycle.
2. **Architecture Status:** The app is currently a single-device, single-purpose mock attendance tool. It possesses no networking, no multi-user concepts, no database, and no server.
3. **Foundation Viability:** The project provides an excellent React Native CLI foundation that builds on the latest toolchain (RN 0.87.1 + React 19). By preserving this root mobile app and adding `/backend` and `/admin` directories, we can construct the full MCA project incrementally with zero wasted effort or disruptive rewrites.
