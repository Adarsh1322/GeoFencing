# CampusSafe: RESTful & Real-Time WebSocket API Contract

**API Version:** `v1`  
**Base REST URL:** `http://localhost:4000/api/v1`  
**WebSocket Protocol:** WSS (Socket.IO v4) at `http://localhost:4000` (Namespaces: `/dashboard`, `/guardian`)  
**Authentication:** HTTP Authorization Header `Bearer <ACCESS_TOKEN>`  
**Specification Status:** Fully Implemented & Verified in Phase 2  

---

## 1. General Principles, Validation & Error Standards

### 1.1 JSON Envelope Standard
Every successful API response adheres to a predictable JSON envelope:
```json
{
  "message": "Operation completed successfully",
  "user": { ... },
  "tokens": { ... }
}
```

### 1.2 Error Envelope Standard
```json
{
  "error": {
    "code": "OUTSIDE_MONITORING_HOURS",
    "message": "OUTSIDE_MONITORING_HOURS: Outside monitoring hours (08:00:00 - 20:00:00 Asia/Kolkata)"
  }
}
```

### 1.3 Authorization Rule Hierarchy
Every endpoint enforces authorization beyond crude role checks:
1. **Student Endpoints:** Caller must be authenticated as `STUDENT`, must own the target resource (`student_id == req.user.id`), and must hold active membership in `student_campus_memberships`.
2. **Guardian Endpoints:** Caller must be authenticated as `GUARDIAN`, must have an active link in `guardian_links` (`status = 'ACTIVE'`), link consent must be active (`consent_status = 'GRANTED'`).
3. **Safety Admin Endpoints:** Caller must be authenticated as `CAMPUS_ADMIN` and must have an active assignment in `admin_campus_assignments` for the specific `campus_id`.

---

## 2. Authentication & Identity Endpoints

### 2.1 User Login
Authenticates any registered user. **The client does NOT supply a role; the server resolves the user's role and privileges directly from the database.**

- **Endpoint:** `POST /api/v1/auth/login`
- **Auth Required:** No
- **Request Body:**
```json
{
  "email": "student@campussafe.edu",
  "password": "Password123!"
}
```
- **Response `200 OK`:**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "4a71b...84f",
  "user": {
    "id": "3c5b782f-b49f-4efa-8d1f-91d7a3902b3d",
    "email": "student@campussafe.edu",
    "fullName": "Aarav Patel",
    "role": "STUDENT",
    "phone": "+919123456780"
  },
  "memberships": [
    {
      "id": "...",
      "campus_id": "...",
      "roll_number": "MCA2026-001",
      "status": "ACTIVE"
    }
  ],
  "assignments": []
}
```

### 2.2 Student Self-Registration
- **Endpoint:** `POST /api/v1/auth/register`
- **Auth Required:** No
- **Request Body:**
```json
{
  "email": "student.adarsh@university.edu",
  "password": "SecurePassword123!",
  "fullName": "Adarsh Pandey",
  "phone": "+919876543210",
  "rollNumber": "MCA2026-042",
  "campusCode": "CSEU"
}
```
- **Response `201 Created`:** Creates student account and default membership in `student_campus_memberships` with `status: "PENDING_APPROVAL"`. Verification requires administrative approval.

### 2.3 Guardian Self-Registration
- **Endpoint:** `POST /api/v1/auth/register/guardian`
- **Auth Required:** No
- **Request Body:**
```json
{
  "email": "parent.pandey@example.com",
  "phone": "+919876543211",
  "password": "GuardianPassword123!",
  "full_name": "M. Pandey"
}
```
- **Response `201 Created`:** Creates guardian account.

### 2.4 Token Refresh (With Family Rotation & Replay Detection)
- **Endpoint:** `POST /api/v1/auth/refresh`
- **Auth Required:** No (Takes refresh token in body)
- **Request Body:**
```json
{
  "refresh_token": "d820f4c2-90f7-4107-a37a-42cfa8a2456b"
}
```
- **Security Logic:** Hashes the incoming token and checks `refresh_tokens`. If the token was already revoked, a token replay attack is detected: the entire `family_id` is immediately invalidated. If valid, a new access token and rotated refresh token are issued.
- **Response `200 OK`:** Returns new `access_token` and rotated `refresh_token`.

### 2.5 Logout Endpoints
- **Endpoint:** `POST /api/v1/auth/logout`
  - Revokes the current refresh token.
- **Endpoint:** `POST /api/v1/auth/logout-all`
  - Revokes all refresh tokens belonging to the user across all devices.

---

## 3. Campus Geofence & Schedule Management

### 3.1 Fetch Campus Boundaries & Timezone
- **Endpoint:** `GET /api/v1/campuses/:id`
- **Auth Required:** Yes (STUDENT enrolled in campus, GUARDIAN linked to enrolled student, or assigned ADMIN)
- **Response `200 OK`:**
```json
{
  "success": true,
  "data": {
    "id": "c1a0e8d4-5392-498c-8f2e-e5a91f532a01",
    "name": "University Main Campus",
    "code": "MAIN_CAMPUS",
    "timezone": "Asia/Kolkata",
    "buffer_meters": 20,
    "boundary_version": 2,
    "center": { "latitude": 30.727448, "longitude": 76.843755 },
    "boundary_geojson": {
      "type": "MultiPolygon",
      "coordinates": [
        [
          [
            [76.841000, 30.725000],
            [76.846500, 30.725000],
            [76.846500, 30.730000],
            [76.841000, 30.730000],
            [76.841000, 30.725000]
          ]
        ]
      ]
    }
  }
}
```

### 3.2 Update Campus Boundaries (Admin Only)
- **Endpoint:** `PUT /api/v1/campuses/:id/boundaries`
- **Auth Required:** Yes (`UNIVERSITY_SAFETY_ADMIN` assigned to campus with `can_manage_boundaries = true`)
- **Request Body:**
```json
{
  "boundary_geojson": { "type": "MultiPolygon", "coordinates": [ ... ] },
  "buffer_meters": 25
}
```
- **Response `200 OK`:** Updates boundary geometry, increments `boundary_version`, and returns updated record.

### 3.3 Update Campus Operating Schedules (Admin Only)
- **Endpoint:** `PUT /api/v1/campuses/:id/schedules`
- **Auth Required:** Yes (`UNIVERSITY_SAFETY_ADMIN` assigned to campus)
- **Request Body:**
```json
{
  "schedules": [
    { "day_of_week": 1, "start_time": "08:30:00", "end_time": "17:30:00", "is_active": true },
    { "day_of_week": 2, "start_time": "08:30:00", "end_time": "17:30:00", "is_active": true }
  ]
}
```

---

## 4. Guardian Linkage & Consent Endpoints

### 4.1 Generate Guardian Invitation Token (Student Only)
- **Endpoint:** `POST /api/v1/guardians/invitations`
- **Auth Required:** Yes (`STUDENT`)
- **Response `201 Created`:**
```json
{
  "success": true,
  "data": {
    "invitation_code": "INV-982401",
    "raw_token": "tok_sec_9f82410a8b92c4e1...",
    "deep_link": "campussafe://guardians/join?token=tok_sec_9f82410a8b92c4e1...",
    "expires_at": "2026-10-23T14:30:00.000Z"
  }
}
```

### 4.2 Accept Guardian Invitation Token (Guardian Only)
Executes an atomic single-use acceptance transaction.
- **Endpoint:** `POST /api/v1/guardians/invitations/accept`
- **Auth Required:** Yes (`GUARDIAN`)
- **Request Body:**
```json
{
  "raw_token": "tok_sec_9f82410a8b92c4e1...",
  "student_roll_number": "MCA2024-042"
}
```
- **Response `200 OK`:** Marks token `ACCEPTED`, records `consumed_at`, and establishes link.

### 4.3 Update Link-Level Guardian Consent (Student Only)
- **Endpoint:** `PATCH /api/v1/guardians/:linkId/consent`
- **Auth Required:** Yes (`STUDENT`, must own link)
- **Request Body:** `{ "consent_granted": false }`
- **Response `200 OK`:** Updates consent; logs to `guardian_consent_events`.

### 4.4 Guardian Ward Location Query
- **Endpoint:** `GET /api/v1/guardians/wards/:wardId/location`
- **Auth Required:** Yes (`GUARDIAN`). Verifies active link, link consent, and active session consent.
- **Response `200 OK`:** Returns current coordinates, freshness status, and buffer status.

### 4.5 Guardian Ward History Query (Paginated)
- **Endpoint:** `GET /api/v1/guardians/wards/:wardId/history?sessionId=...&limit=100&offset=0`
- **Auth Required:** Yes (`GUARDIAN`). Verifies authorization for the requested session.
- **Response `200 OK`:** Returns breadcrumbs list and pagination metadata.

---

## 5. Safety Session Lifecycle Endpoints

### 5.1 Start Safety Session (Student Only, Online Validation)
- **Endpoint:** `POST /api/v1/sessions/start`
- **Auth Required:** Yes (`STUDENT`)
- **Request Body:**
```json
{
  "campus_id": "c1a0e8d4-5392-498c-8f2e-e5a91f532a01",
  "device_id": "android_hardware_id_847192",
  "consent_university": true,
  "consent_guardians": true
}
```
- **Response `201 Created`:**
```json
{
  "success": true,
  "data": {
    "session_id": "90d1f7e4-c5b8-4792-801b-9f931d87f421",
    "student_id": "e2d53bf6-2917-43f1-b92c-554f67605e59",
    "campus_id": "c1a0e8d4-5392-498c-8f2e-e5a91f532a01",
    "boundary_version": 2,
    "status": "ACTIVE",
    "started_at": "2026-10-22T09:15:00.000Z",
    "expires_at": "2026-10-22T12:00:00.000Z"
  }
}
```

### 5.2 Get Session Status
- **Endpoint:** `GET /api/v1/sessions/:id`
- **Auth Required:** Yes (`STUDENT` self, or assigned `UNIVERSITY_SAFETY_ADMIN`)
- **Response `200 OK`:** Returns session status (`ACTIVE`, `ENDED`, `EXPIRED`), boundary version, and end reason.

### 5.3 Stop Safety Session (Student Only)
- **Endpoint:** `POST /api/v1/sessions/:id/stop`
- **Auth Required:** Yes (`STUDENT`, must own session)
- **Response `200 OK`:** Sets status to `ENDED` with `end_reason = 'USER_STOPPED'`.

### 5.4 Update Session Consent Flags
- **Endpoint:** `PATCH /api/v1/sessions/:id/consent`
- **Auth Required:** Yes (`STUDENT`, must own session)
- **Request Body:**
```json
{
  "consent_university": true,
  "consent_guardians": false
}
```
- **Response `200 OK`:** Updates flags; disconnects guardian socket rooms if revoked.

### 5.5 Student Session Breadcrumbs (Paginated)
- **Endpoint:** `GET /api/v1/sessions/:id/breadcrumbs?limit=100&offset=0`
- **Auth Required:** Yes (`STUDENT` self, or assigned `UNIVERSITY_SAFETY_ADMIN`)
- **Response `200 OK`:**
```json
{
  "success": true,
  "data": {
    "breadcrumbs": [ ... ],
    "pagination": { "limit": 100, "offset": 0, "total_count": 420 }
  }
}
```

---

## 6. Location Batch Synchronization (Offline-First Protocol)

Idempotent batch upload endpoint accepting buffered points from local SQLite.

- **Endpoint:** `POST /api/v1/sessions/:id/locations/batch`
- **Auth Required:** Yes (`STUDENT`, must own session)
- **Validation Limit:** Maximum 100 points per batch.
- **Request Body:**
```json
{
  "sync_batch_id": "550e8400-e29b-41d4-a716-446655440000",
  "device_utc_time": "2026-10-22T10:30:05.120Z",
  "points": [
    {
      "point_uuid": "d3b07384-d113-467f-8e2b-f81d1e4e3e01",
      "seq_no": 1,
      "latitude": 30.727500,
      "longitude": 76.843800,
      "altitude": 320.5,
      "accuracy": 8.2,
      "speed": 1.2,
      "heading": 182.4,
      "is_mock": false,
      "payload_hash": "a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e",
      "captured_at": "2026-10-22T10:29:45.000Z"
    }
  ]
}
```
- **Response `200 OK` (With Per-Point Results):**
```json
{
  "success": true,
  "data": {
    "sync_batch_id": "550e8400-e29b-41d4-a716-446655440000",
    "accepted_count": 1,
    "duplicate_count": 0,
    "rejected_count": 0,
    "results": [
      {
        "point_uuid": "d3b07384-d113-467f-8e2b-f81d1e4e3e01",
        "status": "ACCEPTED",
        "retryable": false
      }
    ],
    "server_received_at": "2026-10-22T10:30:06.840Z",
    "geofence_status": "INSIDE_CORE",
    "latest_freshness": "FRESH"
  }
}
```

---

## 7. Safety Events & Emergency SOS Endpoints

### 7.1 Upload Safety Events
- **Endpoint:** `POST /api/v1/sessions/:id/events`
- **Auth Required:** Yes (`STUDENT`)
- **Request Body:**
```json
{
  "events": [
    {
      "event_uuid": "f1a2b3c4-d5e6-47a8-b9c0-112233445566",
      "event_type": "BUFFER_WARNING",
      "metadata": { "distance_to_boundary": 15 },
      "triggered_at": "2026-10-22T10:30:00.000Z"
    }
  ]
}
```

### 7.2 Dispatch Emergency SOS (Student Only)
Immediate trigger. Persists immediately into `sos_requests` and `notification_outbox`.
- **Endpoint:** `POST /api/v1/sos`
- **Auth Required:** Yes (`STUDENT`)
- **Request Body:**
```json
{
  "sos_uuid": "7a8b9c0d-1e2f-4a5b-8c9d-0e1f2a3b4c5d",
  "session_id": "90d1f7e4-c5b8-4792-801b-9f931d87f421",
  "campus_id": "c1a0e8d4-5392-498c-8f2e-e5a91f532a01",
  "has_coordinates": true,
  "is_last_known": false,
  "latitude": 30.728100,
  "longitude": 76.844200,
  "accuracy": 5.0,
  "triggered_at": "2026-10-22T11:45:00.000Z"
}
```
- **Response `201 Created`:**
```json
{
  "success": true,
  "data": {
    "sos_id": "a9840f32-7231-4e89-b102-401928374650",
    "sos_uuid": "7a8b9c0d-1e2f-4a5b-8c9d-0e1f2a3b4c5d",
    "status": "RECEIVED",
    "campus_id": "c1a0e8d4-5392-498c-8f2e-e5a91f532a01",
    "has_coordinates": true,
    "dispatched_to_security": true,
    "server_received_at": "2026-10-22T11:45:00.850Z"
  }
}
```

### 7.3 Get Active SOS Incidents (Admin & Reconnecting Consoles)
- **Endpoint:** `GET /api/v1/sos/active?campusId=...`
- **Auth Required:** Yes (`UNIVERSITY_SAFETY_ADMIN` assigned to campus)
- **Response `200 OK`:** Returns array of all currently active / unacknowledged emergency incidents.

### 7.4 Acknowledge Emergency SOS (Safety Admin Only)
- **Endpoint:** `POST /api/v1/sos/:id/acknowledge`
- **Auth Required:** Yes (`UNIVERSITY_SAFETY_ADMIN` assigned to campus with `can_handle_sos = true`)
- **Response `200 OK`:** Updates status to `ACKNOWLEDGED`.

### 7.5 Resolve Emergency SOS (Safety Admin Only)
- **Endpoint:** `POST /api/v1/sos/:id/resolve`
- **Auth Required:** Yes (`UNIVERSITY_SAFETY_ADMIN` assigned to campus with `can_handle_sos = true`)
- **Request Body:**
```json
{
  "resolution_notes": "Student located and verified safe at Block B reception."
}
```
- **Response `200 OK`:** Updates status to `RESOLVED`.

---

## 8. Administrative Dashboard & Audit Endpoints

### 8.1 Fetch Active Students on Campus
- **Endpoint:** `GET /api/v1/dashboard/active-students?campusId=...&limit=50&offset=0`
- **Auth Required:** Yes (`UNIVERSITY_SAFETY_ADMIN` assigned to `campusId`)

### 8.2 Inspect Access Audit Trail
- **Endpoint:** `GET /api/v1/audit/logs?targetStudentId=...&campusId=...&limit=100&offset=0`
- **Auth Required:** Yes (`UNIVERSITY_SAFETY_ADMIN` assigned to campus, or `STUDENT` inspecting self)

---

## 9. Real-Time Socket.IO Protocol Specifications

### 9.1 Handshake Authentication
Client connects providing JWT token in auth payload. Backend validates token and establishes authorized rooms:
```javascript
const socket = io("wss://api.campussafe.university.edu/dashboard", {
  auth: { token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." },
  transports: ["websocket"]
});
```

### 9.2 Real-Time Event Dictionary

| Namespace | Event Name | Direction | Payload Contract | Description |
| :--- | :--- | :---: | :--- | :--- |
| `/dashboard` | `student:location_updated` | Server $\to$ Client | `{ student_id, lat, lon, accuracy, freshness, is_inside, captured_at }` | Emitted only to admins assigned to that student's campus. |
| `/dashboard` | `geofence:boundary_exit` | Server $\to$ Client | `{ student_id, student_name, roll_number, lat, lon, exit_timestamp }` | Fired when exit criteria (45s continuous outside) are met. |
| `/sos-channel`| `sos:new_alert` | Server $\to$ Client | `{ sos_id, student_id, student_name, lat, lon, has_coords, trigger_timestamp }` | High-priority emergency broadcast triggering desktop siren. |
| `/sos-channel`| `sos:acknowledged` | Server $\to$ Client | `{ sos_id, acknowledged_by_name, acknowledged_at }` | Updates security monitors when incident is claimed. |
| `/guardian` | `ward:location_updated` | Server $\to$ Client | `{ ward_id, lat, lon, accuracy, freshness, is_inside, captured_at }` | Emitted only inside room `ward-{id}` if both link and session consent active. |
| `/guardian` | `ward:sos_alert` | Server $\to$ Client | `{ sos_id, ward_id, lat, lon, trigger_timestamp }` | Emergency alert pushed to guardian mobile/web view. |
