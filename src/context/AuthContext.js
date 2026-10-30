import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authApi } from '../services/authApi';
import { safetyService } from '../services/safetyService';
import { trackingService } from '../services/trackingService';

const AuthContext = createContext(null);

const AUTH_TOKEN_KEY = '@campussafe_access_token';
const REFRESH_TOKEN_KEY = '@campussafe_refresh_token';
const USER_KEY = '@campussafe_user';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [refreshToken, setRefreshToken] = useState(null);
  const [memberships, setMemberships] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  /**
   * Persists tokens and user object to AsyncStorage.
   */
  const persistSession = async (userObj, token, refToken, userMemberships = []) => {
    try {
      setUser(userObj);
      setAccessToken(token);
      setRefreshToken(refToken);
      setMemberships(userMemberships);

      await Promise.all([
        AsyncStorage.setItem(AUTH_TOKEN_KEY, token || ''),
        AsyncStorage.setItem(REFRESH_TOKEN_KEY, refToken || ''),
        AsyncStorage.setItem(USER_KEY, JSON.stringify(userObj || {})),
      ]);
    } catch (err) {
      console.warn('Failed to persist auth session to storage:', err);
    }
  };

  /**
   * Clears stored tokens and resets state.
   */
  const clearSession = async () => {
    try {
      setUser(null);
      setAccessToken(null);
      setRefreshToken(null);
      setMemberships([]);
      await Promise.all([
        AsyncStorage.removeItem(AUTH_TOKEN_KEY),
        AsyncStorage.removeItem(REFRESH_TOKEN_KEY),
        AsyncStorage.removeItem(USER_KEY),
      ]);
    } catch (err) {
      console.warn('Failed to clear auth storage:', err);
    }
  };

  /**
   * Checks for stored credentials on app startup and validates token.
   */
  const restoreSession = useCallback(async () => {
    try {
      setIsLoading(true);
      const [storedToken, storedRefreshToken, storedUserJson] = await Promise.all([
        AsyncStorage.getItem(AUTH_TOKEN_KEY),
        AsyncStorage.getItem(REFRESH_TOKEN_KEY),
        AsyncStorage.getItem(USER_KEY),
      ]);

      if (!storedToken || !storedUserJson) {
        setIsLoading(false);
        return;
      }

      let parsedUser = null;
      try {
        parsedUser = JSON.parse(storedUserJson);
      } catch {
        parsedUser = null;
      }

      // Verify token with backend
      try {
        const meRes = await authApi.getMe(storedToken);
        const validatedUser = meRes.user || parsedUser;
        const validMemberships = meRes.memberships || [];
        setUser(validatedUser);
        setAccessToken(storedToken);
        setRefreshToken(storedRefreshToken);
        setMemberships(validMemberships);
      } catch (err) {
        // Offline resilience: If network is unreachable, DO NOT kick student to login!
        if (err.code === 'NETWORK_ERROR' || !err.status) {
          setUser(parsedUser);
          setAccessToken(storedToken);
          setRefreshToken(storedRefreshToken);
          setMemberships(parsedUser?.memberships || []);
          return;
        }

        // If token expired (401), attempt refresh
        if (storedRefreshToken) {
          try {
            const refreshRes = await authApi.refreshToken(storedRefreshToken);
            const newToken = refreshRes.accessToken;
            const newRefToken = refreshRes.refreshToken || storedRefreshToken;
            const meRes = await authApi.getMe(newToken);
            await persistSession(
              meRes.user || parsedUser,
              newToken,
              newRefToken,
              meRes.memberships || []
            );
          } catch (refreshErr) {
            if (refreshErr.code === 'NETWORK_ERROR' || !refreshErr.status) {
              setUser(parsedUser);
              setAccessToken(storedToken);
              setRefreshToken(storedRefreshToken);
              setMemberships(parsedUser?.memberships || []);
            } else {
              // Server explicitly rejected refresh token
              await clearSession();
            }
          }
        } else {
          await clearSession();
        }
      }
    } catch (err) {
      console.warn('Error restoring session:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  /**
   * Logs in a student.
   */
  const login = async (email, password) => {
    setAuthError(null);
    try {
      const res = await authApi.login({ email, password });
      const { user: loggedInUser, accessToken: token, refreshToken: refToken, memberships: mems } = res;
      await persistSession(loggedInUser, token, refToken, mems || []);
      return { success: true, user: loggedInUser };
    } catch (err) {
      setAuthError(err.message || 'Login failed');
      throw err;
    }
  };

  /**
   * Registers a new student.
   */
  const register = async (formData) => {
    setAuthError(null);
    try {
      const res = await authApi.register(formData);
      const { user: registeredUser, accessToken: token, refreshToken: refToken, membership } = res;
      const mems = membership ? [membership] : [];
      await persistSession(registeredUser, token, refToken, mems);
      return { success: true, user: registeredUser, membership };
    } catch (err) {
      setAuthError(err.message || 'Registration failed');
      throw err;
    }
  };

  /**
   * Refreshes the user profile and memberships from server.
   */
  const refreshProfile = async () => {
    if (!accessToken) return;
    try {
      const meRes = await authApi.getMe(accessToken);
      if (meRes.user) {
        setUser(meRes.user);
        setMemberships(meRes.memberships || []);
        await AsyncStorage.setItem(USER_KEY, JSON.stringify(meRes.user));
      }
      return meRes;
    } catch (err) {
      console.warn('Failed to refresh user profile:', err);
    }
  };

  /**
   * Logs out the student.
   * P0-1: Cleanly terminates native tracking service and reconciles active journey before clearing identity.
   */
  const logout = async () => {
    try {
      if (user?.id) {
        try {
          const activeSession = await safetyService.getActiveJourney(user.id);
          if (activeSession) {
            await safetyService.stopJourney({
              sessionId: activeSession.id,
              studentUserId: user.id,
              accessToken,
            });
          }
        } catch (stopErr) {
          console.warn('Warning stopping journey during logout:', stopErr.message);
        }
      }

      // Ensure native tracking service is unconditionally terminated
      await trackingService.stopTracking().catch(() => {});

      if (refreshToken) {
        await authApi.logout(refreshToken).catch(() => {});
      }
    } finally {
      await clearSession();
    }
  };

  // Helper to determine student's active campus membership status
  const currentMembership = memberships && memberships.length > 0 ? memberships[0] : null;
  const isApproved =
    user?.role === 'CAMPUS_ADMIN' ||
    (currentMembership && currentMembership.status === 'ACTIVE');

  return (
    <AuthContext.Provider
      value={{
        user,
        accessToken,
        refreshToken,
        memberships,
        currentMembership,
        isApproved,
        isLoading,
        authError,
        setAuthError,
        login,
        register,
        logout,
        refreshProfile,
      }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
