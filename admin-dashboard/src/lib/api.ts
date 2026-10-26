import { AdminUser, Campus, DashboardStudent, PendingStudent, SosIncident } from '../types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

export function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('campussafe_admin_token');
}

export function setStoredToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) {
    localStorage.setItem('campussafe_admin_token', token);
  } else {
    localStorage.removeItem('campussafe_admin_token');
  }
}

export function getStoredAdmin(): AdminUser | null {
  if (typeof window === 'undefined') return null;
  const data = localStorage.getItem('campussafe_admin_user');
  try {
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

export function setStoredAdmin(admin: AdminUser | null): void {
  if (typeof window === 'undefined') return;
  if (admin) {
    localStorage.setItem('campussafe_admin_user', JSON.stringify(admin));
  } else {
    localStorage.removeItem('campussafe_admin_user');
  }
}

async function apiFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      (data && data.error && data.error.message) ||
      (data && data.message) ||
      `Request failed with status ${response.status}`;
    const code = (data && data.error && data.error.code) || 'API_ERROR';
    const err = new Error(message) as Error & { code?: string; status?: number };
    err.code = code;
    err.status = response.status;
    throw err;
  }

  return data as T;
}

export const api = {
  // Authentication
  login: async (email: string, password: string): Promise<{ user: AdminUser; accessToken: string }> => {
    const res = await apiFetch<{ user: AdminUser; accessToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setStoredToken(res.accessToken);
    setStoredAdmin(res.user);
    return res;
  },

  getMe: async (): Promise<{ user: AdminUser }> => {
    return apiFetch<{ user: AdminUser }>('/auth/me');
  },

  logout: async (): Promise<void> => {
    setStoredToken(null);
    setStoredAdmin(null);
  },

  // Campuses
  getCampuses: async (): Promise<{ campuses: Campus[] }> => {
    return apiFetch<{ campuses: Campus[] }>('/campuses');
  },

  getCampusById: async (id: string): Promise<{ campus: Campus }> => {
    return apiFetch<{ campus: Campus }>(`/campuses/${id}`);
  },

  // Dashboard Students
  getDashboardStudents: async (campusId: string): Promise<{ students: DashboardStudent[] }> => {
    return apiFetch<{ students: DashboardStudent[] }>(`/dashboard/students?campusId=${encodeURIComponent(campusId)}`);
  },

  // Pending Membership Approvals
  getPendingStudents: async (campusId?: string): Promise<{ pendingStudents: PendingStudent[] }> => {
    const q = campusId ? `?campusId=${encodeURIComponent(campusId)}` : '';
    return apiFetch<{ pendingStudents: PendingStudent[] }>(`/dashboard/students/pending${q}`);
  },

  approveStudent: async (membershipId: string, rollNumber?: string): Promise<{ success: boolean; message: string }> => {
    return apiFetch<{ success: boolean; message: string }>(`/dashboard/students/${membershipId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ rollNumber }),
    });
  },

  rejectStudent: async (membershipId: string, reason?: string): Promise<{ success: boolean; message: string }> => {
    return apiFetch<{ success: boolean; message: string }>(`/dashboard/students/${membershipId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason: reason || 'Information does not match official campus records' }),
    });
  },

  // Emergency SOS
  getActiveSos: async (): Promise<{ activeSos: SosIncident[] }> => {
    return apiFetch<{ activeSos: SosIncident[] }>('/sos/active');
  },

  acknowledgeSos: async (sosId: string): Promise<{ sos: SosIncident }> => {
    return apiFetch<{ sos: SosIncident }>(`/sos/${sosId}/acknowledge`, {
      method: 'POST',
    });
  },

  resolveSos: async (sosId: string, notes?: string): Promise<{ sos: SosIncident }> => {
    return apiFetch<{ sos: SosIncident }>(`/sos/${sosId}/resolve`, {
      method: 'POST',
      body: JSON.stringify({
        status: 'RESOLVED',
        resolutionNotes: notes || 'Officer verified student safety on site. Incident resolved.',
      }),
    });
  },

  // Incidents History
  getDashboardIncidents: async (campusId: string): Promise<{ sosIncidents: SosIncident[]; safetyEvents: unknown[] }> => {
    return apiFetch<{ sosIncidents: SosIncident[]; safetyEvents: unknown[] }>(`/dashboard/incidents?campusId=${encodeURIComponent(campusId)}`);
  },

  // Student Telemetry History
  getStudentHistory: async (studentId: string, campusId: string): Promise<{ student: unknown; breadcrumbs: unknown[] }> => {
    return apiFetch<{ student: unknown; breadcrumbs: unknown[] }>(`/dashboard/students/${studentId}/history?campusId=${encodeURIComponent(campusId)}`);
  },
};
