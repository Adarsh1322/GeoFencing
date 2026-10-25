export type UserRole = 'STUDENT' | 'GUARDIAN' | 'CAMPUS_ADMIN';
export type MembershipStatus = 'PENDING_APPROVAL' | 'ACTIVE' | 'REJECTED' | 'REVOKED';
export type SessionStatus = 'ACTIVE' | 'ENDED' | 'EXPIRED';
export type GeofenceStatus = 'INSIDE' | 'OUTSIDE_NEAR' | 'OUTSIDE';
export type SosStatus = 'LOCAL_PENDING' | 'RECEIVED' | 'ACKNOWLEDGED' | 'RESOLVED';
export type ConsentStatus = 'PENDING' | 'GRANTED' | 'REVOKED';
export type OutboxStatus = 'PENDING' | 'DISPATCHED' | 'DELIVERED' | 'FAILED';

export interface User {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  phone?: string | null;
  role: UserRole;
  created_at: Date;
  updated_at: Date;
}

export interface RefreshToken {
  id: string;
  user_id: string;
  token_hash: string;
  family_id: string;
  is_revoked: boolean;
  expires_at: Date;
  created_at: Date;
  replaced_by?: string | null;
}

export interface GeoJsonMultiPolygon {
  type: 'MultiPolygon';
  coordinates: number[][][][]; // [polygon][ring][point][lon, lat]
}

export interface Campus {
  id: string;
  name: string;
  code: string;
  boundary_geojson: GeoJsonMultiPolygon;
  center_lat: number;
  center_lon: number;
  radius_meters: number;
  timezone: string;
  is_active: boolean;
  boundary_version: number;
  created_at: Date;
  updated_at: Date;
}

export interface StudentCampusMembership {
  id: string;
  student_user_id: string;
  campus_id: string;
  roll_number: string;
  status: MembershipStatus;
  approved_by?: string | null;
  approved_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface AdminCampusAssignment {
  id: string;
  admin_user_id: string;
  campus_id: string;
  created_at: Date;
}

export interface MonitoringSchedule {
  id: string;
  campus_id: string;
  day_of_week: number; // 0=Sunday, 1=Monday ... 6=Saturday
  start_time: string; // "08:00:00"
  end_time: string; // "20:00:00"
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface GuardianLink {
  id: string;
  student_user_id: string;
  guardian_user_id?: string | null;
  invitation_token_hash?: string | null;
  invitation_expires_at?: Date | null;
  status: 'PENDING' | 'ACTIVE' | 'REVOKED';
  consent_status: ConsentStatus;
  created_at: Date;
  updated_at: Date;
}

export interface SafetySession {
  id: string;
  student_user_id: string;
  campus_id: string;
  device_id: string;
  status: SessionStatus;
  started_at: Date;
  scheduled_end_at: Date;
  ended_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface LocationRecord {
  id: string;
  session_id: string;
  student_user_id: string;
  client_point_id: string;
  seq_no: number;
  latitude: number;
  longitude: number;
  accuracy_meters?: number | null;
  captured_at: Date;
  server_received_at: Date;
  geofence_status: GeofenceStatus;
  created_at: Date;
}

export interface StudentCurrentLocation {
  student_user_id: string;
  session_id: string;
  session_started_at: Date;
  latitude: number;
  longitude: number;
  accuracy_meters?: number | null;
  captured_at: Date;
  server_received_at: Date;
  geofence_status: GeofenceStatus;
  is_active_session: boolean;
  updated_at: Date;
}

export interface SafetyEvent {
  id: string;
  session_id?: string | null;
  student_user_id: string;
  campus_id: string;
  event_type: string;
  details?: Record<string, unknown> | null;
  captured_at: Date;
  created_at: Date;
}

export interface SosRequest {
  id: string;
  idempotency_key: string;
  student_user_id: string;
  campus_id: string;
  session_id?: string | null;
  status: SosStatus;
  latitude?: number | null;
  longitude?: number | null;
  accuracy_meters?: number | null;
  trigger_type: string;
  received_at: Date;
  acknowledged_by?: string | null;
  acknowledged_at?: Date | null;
  resolved_by?: string | null;
  resolved_at?: Date | null;
  resolution_notes?: string | null;
  created_at: Date;
}

export interface NotificationOutboxItem {
  id: string;
  sos_id: string;
  recipient_user_id?: string | null;
  recipient_channel: 'SMS' | 'EMAIL' | 'PUSH' | 'SOCKET';
  recipient_contact: string;
  payload: Record<string, unknown>;
  status: OutboxStatus;
  attempt_count: number;
  max_attempts: number;
  next_retry_at: Date;
  sent_at?: Date | null;
  last_error?: string | null;
  created_at: Date;
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  fullName: string;
  campusId?: string;
}
