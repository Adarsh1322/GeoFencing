import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AttendanceScreen from './AttendanceScreen';
import SafetyScreen from './SafetyScreen';
import HistoryScreen from './HistoryScreen';

export default function StudentTabsScreen() {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState('attendance');

  return (
    <View style={styles.container}>
      {/* Screen Views - Preserved in Memory for Persistent GPS Tracking */}
      <View style={[styles.screenContainer, activeTab !== 'attendance' && styles.hidden]}>
        <AttendanceScreen
          isFocused={activeTab === 'attendance'}
          onNavigateTab={setActiveTab}
        />
      </View>

      <View style={[styles.screenContainer, activeTab !== 'safety' && styles.hidden]}>
        <SafetyScreen
          isFocused={activeTab === 'safety'}
          onNavigateTab={setActiveTab}
        />
      </View>

      <View style={[styles.screenContainer, activeTab !== 'history' && styles.hidden]}>
        <HistoryScreen
          isFocused={activeTab === 'history'}
          onNavigateTab={setActiveTab}
        />
      </View>

      {/* Enterprise Bottom Tab Bar */}
      <View
        style={[
          styles.tabBar,
          {
            paddingBottom: Math.max(insets.bottom, 8),
            height: 60 + Math.max(insets.bottom, 8),
          },
        ]}>
        {/* Tab 1: Attendance */}
        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'attendance' && styles.tabItemActive]}
          onPress={() => setActiveTab('attendance')}
          activeOpacity={0.75}>
          <Text style={[styles.tabIcon, activeTab === 'attendance' && styles.tabIconActive]}>
            📍
          </Text>
          <Text
            style={[styles.tabLabel, activeTab === 'attendance' && styles.tabLabelActive]}>
            Attendance
          </Text>
        </TouchableOpacity>

        {/* Tab 2: Safety & SOS */}
        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'safety' && styles.tabItemActive]}
          onPress={() => setActiveTab('safety')}
          activeOpacity={0.75}>
          <Text style={[styles.tabIcon, activeTab === 'safety' && styles.tabIconActive]}>
            🛡️
          </Text>
          <Text style={[styles.tabLabel, activeTab === 'safety' && styles.tabLabelActive]}>
            Safety & SOS
          </Text>
        </TouchableOpacity>

        {/* Tab 3: Records */}
        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'history' && styles.tabItemActive]}
          onPress={() => setActiveTab('history')}
          activeOpacity={0.75}>
          <Text style={[styles.tabIcon, activeTab === 'history' && styles.tabIconActive]}>
            📋
          </Text>
          <Text style={[styles.tabLabel, activeTab === 'history' && styles.tabLabelActive]}>
            Records
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  screenContainer: {
    flex: 1,
  },
  hidden: {
    display: 'none',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1.5,
    borderTopColor: '#E2E8F0',
    paddingTop: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'space-around',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 10,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    borderRadius: 12,
  },
  tabItemActive: {
    backgroundColor: '#EFF6FF',
  },
  tabIcon: {
    fontSize: 20,
    marginBottom: 2,
  },
  tabIconActive: {
    transform: [{ scale: 1.15 }],
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
  },
  tabLabelActive: {
    color: '#2563EB',
    fontWeight: '800',
  },
});
