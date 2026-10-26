import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  ScrollView,
  Platform,
  PermissionsAndroid,
  Linking,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Geolocation from 'react-native-geolocation-service';
import { useAuth } from '../context/AuthContext';
import { safetyService } from '../services/safetyService';
import { OFFICE_LOCATION, GEOFENCE_RADIUS_METERS } from '../constants/geofence';
import { calculateDistanceInMeters } from '../utils/distance';
import styles from '../styles/safetyScreen.styles';

export default function SafetyScreen({ isFocused = true }) {
  const insets = useSafeAreaInsets();
  const { user, accessToken, currentMembership, logout } = useAuth();
  const [currentLocation, setCurrentLocation] = useState(null);
  const [activeJourney, setActiveJourney] = useState(null);
  const [isLocationSharing, setIsLocationSharing] = useState(true);
  const [trackedPointsCount, setTrackedPointsCount] = useState(0);
  const [isSosActive, setIsSosActive] = useState(false);
  const [isSosLoading, setIsSosLoading] = useState(false);
  const [journeyLoading, setJourneyLoading] = useState(false);

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

  const refreshSafetyData = useCallback(() => {
    if (user?.id) {
      safetyService
        .getActiveJourney(user.id)
        .then(session => {
          if (session) {
            setActiveJourney(session);
          } else {
            setActiveJourney(null);
          }
        })
        .catch(err => console.warn('Could not restore journey session:', err));
    }
  }, [user?.id]);

  // Refresh safety session whenever this tab gains focus
  useFocusEffect(
    useCallback(() => {
      refreshSafetyData();
    }, [refreshSafetyData])
  );

  useEffect(() => {
    if (isFocused) {
      refreshSafetyData();
    }
  }, [isFocused, refreshSafetyData]);

  // Location watching for safety tracking
  const startWatching = useCallback(() => {
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
            .catch(() => {});
        }
      },
      err => {
        console.warn('Safety geolocation error:', err.message);
      },
      {
        enableHighAccuracy: true,
        distanceFilter: 1,
        interval: 3000,
        fastestInterval: 2000,
      }
    );
  }, [user?.id, accessToken]);

  useEffect(() => {
    const initLocation = async () => {
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.check(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
        );
        if (granted) {
          startWatching();
        }
      } else {
        startWatching();
      }
    };
    initLocation();

    return () => {
      if (watchIdRef.current !== null) {
        Geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [startWatching]);

  const campusId =
    currentMembership?.campus_id ||
    user?.campusId ||
    'a68adb66-5482-428e-8702-1b5dd3fc1c67';

  const distanceFromCampus = currentLocation
    ? calculateDistanceInMeters(currentLocation, OFFICE_LOCATION)
    : null;
  const isInside =
    distanceFromCampus !== null && distanceFromCampus <= GEOFENCE_RADIUS_METERS;

  const handleToggleJourney = async () => {
    if (!user?.id) {
      Alert.alert('Authentication Required', 'Please sign in to track campus journeys.');
      return;
    }

    try {
      setJourneyLoading(true);
      if (activeJourney) {
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
                coords: currentLocation,
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

  const handleCallHelpline = () => {
    Alert.alert(
      'Emergency Call',
      'Call Campus Emergency Patrol (112)?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Call Now',
          onPress: () => {
            Linking.openURL('tel:112').catch(() => {
              Alert.alert('Dialer Error', 'Could not open phone dialer.');
            });
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
      {/* Top Header */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 14) }]}>
        <View>
          <Text style={styles.headerTitle}>Campus Safety</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {user?.fullName || 'Student'} • {user?.email || 'CampusSafe'}
          </Text>
        </View>

        <TouchableOpacity
          style={styles.logoutBtn}
          onPress={handleLogout}
          activeOpacity={0.8}>
          <Text style={styles.logoutBtnText}>🚪 Logout</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        bounces={false}
        showsVerticalScrollIndicator={false}>
        
        {/* Emergency SOS Card */}
        <View style={styles.sosCard}>
          <View style={styles.sosHeaderRow}>
            <View style={styles.sosBadge}>
              <Text style={styles.sosBadgeText}>EMERGENCY ALERT</Text>
            </View>
            <View style={styles.sosLiveDot} />
          </View>

          {isSosActive && (
            <View style={styles.sosActiveBanner}>
              <Text style={styles.sosActiveBannerText}>🚨 SOS BROADCAST ACTIVE</Text>
            </View>
          )}

          <Text style={styles.sosTitle}>Need Immediate Help?</Text>
          <Text style={styles.sosDescription}>
            Broadcasts your real-time coordinates to Campus Security & Patrol. Works offline & online.
          </Text>

          <TouchableOpacity
            style={styles.sosButton}
            onPress={handleTriggerSos}
            disabled={isSosLoading}
            activeOpacity={0.85}>
            <Text style={styles.sosButtonText}>
              {isSosLoading ? 'TRANSMITTING SOS...' : '🚨 TRIGGER EMERGENCY SOS'}
            </Text>
          </TouchableOpacity>
          <Text style={styles.sosSubNotice}>
            Pruning-immune SQLite queue • Auto-syncs on network restore
          </Text>
        </View>

        {/* Safe Campus Journey Card */}
        <View style={styles.journeyCard}>
          <View style={styles.journeyHeaderRow}>
            <Text style={styles.journeyTitle}>Safe Campus Journey</Text>
            <View
              style={[
                styles.statusPill,
                activeJourney && styles.statusPillActive,
              ]}>
              <Text
                style={[
                  styles.statusPillText,
                  activeJourney && styles.statusPillTextActive,
                ]}>
                {activeJourney ? '🟢 Active Tracking' : '⚪ Standby'}
              </Text>
            </View>
          </View>

          {/* Live Location Sharing Row */}
          <View style={styles.sharingRow}>
            <View style={styles.sharingInfo}>
              <Text style={styles.sharingTitle}>Live Location Sharing</Text>
              <Text style={styles.sharingSubtitle}>
                {isLocationSharing
                  ? 'Recording high-frequency GPS breadcrumbs'
                  : 'Location sharing currently paused'}
              </Text>
            </View>
            <TouchableOpacity
              style={[
                styles.switchBtn,
                isLocationSharing && styles.switchBtnActive,
              ]}
              onPress={() => setIsLocationSharing(prev => !prev)}
              activeOpacity={0.8}>
              <Text
                style={[
                  styles.switchBtnText,
                  isLocationSharing && styles.switchBtnTextActive,
                ]}>
                {isLocationSharing ? 'ON' : 'OFF'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Metrics Grid */}
          <View style={styles.metricsGrid}>
            <View style={styles.metricTile}>
              <Text style={styles.metricLabel}>Points Logged</Text>
              <Text style={styles.metricValue}>{trackedPointsCount}</Text>
            </View>
            <View style={styles.metricTile}>
              <Text style={styles.metricLabel}>GPS Accuracy</Text>
              <Text style={styles.metricValue}>
                {currentLocation?.accuracy ? `±${Math.round(currentLocation.accuracy)}m` : 'Acquiring'}
              </Text>
            </View>
            <View style={styles.metricTile}>
              <Text style={styles.metricLabel}>Campus Zone</Text>
              <Text
                style={[
                  styles.metricValue,
                  { color: isInside ? '#059669' : '#DC2626' },
                ]}>
                {isInside ? 'Inside' : 'Outside'}
              </Text>
            </View>
          </View>

          {/* Action CTA Button */}
          {activeJourney ? (
            <TouchableOpacity
              style={styles.endBtn}
              onPress={handleToggleJourney}
              disabled={journeyLoading}
              activeOpacity={0.85}>
              <Text style={styles.endBtnText}>
                {journeyLoading ? 'PLEASE WAIT...' : '⏹️ End Safe Journey'}
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.startBtn}
              onPress={handleToggleJourney}
              disabled={journeyLoading}
              activeOpacity={0.85}>
              <Text style={styles.startBtnText}>
                {journeyLoading ? 'PLEASE WAIT...' : '🚀 Start Safe Journey'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* 24/7 Security Helpline Card */}
        <View style={styles.helplineCard}>
          <View style={styles.helplineLeft}>
            <Text style={styles.helplineIcon}>📞</Text>
            <View>
              <Text style={styles.helplineTitle}>Campus Security Desk</Text>
              <Text style={styles.helplineSubtitle}>24/7 Emergency Patrol Control</Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.helplineCallBtn}
            onPress={handleCallHelpline}
            activeOpacity={0.8}>
            <Text style={styles.helplineCallBtnText}>Call 112</Text>
          </TouchableOpacity>
        </View>

        {/* Guarantee Badge */}
        <View style={styles.guaranteeBadge}>
          <Text style={styles.guaranteeText}>
            🔒 Local Encrypted SQLite Active • Zero Data Loss
          </Text>
        </View>

      </ScrollView>
    </View>
  );
}
