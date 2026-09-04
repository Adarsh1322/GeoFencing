import React, { useEffect, useRef } from 'react';
import { View, Text, Animated } from 'react-native';
import styles from '../styles/geofenceBadge.styles';

export default function GeofenceBadge({ isInsideGeofence, isLocating }) {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.35,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  if (isLocating) {
    return (
      <View style={[styles.badge, styles.locatingBadge]}>
        <Animated.View style={[styles.dot, styles.locatingDot, { opacity: pulseAnim }]} />
        <Text style={[styles.text, styles.locatingText]}>ACQUIRING GPS...</Text>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.badge,
        isInsideGeofence ? styles.insideBadge : styles.outsideBadge,
      ]}>
      <Animated.View
        style={[
          styles.dot,
          isInsideGeofence ? styles.insideDot : styles.outsideDot,
          { opacity: pulseAnim },
        ]}
      />
      <Text
        style={[
          styles.text,
          isInsideGeofence ? styles.insideText : styles.outsideText,
        ]}>
        {isInsideGeofence ? 'INSIDE 100M ZONE' : 'OUTSIDE 100M ZONE'}
      </Text>
    </View>
  );
}
