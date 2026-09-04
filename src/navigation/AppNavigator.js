import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AttendanceScreen from '../screens/AttendanceScreen';
import HistoryScreen from '../screens/HistoryScreen';
import { COLORS } from '../constants/colors';

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="Attendance"
      screenOptions={{
        headerStyle: {
          backgroundColor: COLORS.surface,
        },
        headerTintColor: COLORS.primary,
        headerTitleStyle: {
          fontWeight: '800',
          color: COLORS.textPrimary,
        },
        headerShadowVisible: true,
        contentStyle: {
          backgroundColor: COLORS.background,
        },
      }}>
      <Stack.Screen
        name="Attendance"
        component={AttendanceScreen}
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="History"
        component={HistoryScreen}
        options={{
          title: 'Attendance Records',
          headerBackTitle: 'Desk',
        }}
      />
    </Stack.Navigator>
  );
}
