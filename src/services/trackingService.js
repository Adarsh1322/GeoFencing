/**
 * CampusSafe Native Tracking Bridge Service
 *
 * Coordinates with the native Android CampusSafeLocationService to manage
 * foreground location tracking, persistent notifications, and background event delivery.
 */

import { NativeModules, NativeEventEmitter, Platform, PermissionsAndroid } from 'react-native';

const { CampusSafeTrackingModule } = NativeModules;

class TrackingService {
  constructor() {
    this._eventEmitter =
      Platform.OS === 'android' && CampusSafeTrackingModule
        ? new NativeEventEmitter(CampusSafeTrackingModule)
        : null;
    this._locationListeners = new Set();
    this._stopListeners = new Set();

    if (this._eventEmitter) {
      this._eventEmitter.addListener('onLocationCaptured', event => {
        for (const listener of this._locationListeners) {
          try {
            listener(event);
          } catch (err) {
            console.warn('Error in onLocationCaptured listener:', err);
          }
        }
      });

      this._eventEmitter.addListener('onJourneyStopped', event => {
        for (const listener of this._stopListeners) {
          try {
            listener(event);
          } catch (err) {
            console.warn('Error in onJourneyStopped listener:', err);
          }
        }
      });
    }
  }

  /**
   * Requests necessary permissions on Android including POST_NOTIFICATIONS on API 33+.
   */
  async requestTrackingPermissions() {
    if (Platform.OS !== 'android') return true;

    try {
      // 1. Check fine location
      const hasFine = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
      );
      if (!hasFine) {
        const statuses = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
        ]);
        const fineGranted =
          statuses[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] ===
          PermissionsAndroid.RESULTS.GRANTED;
        const coarseGranted =
          statuses[PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION] ===
          PermissionsAndroid.RESULTS.GRANTED;
        if (!fineGranted && !coarseGranted) {
          return false;
        }
      }

      // 2. Request POST_NOTIFICATIONS on Android 13+ (API 33+)
      if (Platform.Version >= 33) {
        try {
          const hasNotification = await PermissionsAndroid.check(
            'android.permission.POST_NOTIFICATIONS'
          );
          if (!hasNotification) {
            await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS');
          }
        } catch (e) {
          console.warn('Notification permission check warning:', e.message);
        }
      }

      return true;
    } catch (err) {
      console.warn('Failed to verify tracking permissions:', err);
      return false;
    }
  }

  /**
   * Starts native Android foreground location tracking service.
   */
  async startTracking({ sessionId, studentUserId, campusId }) {
    if (!sessionId) {
      throw new Error('sessionId is required to start tracking');
    }

    if (Platform.OS !== 'android' || !CampusSafeTrackingModule) {
      return { success: true, mocked: true };
    }

    const hasPermissions = await this.requestTrackingPermissions();
    if (!hasPermissions) {
      throw new Error('Required location permissions are not granted.');
    }

    return await CampusSafeTrackingModule.startTracking({
      sessionId,
      studentUserId: studentUserId || null,
      campusId: campusId || null,
    });
  }

  /**
   * Stops native Android foreground location tracking service.
   */
  async stopTracking(sessionId) {
    if (Platform.OS !== 'android' || !CampusSafeTrackingModule) {
      return { success: true, mocked: true };
    }

    return await CampusSafeTrackingModule.stopTracking({
      sessionId: sessionId || null,
    });
  }

  /**
   * Queries whether the native tracking service is currently running.
   */
  async isTrackingRunning() {
    if (Platform.OS !== 'android' || !CampusSafeTrackingModule) {
      return { isRunning: false, activeSessionId: null };
    }

    return await CampusSafeTrackingModule.isTrackingRunning();
  }

  /**
   * Subscribes a listener to native location captures.
   * Returns an unsubscribe function.
   */
  onLocationCaptured(callback) {
    this._locationListeners.add(callback);
    return () => {
      this._locationListeners.delete(callback);
    };
  }

  /**
   * Subscribes a listener to native journey stop events (e.g. from notification action).
   * Returns an unsubscribe function.
   */
  onJourneyStopped(callback) {
    this._stopListeners.add(callback);
    return () => {
      this._stopListeners.delete(callback);
    };
  }
}

export const trackingService = new TrackingService();

