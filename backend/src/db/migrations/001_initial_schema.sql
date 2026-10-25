-- 001_initial_schema.sql: CampusSafe Initial Database Schema

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Attempt to enable PostGIS if installed
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS postgis;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'PostGIS extension not available in environment. Using JSONB MultiPolygon and TypeScript spatial engine.';
END $$;

-- Enums
DO $$ BEGIN
    CREATE TYPE user_role_enum AS ENUM ('STUDENT', 'GUARDIAN', 'CAMPUS_ADMIN');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE membership_status_enum AS ENUM ('PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'REVOKED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE session_status_enum AS ENUM ('ACTIVE', 'ENDED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE sos_status_enum AS ENUM ('LOCAL_PENDING', 'RECEIVED', 'ACKNOWLEDGED', 'RESOLVED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE consent_status_enum AS ENUM ('PENDING', 'GRANTED', 'REVOKED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE outbox_status_enum AS ENUM ('PENDING', 'DISPATCHED', 'DELIVERED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 1. Users
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(128) NOT NULL,
    phone VARCHAR(32),
    role user_role_enum NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 2. Refresh Tokens (with Token Family Rotation and Replay Detection)
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(128) NOT NULL UNIQUE,
    family_id UUID NOT NULL,
    is_revoked BOOLEAN NOT NULL DEFAULT false,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    replaced_by VARCHAR(128)
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens(family_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);

-- 3. Campuses
CREATE TABLE IF NOT EXISTS campuses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(128) NOT NULL,
    code VARCHAR(32) NOT NULL UNIQUE,
    boundary_geojson JSONB NOT NULL,
    center_lat DOUBLE PRECISION NOT NULL,
    center_lon DOUBLE PRECISION NOT NULL,
    radius_meters DOUBLE PRECISION NOT NULL,
    timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
    is_active BOOLEAN NOT NULL DEFAULT true,
    boundary_version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 4. Student-Campus Memberships (Multi-tenant student authorization)
CREATE TABLE IF NOT EXISTS student_campus_memberships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    campus_id UUID NOT NULL REFERENCES campuses(id) ON DELETE RESTRICT,
    roll_number VARCHAR(64) NOT NULL,
    status membership_status_enum NOT NULL DEFAULT 'PENDING_APPROVAL',
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    CONSTRAINT uq_student_campus UNIQUE (student_user_id, campus_id)
);
CREATE INDEX IF NOT EXISTS idx_student_memberships_campus ON student_campus_memberships(campus_id);

-- 5. Admin-Campus Assignments (Multi-tenant safety admin authorization)
CREATE TABLE IF NOT EXISTS admin_campus_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    campus_id UUID NOT NULL REFERENCES campuses(id) ON DELETE RESTRICT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    CONSTRAINT uq_admin_campus UNIQUE (admin_user_id, campus_id)
);

-- 6. Monitoring Schedules
CREATE TABLE IF NOT EXISTS monitoring_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campus_id UUID NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
    day_of_week INT NOT NULL, -- 0=Sunday, 1=Monday ... 6=Saturday
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    CONSTRAINT uq_campus_schedule UNIQUE (campus_id, day_of_week)
);

-- 7. Guardian Links & Invitations
CREATE TABLE IF NOT EXISTS guardian_links (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    guardian_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    invitation_token_hash VARCHAR(128) UNIQUE,
    invitation_expires_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    consent_status consent_status_enum NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_guardian_links_student ON guardian_links(student_user_id);
CREATE INDEX IF NOT EXISTS idx_guardian_links_guardian ON guardian_links(guardian_user_id);

-- 8. Guardian Consent Audit Events
CREATE TABLE IF NOT EXISTS guardian_consent_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    guardian_link_id UUID NOT NULL REFERENCES guardian_links(id) ON DELETE CASCADE,
    event_type VARCHAR(64) NOT NULL, -- 'INVITED', 'ACCEPTED', 'REVOKED_BY_STUDENT', 'REVOKED_BY_GUARDIAN'
    actor_user_id UUID NOT NULL REFERENCES users(id),
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 9. Safety Sessions
CREATE TABLE IF NOT EXISTS safety_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    campus_id UUID NOT NULL REFERENCES campuses(id) ON DELETE RESTRICT,
    device_id VARCHAR(128) NOT NULL,
    status session_status_enum NOT NULL DEFAULT 'ACTIVE',
    started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    scheduled_end_at TIMESTAMP WITH TIME ZONE NOT NULL,
    ended_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_student_status ON safety_sessions(student_user_id, status);

-- 10. Location Records (Append-only breadcrumbs)
CREATE TABLE IF NOT EXISTS location_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES safety_sessions(id) ON DELETE CASCADE,
    student_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_point_id UUID NOT NULL,
    seq_no BIGINT NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    accuracy_meters DOUBLE PRECISION,
    captured_at TIMESTAMP WITH TIME ZONE NOT NULL,
    server_received_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    geofence_status VARCHAR(32) NOT NULL DEFAULT 'INSIDE',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    CONSTRAINT uq_session_point UNIQUE (session_id, client_point_id)
);
CREATE INDEX IF NOT EXISTS idx_location_records_session_seq ON location_records(session_id, seq_no);
CREATE INDEX IF NOT EXISTS idx_location_records_student_captured ON location_records(student_user_id, captured_at DESC);

-- 11. Student Current Locations (One active position row per student)
CREATE TABLE IF NOT EXISTS student_current_locations (
    student_user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES safety_sessions(id) ON DELETE CASCADE,
    session_started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    accuracy_meters DOUBLE PRECISION,
    captured_at TIMESTAMP WITH TIME ZONE NOT NULL,
    server_received_at TIMESTAMP WITH TIME ZONE NOT NULL,
    geofence_status VARCHAR(32) NOT NULL,
    is_active_session BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 12. Safety Events (Geofence breaches, dwell triggers)
CREATE TABLE IF NOT EXISTS safety_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES safety_sessions(id) ON DELETE CASCADE,
    student_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    campus_id UUID NOT NULL REFERENCES campuses(id) ON DELETE RESTRICT,
    event_type VARCHAR(64) NOT NULL, -- 'GEOFENCE_EXIT', 'GEOFENCE_DWELL_BREACH', 'SESSION_EXPIRED'
    details JSONB,
    captured_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_safety_events_campus ON safety_events(campus_id, created_at DESC);

-- 13. SOS Requests
CREATE TABLE IF NOT EXISTS sos_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    idempotency_key UUID NOT NULL UNIQUE,
    student_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    campus_id UUID NOT NULL REFERENCES campuses(id) ON DELETE RESTRICT,
    session_id UUID REFERENCES safety_sessions(id) ON DELETE SET NULL,
    status sos_status_enum NOT NULL DEFAULT 'RECEIVED',
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    accuracy_meters DOUBLE PRECISION,
    trigger_type VARCHAR(32) NOT NULL DEFAULT 'MANUAL',
    received_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL,
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolution_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sos_campus_status ON sos_requests(campus_id, status);

-- 14. Notification Outbox (Reliable transactional dispatch)
CREATE TABLE IF NOT EXISTS notification_outbox (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sos_id UUID NOT NULL REFERENCES sos_requests(id) ON DELETE CASCADE,
    recipient_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    recipient_channel VARCHAR(32) NOT NULL, -- 'SMS', 'EMAIL', 'PUSH', 'SOCKET'
    recipient_contact VARCHAR(128) NOT NULL,
    payload JSONB NOT NULL,
    status outbox_status_enum NOT NULL DEFAULT 'PENDING',
    attempt_count INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 5,
    next_retry_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    sent_at TIMESTAMP WITH TIME ZONE,
    last_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_pending ON notification_outbox(status, next_retry_at) WHERE status = 'PENDING';

-- 15. Access Audit Logs (Privacy & Compliance)
CREATE TABLE IF NOT EXISTS access_audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    student_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(64) NOT NULL,
    resource VARCHAR(128) NOT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON access_audit_logs(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_student ON access_audit_logs(student_user_id, created_at DESC);
