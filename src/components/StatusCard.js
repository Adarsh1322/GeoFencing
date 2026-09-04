import React from 'react';
import { View, Text } from 'react-native';
import { GEOFENCE_RADIUS_METERS } from '../constants/geofence';
import GeofenceBadge from './GeofenceBadge';
import styles from '../styles/statusCard.styles';

export default function StatusCard({
  currentLocation,
  distanceFromOffice,
  isInsideGeofence,
  isLocating,
  officeLocation,
}) {
  const formattedDistance =
    distanceFromOffice !== null
      ? distanceFromOffice >= 1000
        ? `${(distanceFromOffice / 1000).toFixed(2)} km`
        : `${distanceFromOffice} m`
      : '--';

  const exactMetersSub =
    distanceFromOffice !== null && distanceFromOffice >= 1000
      ? `${distanceFromOffice}m exact`
      : 'from center';

  return (
    <View style={styles.card}>
      {/* Office Header */}
      <View style={styles.headerRow}>
        <View style={styles.officeInfoContainer}>
          <View style={styles.officeIconBadge}>
            <Text style={styles.officeIcon}>🏢</Text>
          </View>
          <View style={styles.officeTextGroup}>
            <Text style={styles.officeTitle} numberOfLines={1}>
              {officeLocation.title}
            </Text>
            <Text style={styles.officeSubtitle} numberOfLines={1}>
              {officeLocation.address}
            </Text>
          </View>
        </View>
        <GeofenceBadge isInsideGeofence={isInsideGeofence} isLocating={isLocating} />
      </View>

      <View style={styles.separator} />

      {/* Metric Tiles Grid */}
      <View style={styles.metricsGrid}>
        <View style={styles.metricCard}>
          <View style={styles.metricHeader}>
            <Text style={styles.metricLabel}>📍 Current Distance</Text>
          </View>
          <Text
            style={[
              styles.metricValue,
              isInsideGeofence ? styles.metricValueInside : styles.metricValueOutside,
            ]}>
            {formattedDistance}
          </Text>
          <Text style={styles.metricSub}>{exactMetersSub}</Text>
        </View>

        <View style={styles.metricCard}>
          <View style={styles.metricHeader}>
            <Text style={styles.metricLabel}>🎯 Allowed Zone</Text>
          </View>
          <Text style={styles.metricValue}>≤ {GEOFENCE_RADIUS_METERS} m</Text>
          <Text style={styles.metricSub}>check-in boundary</Text>
        </View>
      </View>

      {/* GPS Telemetry Bar */}
      <View style={styles.gpsTelemetryBar}>
        <View style={styles.gpsCoordsGroup}>
          <Text style={styles.gpsIcon}>🛰️</Text>
          <Text style={styles.gpsCoordsText}>
            {currentLocation
              ? `${currentLocation.latitude.toFixed(5)}, ${currentLocation.longitude.toFixed(5)}`
              : 'Acquiring GPS fix...'}
          </Text>
        </View>
        {currentLocation?.accuracy && (
          <View style={styles.gpsAccuracyBadge}>
            <Text style={styles.gpsAccuracyText}>
              ±{Math.round(currentLocation.accuracy)}m accuracy
            </Text>
          </View>
        )}
      </View>

      {/* Dynamic Action Guidance Pill */}
      <View
        style={[
          styles.hintContainer,
          isInsideGeofence ? styles.hintInside : styles.hintOutside,
        ]}>
        <Text style={styles.hintIcon}>{isInsideGeofence ? '✓' : '⚠️'}</Text>
        <Text
          style={[
            styles.hintText,
            isInsideGeofence ? styles.hintTextInside : styles.hintTextOutside,
          ]}>
          {isLocating
            ? 'Acquiring high-accuracy GPS signal. Please keep location ON.'
            : isInsideGeofence
            ? 'Verified inside boundary. You are ready to log attendance.'
            : `You are ${
                distanceFromOffice !== null
                  ? distanceFromOffice >= 1000
                    ? `${(distanceFromOffice / 1000).toFixed(2)} km`
                    : `${distanceFromOffice - GEOFENCE_RADIUS_METERS}m`
                  : ''
              } outside the perimeter. Please move inside 100m.`}
        </Text>
      </View>
    </View>
  );
}
