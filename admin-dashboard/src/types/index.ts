export interface AdminUser {
  id: string;
  email: string;
  fullName: string;
  phone?: string;
  role: 'CAMPUS_ADMIN';
  campusId?: string;
}

export interface Campus {
  id: string;
  code: string;
  name: string;
  timezone: string;
  boundary_geojson?: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: any;
  };
  geofence_polygon?: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: any;
  };
  center_lat?: number;
  center_lon?: number;
  center_lng?: number;
  radius_meters?: number;
}

export interface DashboardStudent {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  roll_number: string;
  membership_status: string;
  session_id: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy_meters: number | null;
  captured_at: string | null;
  server_received_at: string | null;
  geofence_status: 'INSIDE' | 'OUTSIDE' | 'UNKNOWN' | null;
  is_active_session: boolean | null;
  freshness_status: 'ONLINE' | 'DELAYED' | 'OFFLINE' | 'NO_DATA';
}

export interface PendingStudent {
  membership_id: string;
  student_user_id: string;
  campus_id: string;
  campus_name: string;
  campus_code: string;
  roll_number: string;
  status: string;
  requested_at: string;
  student_name: string;
  student_email: string;
  student_phone: string | null;
}

export interface SosIncident {
  id: string;
  idempotency_key: string;
  campus_id: string;
  student_user_id: string;
  student_name?: string;
  student_phone?: string;
  session_id: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy_meters: number | null;
  trigger_type: string;
  status: 'LOCAL_PENDING' | 'RECEIVED' | 'ACKNOWLEDGED' | 'RESOLVED' | 'FALSE_ALARM';
  triggered_at: string;
  received_at: string;
  acknowledged_at: string | null;
  acknowledged_by?: string | null;
  resolved_at: string | null;
  resolved_by?: string | null;
  resolution_notes?: string | null;
}

export interface AttendanceRecord {
  id: string;
  student_id: string;
  student_name: string;
  roll_number: string;
  session_id: string;
  latitude: number;
  longitude: number;
  accuracy_meters: number;
  captured_at: string;
  server_received_at: string;
  distance_meters: number;
  status: 'VERIFIED' | 'OUTSIDE_PERIMETER' | 'REJECTED';
}
