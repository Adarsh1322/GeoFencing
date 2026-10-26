import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  Alert,
  Platform,
  PermissionsAndroid,
  Linking,
  ScrollView,
  AppState,
} from 'react-native';
import MapView, { Marker, Circle, PROVIDER_GOOGLE } from 'react-native-maps';
import Geolocation from 'react-native-geolocation-service';
import { OFFICE_LOCATION, GEOFENCE_RADIUS_METERS } from '../constants/geofence';
import { COLORS } from '../constants/colors';
import { calculateDistanceInMeters } from '../utils/distance';
import { saveAttendanceRecord } from '../storage/attendanceStorage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { safetyService } from '../services/safetyService';
import StatusCard from '../components/StatusCard';
import styles from '../styles/attendanceScreen.styles';

export default function AttendanceScreen({ navigation, onNavigateTab, isFocused = true }) {
  const insets = useSafeAreaInsets();
  const { user, accessToken, currentMembership, logout } = useAuth();
  const [currentLocation, setCurrentLocation] = useState(null);
  const [locationError, setLocationError] = useState(null);
  const [isLocating, setIsLocating] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [simulatedLocationMode, setSimulatedLocationMode] = useState(null);
  const [mapType, setMapType] = useState('standard');

  // Safety & Safe Campus Journey State
  const [activeJourney, setActiveJourney] = useState(null);
  const [isLocationSharing, setIsLocationSharing] = useState(true);
  const [trackedPointsCount, setTrackedPointsCount] = useState(0);
  const [isSosActive, setIsSosActive] = useState(false);
  const [isSosLoading, setIsSosLoading] = useState(false);
  const [journeyLoading, setJourneyLoading] = useState(false);

  const mapRef = useRef(null);
  const watchIdRef = useRef(null);
  const activeJourneyRef = useRef(null);
  const isLocationSharingRef = useRef(true);
  const seqNoRef = useRef(0);

  useEffect(() => {
    activeJourneyRef.current = activeJourney;
  }, [activeJourney]);

  useEffect(() => {
    isLocationSharingRef.current = isLocationSharing;
  }, [isLocationSharing]);

  // Restore active journey from SQLite when focused or student loaded
  useEffect(() => {
    if (isFocused && user?.id) {
      safetyService
        .getActiveJourney(user.id)
        .then(session => {
          setActiveJourney(session || null);
        })
        .catch(err => console.warn('Could not restore journey session:', err));
    }
  }, [isFocused, user?.id]);

  // Derive distance from office
  const effectiveLocation = simulatedLocationMode || currentLocation;
  const distanceFromOffice = effectiveLocation
    ? calculateDistanceInMeters(effectiveLocation, OFFICE_LOCATION)
    : null;

  const isInsideGeofence =
    distanceFromOffice !== null && distanceFromOffice <= GEOFENCE_RADIUS_METERS;

  const startWatchingLocation = useCallback(() => {
    setIsLocating(true);
    setLocationError(null);

    // Clean up any existing watcher before starting a new one
    if (watchIdRef.current !== null) {
      Geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    watchIdRef.current = Geolocation.watchPosition(
      position => {
        const coords = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        };
        setCurrentLocation(coords);
        setIsLocating(false);
        setLocationError(null);

        // If journey is active and location sharing is ON, record breadcrumb
        if (activeJourneyRef.current && isLocationSharingRef.current && user?.id) {
          seqNoRef.current += 1;
          safetyService
            .logBreadcrumb({
              sessionId: activeJourneyRef.current.id,
              studentUserId: user.id,
              coords,
              seqNo: seqNoRef.current,
              accessToken,
            })
            .then(() => {
              setTrackedPointsCount(prev => prev + 1);
            })
            .catch(err => {
              console.warn('Breadcrumb log error:', err.message);
            });
        }
      },
      error => {
        setIsLocating(false);
        let userMessage = 'Unable to determine your location.';
        if (error.code === 1) {
          userMessage = 'Location permission was denied. Please allow access in settings.';
        } else if (error.code === 2) {
          userMessage = 'GPS is disabled. Please turn on location services on your device.';
        } else if (error.code === 3) {
          userMessage = 'GPS request timed out. Retrying...';
        }
        setLocationError(userMessage);
      },
      {
        enableHighAccuracy: true,
        distanceFilter: 1, // update on 1 meter movement
        interval: 3000,
        fastestInterval: 2000,
        showsBackgroundLocationIndicator: false,
      }
    );
  }, [user?.id, accessToken]);

  const handleRequestLocationPermission = useCallback(
    async (isExplicitUserClick = false) => {
      try {
        if (Platform.OS === 'ios') {
          const authStatus = await Geolocation.requestAuthorization('whenInUse');
          if (authStatus === 'granted') {
            startWatchingLocation();
            return;
          }
          setIsLocating(false);
          setLocationError('Location permission denied. Please allow access in settings.');
          if (isExplicitUserClick) {
            Alert.alert(
              'Location Permission Required',
              'Office attendance requires location access to verify you are on-site. Please enable Location in device settings.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Open Settings', onPress: () => Linking.openSettings() },
              ]
            );
          }
          return;
        }

        if (Platform.OS === 'android') {
          const alreadyGranted = await PermissionsAndroid.check(
            PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
          );

          if (alreadyGranted) {
            startWatchingLocation();
            return;
          }

          // On Android 12+ (API 31+), Android requires requesting both FINE and COARSE
          // simultaneously so the native permission dialog displays properly.
          const permissionStatuses = await PermissionsAndroid.requestMultiple([
            PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
            PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
          ]);

          const fineStatus =
            permissionStatuses[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
          const coarseStatus =
            permissionStatuses[PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION];

          if (
            fineStatus === PermissionsAndroid.RESULTS.GRANTED ||
            coarseStatus === PermissionsAndroid.RESULTS.GRANTED
          ) {
            startWatchingLocation();
            return;
          }

          setIsLocating(false);
          setLocationError(
            'Location permission denied. Attendance cannot be verified without GPS.'
          );

          // Show the settings modal only when Android OS refuses to show the dialog (NEVER_ASK_AGAIN)
          if (fineStatus === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
            Alert.alert(
              'Location Permission Blocked',
              'Android has permanently disabled the permission prompt. Please enable Location in device Settings to record attendance.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Open Settings', onPress: () => Linking.openSettings() },
              ]
            );
          }
        }
      } catch (error) {
        setLocationError('Failed to request location permission.');
      }
    },
    [startWatchingLocation]
  );

  useEffect(() => {
    handleRequestLocationPermission(false);

    return () => {
      if (watchIdRef.current !== null) {
        Geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [handleRequestLocationPermission]);

  // Re-check permission automatically when user returns to app from device Settings
  useEffect(() => {
    const subscription = AppState.addEventListener('change', async nextAppState => {
      if (nextAppState === 'active') {
        if (Platform.OS === 'android') {
          const hasPermission = await PermissionsAndroid.check(
            PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
          );
          if (hasPermission && !watchIdRef.current) {
            startWatchingLocation();
          }
        }
      }
    });

    return () => {
      subscription.remove();
    };
  }, [startWatchingLocation]);

  const handleCheckIn = async () => {
    if (!effectiveLocation) {
      Alert.alert('Location Required', 'Acquiring GPS location. Please wait a moment and try again.');
      return;
    }

    if (!isInsideGeofence) {
      Alert.alert(
        'Outside Office Geofence',
        `You are currently ${distanceFromOffice}m away from the office. Check-in is only allowed within ${GEOFENCE_RADIUS_METERS}m.`
      );
      return;
    }

    try {
      setIsSubmitting(true);
      const newRecord = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        checkedInAt: new Date().toISOString(),
        latitude: effectiveLocation.latitude,
        longitude: effectiveLocation.longitude,
        distanceFromOffice,
        status: 'VERIFIED',
      };

      await saveAttendanceRecord(newRecord);

      Alert.alert(
        'Check-In Successful',
        `Attendance recorded at ${distanceFromOffice}m from the office.`,
        [
          {
            text: 'View History',
            onPress: () => (onNavigateTab ? onNavigateTab('history') : navigation?.navigate('HistoryTab')),
          },
          { text: 'Done', style: 'cancel' },
        ]
      );
    } catch (error) {
      Alert.alert('Storage Error', 'Could not save attendance record locally. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRecenter = () => {
    if (!mapRef.current) return;
    const target = effectiveLocation || OFFICE_LOCATION;
    mapRef.current.animateToRegion(
      {
        latitude: target.latitude,
        longitude: target.longitude,
        latitudeDelta: 0.005,
        longitudeDelta: 0.005,
      },
      800
    );
  };

  // Interview demo helper: simulate being inside (30m) or outside (250m)
  const setSimulatedCoords = (mode) => {
    if (mode === 'inside') {
      // 0.00025 degrees latitude ~ 28 meters away
      setSimulatedLocationMode({
        latitude: OFFICE_LOCATION.latitude + 0.00025,
        longitude: OFFICE_LOCATION.longitude,
        accuracy: 5,
      });
    } else if (mode === 'outside') {
      // 0.0022 degrees latitude ~ 245 meters away
      setSimulatedLocationMode({
        latitude: OFFICE_LOCATION.latitude + 0.0022,
        longitude: OFFICE_LOCATION.longitude,
        accuracy: 10,
      });
    } else {
      setSimulatedLocationMode(null);
    }
  };

  const toggleMapType = () => {
    setMapType(prev => (prev === 'standard' ? 'hybrid' : 'standard'));
  };

  const todayDateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  const campusId =
    currentMembership?.campus_id ||
    user?.campusId ||
    'a68adb66-5482-428e-8702-1b5dd3fc1c67';

  const handleToggleJourney = async () => {
    if (!user?.id) {
      Alert.alert('Authentication Required', 'Please sign in to track campus journeys.');
      return;
    }

    try {
      setJourneyLoading(true);
      if (activeJourney) {
        // End journey
        await safetyService.stopJourney({
          sessionId: activeJourney.id,
          studentUserId: user.id,
          accessToken,
        });
        setActiveJourney(null);
        Alert.alert(
          'Journey Ended',
          `Safe campus journey ended. Total breadcrumbs tracked: ${trackedPointsCount}`
        );
      } else {
        // Start journey
        const session = await safetyService.startJourney({
          campusId,
          studentUserId: user.id,
          accessToken,
        });
        setActiveJourney(session);
        seqNoRef.current = 0;
        setTrackedPointsCount(0);
        Alert.alert(
          'Safe Journey Started',
          'Offline tracking is active. Breadcrumbs will be saved locally in SQLite and synced when online.'
        );
      }
    } catch (err) {
      Alert.alert('Journey Error', err.message || 'Failed to update journey.');
    } finally {
      setJourneyLoading(false);
    }
  };

  const handleTriggerSos = () => {
    Alert.alert(
      '🚨 TRIGGER EMERGENCY SOS?',
      'This will immediately broadcast your GPS location to Campus Security and dispatch an emergency alert.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'CONFIRM SOS 🚨',
          style: 'destructive',
          onPress: async () => {
            try {
              setIsSosLoading(true);
              const result = await safetyService.triggerSos({
                campusId,
                studentUserId: user?.id,
                coords: effectiveLocation,
                accessToken,
                sessionId: activeJourney?.id || null,
              });
              setIsSosActive(true);
              Alert.alert(
                '🚨 SOS ALERT SENT',
                result.status === 'SERVER_RECEIVED'
                  ? 'Campus Security has received your emergency alert and coordinates!'
                  : 'SOS stored in local offline queue. Will sync immediately when connectivity resumes.',
                [{ text: 'OK' }]
              );
            } catch (err) {
              Alert.alert('SOS Error', 'Failed to dispatch SOS alert: ' + err.message);
            } finally {
              setIsSosLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleLogout = () => {
    Alert.alert(
      'Sign Out',
      `Are you sure you want to sign out from CampusSafe, ${user?.fullName || 'Student'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign Out', style: 'destructive', onPress: logout },
      ]
    );
  };

  return (
    <View style={styles.container}>
      {/* Top Branded App Header */}
      <View style={[styles.appHeader, { paddingTop: Math.max(insets.top, 12) }]}>
        <View style={styles.headerLeft}>
          <Image
            source={require('../assets/logo.png')}
            style={styles.headerLogo}
            resizeMode="contain"
          />
          <View>
            <Text style={styles.headerTitle}>{user?.fullName || 'Attendance Desk'}</Text>
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {user?.email || 'CampusSafe • 100m Zone'}
            </Text>
          </View>
        </View>

        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.headerLogoutBtn}
            onPress={handleLogout}
            activeOpacity={0.8}>
            <Text style={styles.headerLogoutText}>🚪 Logout</Text>
          </TouchableOpacity>
          <Text style={styles.dateText}>{todayDateStr}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        bounces={false}
        showsVerticalScrollIndicator={false}>
        
        {/* Interactive Map Card */}
        <View style={styles.mapContainer}>
          {/* Floating Top Controls */}
          <View style={styles.mapOverlayTop}>
            <TouchableOpacity
              style={styles.mapTypeToggle}
              onPress={toggleMapType}
              activeOpacity={0.8}>
              <Text style={styles.mapTypeToggleText}>
                {mapType === 'standard' ? '🛰️ Satellite' : '🗺️ Standard'}
              </Text>
            </TouchableOpacity>

            <View style={styles.zonePill}>
              <Text style={styles.zonePillText}>100m Geofence</Text>
            </View>
          </View>

          <MapView
            ref={mapRef}
            provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
            mapType={mapType}
            style={styles.map}
            initialRegion={{
              latitude: OFFICE_LOCATION.latitude,
              longitude: OFFICE_LOCATION.longitude,
              latitudeDelta: 0.006,
              longitudeDelta: 0.006,
            }}>
            {/* 100m Geofence Perimeter */}
            <Circle
              center={OFFICE_LOCATION}
              radius={GEOFENCE_RADIUS_METERS}
              fillColor="rgba(37, 99, 235, 0.16)"
              strokeColor={COLORS.primary}
              strokeWidth={2.5}
            />

            {/* Office Marker */}
            <Marker
              coordinate={OFFICE_LOCATION}
              title={OFFICE_LOCATION.title}
              description="100m Geofence Perimeter Zone"
              pinColor={COLORS.primary}
            />

            {/* User Location Marker */}
            {effectiveLocation && (
              <Marker
                coordinate={{
                  latitude: effectiveLocation.latitude,
                  longitude: effectiveLocation.longitude,
                }}
                title="Your Location"
                description={
                  isInsideGeofence
                    ? 'Inside Geofence'
                    : `${distanceFromOffice}m from office`
                }
                pinColor={isInsideGeofence ? COLORS.success : COLORS.danger}
              />
            )}
          </MapView>

          {/* Floating Recenter Button */}
          <TouchableOpacity
            style={styles.recenterButton}
            onPress={handleRecenter}
            activeOpacity={0.85}>
            <Text style={styles.recenterButtonText}>🎯 Center</Text>
          </TouchableOpacity>
        </View>

        {/* Interviewer Simulation Mode Panel */}
        <View style={styles.demoContainer}>
          <View style={styles.demoHeader}>
            <View style={styles.demoTitleGroup}>
              <Text style={styles.demoIcon}>🛠️</Text>
              <Text style={styles.demoLabel}>Interviewer Test Controls</Text>
            </View>
            <View style={styles.demoBadge}>
              <Text style={styles.demoBadgeText}>Simulate</Text>
            </View>
          </View>

          <View style={styles.demoTabsRow}>
            <TouchableOpacity
              style={[
                styles.demoTab,
                simulatedLocationMode === null && styles.demoTabActive,
              ]}
              onPress={() => setSimulatedCoords('gps')}>
              <Text
                style={[
                  styles.demoTabText,
                  simulatedLocationMode === null && styles.demoTabTextActive,
                ]}>
                📡 Live GPS
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.demoTab,
                simulatedLocationMode?.accuracy === 5 && styles.demoTabActive,
              ]}
              onPress={() => setSimulatedCoords('inside')}>
              <Text
                style={[
                  styles.demoTabText,
                  simulatedLocationMode?.accuracy === 5 && styles.demoTabTextActive,
                ]}>
                🟢 Inside (28m)
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.demoTab,
                simulatedLocationMode?.accuracy === 10 && styles.demoTabActive,
              ]}
              onPress={() => setSimulatedCoords('outside')}>
              <Text
                style={[
                  styles.demoTabText,
                  simulatedLocationMode?.accuracy === 10 && styles.demoTabTextActive,
                ]}>
                🔴 Outside (245m)
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Error / Permission Banner */}
        {locationError && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{locationError}</Text>
            <View style={styles.errorActionRow}>
              <TouchableOpacity
                style={styles.errorActionBtn}
                onPress={() => handleRequestLocationPermission(true)}>
                <Text style={styles.errorActionBtnText}>Retry Permission</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.errorActionBtn}
                onPress={() => Linking.openSettings()}>
                <Text style={styles.errorActionBtnText}>Open Settings</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Live Status Card */}
        <StatusCard
          currentLocation={effectiveLocation}
          distanceFromOffice={distanceFromOffice}
          isInsideGeofence={isInsideGeofence}
          isLocating={isLocating && !simulatedLocationMode}
          officeLocation={OFFICE_LOCATION}
        />

        {/* Action Buttons */}
        <View style={styles.actionsContainer}>
          <TouchableOpacity
            style={[
              styles.checkInButton,
              (!isInsideGeofence || isSubmitting) && styles.checkInButtonDisabled,
            ]}
            onPress={handleCheckIn}
            disabled={!isInsideGeofence || isSubmitting}
            activeOpacity={0.85}>
            <Text style={styles.checkInButtonIcon}>
              {isInsideGeofence ? '✓' : '🔒'}
            </Text>
            <Text style={styles.checkInButtonText}>
              {isSubmitting
                ? 'RECORDING ATTENDANCE...'
                : isInsideGeofence
                ? 'PUNCH ATTENDANCE NOW'
                : 'ENTER 100M ZONE TO PUNCH'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.historyButton}
            onPress={() => (onNavigateTab ? onNavigateTab('history') : navigation?.navigate('HistoryTab'))}
            activeOpacity={0.85}>
            <View style={styles.historyButtonLeft}>
              <Text style={styles.historyButtonIcon}>📋</Text>
              <Text style={styles.historyButtonText}>View Attendance Logs</Text>
            </View>
            <Text style={styles.historyButtonArrow}>›</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </View>
  );
}

