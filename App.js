import React, { useState } from 'react';
import { StatusBar } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/context/AuthContext';
import AppNavigator from './src/navigation/AppNavigator';
import SplashScreen from './src/components/SplashScreen';

export default function App() {
  const [isSplashVisible, setIsSplashVisible] = useState(true);

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar
          barStyle={isSplashVisible ? 'light-content' : 'dark-content'}
          backgroundColor={isSplashVisible ? '#0F172A' : '#FFFFFF'}
        />
        <NavigationContainer>
          <AppNavigator />
        </NavigationContainer>
        {isSplashVisible && (
          <SplashScreen onFinish={() => setIsSplashVisible(false)} />
        )}
      </AuthProvider>
    </SafeAreaProvider>
  );
}
