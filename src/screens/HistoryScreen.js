import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../constants/colors';
import { getAttendanceRecords, clearAttendanceRecords } from '../storage/attendanceStorage';
import AttendanceItem from '../components/AttendanceItem';
import styles from '../styles/historyScreen.styles';

export default function HistoryScreen({ isFocused = true }) {
  const insets = useSafeAreaInsets();
  const [records, setRecords] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  const loadHistory = useCallback(async () => {
    try {
      setErrorMessage(null);
      const data = await getAttendanceRecords();
      setRecords(data);
    } catch (error) {
      setErrorMessage('Failed to load records from storage.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  // Standard React Navigation focus listener
  useFocusEffect(
    useCallback(() => {
      loadHistory();
    }, [loadHistory])
  );

  // Tab switch listener: immediately re-fetch records when user selects Records tab
  useEffect(() => {
    if (isFocused) {
      loadHistory();
    }
  }, [isFocused, loadHistory]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    loadHistory();
  };

  const handleClearHistory = () => {
    Alert.alert(
      'Clear All Attendance Records',
      'Are you sure you want to delete all saved attendance history? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            try {
              await clearAttendanceRecords();
              setRecords([]);
            } catch (error) {
              Alert.alert('Error', 'Failed to clear records.');
            }
          },
        },
      ]
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyBadge}>
        <Text style={styles.emptyIcon}>📋</Text>
      </View>
      <Text style={styles.emptyTitle}>No Attendance Records Yet</Text>
      <Text style={styles.emptySubtitle}>
        When you check in inside the 100m office geofence on the Attendance Desk, verified records with timestamps and GPS coordinates will appear here.
      </Text>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Top App Header */}
      <View
        style={{
          paddingTop: Math.max(insets.top, 12),
          paddingHorizontal: 16,
          paddingBottom: 14,
          backgroundColor: '#FFFFFF',
          borderBottomWidth: 1,
          borderBottomColor: '#E2E8F0',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
        <Text style={{ fontSize: 18, fontWeight: '800', color: '#0F172A' }}>
          📋 Attendance Records
        </Text>
        <Text style={{ fontSize: 12, fontWeight: '600', color: '#64748B' }}>
          Offline SQLite
        </Text>
      </View>

      {/* Stats Summary Bar */}
      {records.length > 0 && (
        <View style={styles.headerBar}>
          <View style={styles.headerTitleGroup}>
            <Text style={styles.headerIcon}>📑</Text>
            <Text style={styles.recordCountText}>
              {records.length} {records.length === 1 ? 'Record' : 'Records'} Logged
            </Text>
          </View>
          <TouchableOpacity
            style={styles.clearBtn}
            onPress={handleClearHistory}
            activeOpacity={0.75}>
            <Text style={styles.clearIcon}>🗑️</Text>
            <Text style={styles.clearText}>Clear All</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Summary Stats Header */}
      {records.length > 0 && (
        <View style={styles.statsCard}>
          <View style={styles.statCol}>
            <Text style={styles.statValue}>{records.length}</Text>
            <Text style={styles.statLabel}>Total Punches</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCol}>
            <Text style={[styles.statValue, { color: COLORS.success }]}>100%</Text>
            <Text style={styles.statLabel}>Geofence Pass</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCol}>
            <Text style={styles.statValue}>100m</Text>
            <Text style={styles.statLabel}>Zone Radius</Text>
          </View>
        </View>
      )}

      {errorMessage && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{errorMessage}</Text>
        </View>
      )}

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading attendance history...</Text>
        </View>
      ) : (
        <FlatList
          data={records}
          keyExtractor={item => item.id}
          renderItem={({ item }) => <AttendanceItem record={item} />}
          contentContainerStyle={
            records.length === 0 ? styles.emptyListContent : styles.listContent
          }
          ListEmptyComponent={renderEmptyState}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              colors={[COLORS.primary]}
              tintColor={COLORS.primary}
            />
          }
        />
      )}
    </View>
  );
}
