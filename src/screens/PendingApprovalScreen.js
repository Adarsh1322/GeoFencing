import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { COLORS } from '../constants/colors';

export default function PendingApprovalScreen() {
  const { user, currentMembership, refreshProfile, logout } = useAuth();
  const [checking, setChecking] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  const handleCheckStatus = async () => {
    setChecking(true);
    setStatusMessage('');
    try {
      const res = await refreshProfile();
      const updatedMem = res?.memberships?.[0];
      if (updatedMem?.status === 'ACTIVE') {
        setStatusMessage('Congratulations! Your account is approved.');
      } else {
        setStatusMessage('Status is still Pending Approval. Please contact your campus admin.');
      }
    } catch {
      setStatusMessage('Unable to connect to server. Check your internet connection.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0F172A" />
      <View style={styles.content}>
        
        {/* Status Icon */}
        <View style={styles.iconCircle}>
          <Text style={styles.hourglassIcon}>⏳</Text>
        </View>

        <Text style={styles.title}>Membership Verification</Text>
        <Text style={styles.subtitle}>
          Your student account has been created and is awaiting administrator verification.
        </Text>

        {/* Details Card */}
        <View style={styles.card}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Student Name</Text>
            <Text style={styles.detailValue}>{user?.fullName || 'Student'}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Institutional Email</Text>
            <Text style={styles.detailValue}>{user?.email}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Roll Number</Text>
            <Text style={styles.detailValue}>
              {currentMembership?.roll_number || 'Pending'}
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Membership Status</Text>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>PENDING APPROVAL</Text>
            </View>
          </View>
        </View>

        {statusMessage ? (
          <View style={styles.statusBanner}>
            <Text style={styles.statusText}>{statusMessage}</Text>
          </View>
        ) : null}

        {/* Check Status Button */}
        <TouchableOpacity
          style={styles.refreshButton}
          onPress={handleCheckStatus}
          disabled={checking}>
          {checking ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text style={styles.refreshButtonText}>Refresh Approval Status</Text>
          )}
        </TouchableOpacity>

        {/* Logout Button */}
        <TouchableOpacity style={styles.logoutButton} onPress={logout}>
          <Text style={styles.logoutButtonText}>Log Out / Switch Account</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderWidth: 2,
    borderColor: '#F59E0B',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  hourglassIcon: {
    fontSize: 36,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#94A3B8',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 24,
    lineHeight: 20,
  },
  card: {
    width: '100%',
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 20,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  detailLabel: {
    fontSize: 13,
    color: '#94A3B8',
    fontWeight: '600',
  },
  detailValue: {
    fontSize: 14,
    color: '#F8FAFC',
    fontWeight: '700',
  },
  divider: {
    height: 1,
    backgroundColor: '#334155',
    marginVertical: 4,
  },
  badge: {
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    borderWidth: 1,
    borderColor: '#F59E0B',
    borderRadius: 8,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  badgeText: {
    color: '#FBBF24',
    fontSize: 11,
    fontWeight: '800',
  },
  statusBanner: {
    backgroundColor: '#334155',
    borderRadius: 10,
    padding: 12,
    width: '100%',
    marginBottom: 16,
  },
  statusText: {
    color: '#E2E8F0',
    fontSize: 13,
    textAlign: 'center',
    fontWeight: '600',
  },
  refreshButton: {
    backgroundColor: '#2563EB',
    width: '100%',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  refreshButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  logoutButton: {
    width: '100%',
    paddingVertical: 12,
    alignItems: 'center',
  },
  logoutButtonText: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '700',
  },
});
