/**
 * CampusSafe - Authentication API Service
 * Communicates with CampusSafe backend API for login, signup, token refresh, and profile fetching.
 */

const API_BASE_URL = 'http://localhost:4000/api/v1';

async function request(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errorMessage =
        (data && data.error && data.error.message) ||
        (data && data.message) ||
        `Request failed with status ${response.status}`;
      const errorCode = (data && data.error && data.error.code) || 'API_ERROR';
      const error = new Error(errorMessage);
      error.code = errorCode;
      error.status = response.status;
      throw error;
    }

    return data;
  } catch (err) {
    if (err.status) throw err;
    const networkError = new Error(
      'Unable to connect to CampusSafe server. Please ensure backend is running.'
    );
    networkError.code = 'NETWORK_ERROR';
    networkError.cause = err;
    throw networkError;
  }
}

export const authApi = {
  /**
   * Logs in a student or user with email and password.
   */
  async login({ email, password }) {
    return await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: email.trim(), password }),
    });
  },

  /**
   * Registers a new student account.
   */
  async register({ email, password, fullName, phone, rollNumber, campusCode }) {
    const payload = {
      email: email.trim(),
      password,
      fullName: fullName.trim(),
      rollNumber: rollNumber.trim().toUpperCase(),
      campusCode: campusCode.trim().toUpperCase(),
    };
    if (phone && phone.trim()) {
      payload.phone = phone.trim();
    }

    return await request('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * Fetches the current authenticated user's profile and active campus memberships.
   */
  async getMe(accessToken) {
    return await request('/auth/me', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
  },

  /**
   * Refreshes an expired access token using the refresh token.
   */
  async refreshToken(refreshToken) {
    return await request('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    });
  },

  /**
   * Logs out the current session and revokes the refresh token.
   */
  async logout(refreshToken) {
    if (!refreshToken) return { message: 'Logged out locally' };
    return await request('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    });
  },
};
