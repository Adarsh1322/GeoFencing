import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { COLORS } from '../constants/colors';

const AVAILABLE_CAMPUSES = [
  { code: 'LPU', name: 'Lovely Professional University (LPU)' },
  { code: 'MPI', name: 'Metro Polytechnic Inst (MPI)' },
];

export default function RegisterScreen({ navigation }) {
  const { register } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rollNumber, setRollNumber] = useState('');
  const [campusCode, setCampusCode] = useState('LPU');
  const [phone, setPhone] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleRegister = async () => {
    if (!fullName.trim() || !email.trim() || !password || !rollNumber.trim()) {
      setErrorMsg('Full Name, Email, Password, and Roll Number are required.');
      return;
    }
    if (password.length < 8) {
      setErrorMsg('Password must be at least 8 characters long.');
      return;
    }

    setErrorMsg('');
    setLoading(true);
    try {
      await register({
        fullName,
        email,
        password,
        rollNumber,
        campusCode,
        phone,
      });
      // Registration successful! The AuthContext will update user state automatically.
    } catch (err) {
      setErrorMsg(err.message || 'Registration failed. Please check your information.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0F172A" />
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled">
          
          {/* Header Hero */}
          <View style={styles.heroSection}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => navigation.goBack()}>
              <Text style={styles.backButtonText}>← Back to Login</Text>
            </TouchableOpacity>
            <Text style={styles.heroTitle}>Student Onboarding</Text>
            <Text style={styles.heroSubtitle}>
              Register for verified campus geofence safety
            </Text>
          </View>

          {/* Form Card */}
          <View style={styles.card}>
            {errorMsg ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorIcon}>⚠️</Text>
                <Text style={styles.errorText}>{errorMsg}</Text>
              </View>
            ) : null}

            {/* Notice */}
            <View style={styles.infoBanner}>
              <Text style={styles.infoText}>
                ℹ️ Student accounts are created in <Text style={styles.boldText}>Pending Approval</Text> status until verified by Campus Administrators.
              </Text>
            </View>

            {/* Full Name */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Full Name *</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Aarav Patel"
                placeholderTextColor={COLORS.textMuted}
                autoCapitalize="words"
                value={fullName}
                onChangeText={(t) => {
                  setFullName(t);
                  if (errorMsg) setErrorMsg('');
                }}
              />
            </View>

            {/* Institutional Email */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Institutional Email *</Text>
              <TextInput
                style={styles.input}
                placeholder="student@campussafe.edu"
                placeholderTextColor={COLORS.textMuted}
                autoCapitalize="none"
                keyboardType="email-address"
                autoCorrect={false}
                value={email}
                onChangeText={(t) => {
                  setEmail(t);
                  if (errorMsg) setErrorMsg('');
                }}
              />
            </View>

            {/* Roll Number */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Roll Number / Student ID *</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. MCA2026-005"
                placeholderTextColor={COLORS.textMuted}
                autoCapitalize="characters"
                value={rollNumber}
                onChangeText={(t) => {
                  setRollNumber(t);
                  if (errorMsg) setErrorMsg('');
                }}
              />
            </View>

            {/* Campus Selector */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Select Campus *</Text>
              <View style={styles.campusOptionsRow}>
                {AVAILABLE_CAMPUSES.map((camp) => (
                  <TouchableOpacity
                    key={camp.code}
                    style={[
                      styles.campusChip,
                      campusCode === camp.code && styles.campusChipActive,
                    ]}
                    onPress={() => setCampusCode(camp.code)}>
                    <Text
                      style={[
                        styles.campusChipText,
                        campusCode === camp.code && styles.campusChipTextActive,
                      ]}>
                      {camp.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Password */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Password (Min 8 Characters) *</Text>
              <View style={styles.passwordWrapper}>
                <TextInput
                  style={[styles.input, styles.passwordInput]}
                  placeholder="Create a strong password"
                  placeholderTextColor={COLORS.textMuted}
                  secureTextEntry={!showPassword}
                  value={password}
                  onChangeText={(t) => {
                    setPassword(t);
                    if (errorMsg) setErrorMsg('');
                  }}
                />
                <TouchableOpacity
                  style={styles.eyeButton}
                  onPress={() => setShowPassword(!showPassword)}>
                  <Text style={styles.eyeText}>{showPassword ? 'Hide' : 'Show'}</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Phone (Optional) */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Emergency Phone (Optional)</Text>
              <TextInput
                style={styles.input}
                placeholder="+91 9876543210"
                placeholderTextColor={COLORS.textMuted}
                keyboardType="phone-pad"
                value={phone}
                onChangeText={setPhone}
              />
            </View>

            {/* Submit Button */}
            <TouchableOpacity
              style={[styles.submitButton, loading && styles.submitButtonDisabled]}
              onPress={handleRegister}
              disabled={loading}>
              {loading ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.submitButtonText}>Complete Registration</Text>
              )}
            </TouchableOpacity>

            {/* Back to Login */}
            <View style={styles.footerRow}>
              <Text style={styles.footerText}>Already have an account? </Text>
              <TouchableOpacity onPress={() => navigation.navigate('Login')}>
                <Text style={styles.footerLink}>Sign In</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  heroSection: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 20,
  },
  backButton: {
    marginBottom: 12,
  },
  backButtonText: {
    color: '#60A5FA',
    fontSize: 14,
    fontWeight: '700',
  },
  heroTitle: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  heroSubtitle: {
    color: '#94A3B8',
    fontSize: 13,
    marginTop: 4,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 36,
    flex: 1,
  },
  infoBanner: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  infoText: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 17,
  },
  boldText: {
    fontWeight: '700',
    color: '#1E293B',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  errorIcon: {
    marginRight: 8,
    fontSize: 16,
  },
  errorText: {
    color: '#DC2626',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  inputGroup: {
    marginBottom: 14,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 14,
    color: '#0F172A',
  },
  campusOptionsRow: {
    gap: 8,
  },
  campusChip: {
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#F8FAFC',
  },
  campusChipActive: {
    borderColor: '#2563EB',
    backgroundColor: '#EFF6FF',
  },
  campusChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  campusChipTextActive: {
    color: '#1D4ED8',
    fontWeight: '800',
  },
  passwordWrapper: {
    position: 'relative',
    justifyContent: 'center',
  },
  passwordInput: {
    paddingRight: 60,
  },
  eyeButton: {
    position: 'absolute',
    right: 14,
    paddingVertical: 6,
  },
  eyeText: {
    color: '#2563EB',
    fontSize: 13,
    fontWeight: '700',
  },
  submitButton: {
    backgroundColor: '#2563EB',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
    shadowColor: '#2563EB',
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 4,
  },
  submitButtonDisabled: {
    backgroundColor: '#93C5FD',
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 10,
  },
  footerText: {
    fontSize: 13,
    color: '#64748B',
  },
  footerLink: {
    fontSize: 13,
    fontWeight: '800',
    color: '#2563EB',
  },
});
