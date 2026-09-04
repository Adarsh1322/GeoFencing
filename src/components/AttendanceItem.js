import React from 'react';
import { View, Text } from 'react-native';
import { formatDate, formatTime } from '../utils/dateFormatter';
import styles from '../styles/attendanceItem.styles';

export default function AttendanceItem({ record }) {
  const { checkedInAt, latitude, longitude, distanceFromOffice } = record;

  return (
    <View style={styles.container}>
      {/* Top Row: Date/Time + Verified Badge */}
      <View style={styles.topRow}>
        <View style={styles.dateTimeGroup}>
          <Text style={styles.calendarIcon}>📅</Text>
          <View>
            <Text style={styles.dateText}>{formatDate(checkedInAt)}</Text>
            <Text style={styles.timeText}>🕒 {formatTime(checkedInAt)}</Text>
          </View>
        </View>

        <View style={styles.statusBadge}>
          <Text style={styles.statusIcon}>🛡️</Text>
          <Text style={styles.statusText}>VERIFIED</Text>
        </View>
      </View>

      {/* Details Row: Distance + Coordinates Chips */}
      <View style={styles.detailsRow}>
        <View style={styles.detailChip}>
          <Text style={styles.detailIcon}>📍</Text>
          <Text style={styles.detailLabel}>Distance:</Text>
          <Text style={styles.detailValue}>
            {distanceFromOffice !== undefined ? `${distanceFromOffice}m` : '--'}
          </Text>
        </View>

        <View style={styles.detailChip}>
          <Text style={styles.detailIcon}>🛰️</Text>
          <Text style={styles.detailValue}>
            {latitude?.toFixed(4)}, {longitude?.toFixed(4)}
          </Text>
        </View>
      </View>
    </View>
  );
}
