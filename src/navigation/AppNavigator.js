import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import StudentTabsScreen from '../screens/StudentTabsScreen';
import LoginScreen from '../screens/LoginScreen';
import RegisterScreen from '../screens/RegisterScreen';
import PendingApprovalScreen from '../screens/PendingApprovalScreen';
import { COLORS } from '../constants/colors';

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  const { user, isApproved } = useAuth();

  return (
    <Stack.Navigator
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
      {!user ? (
        // Unauthenticated Stack
        <>
          <Stack.Screen
            name="Login"
            component={LoginScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Register"
            component={RegisterScreen}
            options={{ headerShown: false }}
          />
        </>
      ) : !isApproved ? (
        // Pending Admin Approval
        <Stack.Screen
          name="PendingApproval"
          component={PendingApprovalScreen}
          options={{ headerShown: false }}
        />
      ) : (
        // Authenticated Student App with Bottom Navigation Bar
        <Stack.Screen
          name="StudentApp"
          component={StudentTabsScreen}
          options={{ headerShown: false }}
        />
      )}
    </Stack.Navigator>
  );
}
