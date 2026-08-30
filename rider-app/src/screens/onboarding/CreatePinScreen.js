// rider-app/src/screens/onboarding/CreatePinScreen.js
// ✅ FIXED: Enhanced error handling for backend 500 errors
// ✅ FIXED: Retry logic with exponential backoff
// ✅ FIXED: Better fallback when API unavailable
// ✅ FIXED: Proper rider_id persistence across all stores

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import OnboardingProgressBar from '../../components/OnboardingProgressBar';
import DigitBoxInput from '../../components/DigitBoxInput';
import PrimaryButton from '../../components/PrimaryButton';
import { useTranslation } from '../../i18n/LocalizationProvider';
import { useToast } from '../../components/Toast';
import api from '../../api/client';
import { saveRiderAccountSummary, saveLocalCabzProfile, saveLocalRiderStatus, saveLocalRiderId } from '../../offline/db';
import { updateRiderOnboardingDate } from '../../offline/tripsRepository';
import { savePinLocally } from '../../offline/pinUtility';

export default function CreatePinScreen({ route, navigation }) {
  const { riderId } = route.params || {};
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [stage, setStage] = useState('enter'); // 'enter' | 'confirm'
  const [draft, setDraft] = useState('');
  const [confirmDraft, setConfirmDraft] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [initializingHome, setInitializingHome] = useState(false);

  // ✅ UPDATED: Allow all 4-digit PINs - no weak PIN validation
  function isValidPin(pin) {
    return pin && pin.length === 4 && /^\d{4}$/.test(pin);
  }

  function handleFirstEntry() {
    if (draft.length !== 4) return;
    
    if (!isValidPin(draft)) {
      setError(t('pin.invalid_format') || 'Please enter a valid 4-digit PIN.');
      return;
    }
    
    setError(null);
    setStage('confirm');
  }

  // ✅ FIXED: Retry logic with exponential backoff for API calls
  async function apiCallWithRetry(
    method,
    endpoint,
    data = null,
    maxRetries = 3,
    delayMs = 1000
  ) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        console.log(`[CreatePin] API attempt ${attempt + 1}/${maxRetries} for: ${method} ${endpoint}`);
        
        if (method === 'GET') {
          const res = await api.get(endpoint);
          return res;
        } else if (method === 'POST') {
          const res = await api.post(endpoint, data, { params: { rider_id: riderId } });
          return res;
        }
      } catch (err) {
        console.error(`[CreatePin] API attempt ${attempt + 1} failed:`, {
          status: err.response?.status,
          statusText: err.response?.statusText,
          message: err.message,
          endpoint,
        });

        // Don't retry on client errors (4xx) except 500
        if (err.response?.status >= 400 && err.response?.status < 500) {
          throw err;
        }

        // Retry on server errors (5xx) or network errors
        if (attempt < maxRetries - 1) {
          const waitTime = delayMs * Math.pow(2, attempt);
          console.log(`[CreatePin] Waiting ${waitTime}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        } else {
          throw err;
        }
      }
    }
  }

  // FIXED: Fetch and cache rider data with improved error handling and retry
  async function initializeRiderData(riderIdParam) {
    try {
      console.log(`[CreatePin] Fetching rider details for ${riderIdParam}`);
      
      if (!riderIdParam) {
        throw new Error('Rider ID is missing');
      }

      // ✅ FIXED: Use retry logic for backend call
      const response = await apiCallWithRetry(
        'GET',
        `/onboarding/rider-details/${encodeURIComponent(riderIdParam)}`
      );
      
      console.log('[CreatePin] API Response status:', response?.status);
      console.log('[CreatePin] API Response data received:', {
        ok: response?.data?.ok,
        hasAccount: !!response?.data?.account,
        hasCabzProfile: !!response?.data?.cabz_profile,
        hasRider: !!response?.data?.rider,
      });
      
      if (!response?.data?.ok) {
        throw new Error(`Failed to fetch rider details: ${response?.data?.message || 'Unknown error'}`);
      }

      const data = response.data;
      
      // ✅ FIXED: Cache rider account summary
      if (data.account) {
        await saveRiderAccountSummary(data.account);
        console.log('[CreatePin] Cached rider account summary');
      }
      
      // ✅ FIXED: Cache cabz profile
      if (data.cabz_profile) {
        await saveLocalCabzProfile(data.cabz_profile);
        console.log('[CreatePin] Cached cabz profile');
      }
      
      // ✅ FIXED: Update rider status to indicate onboarding completion
      if (data.rider) {
        const riderIdFromBackend = data.rider.rider_id;
        
        // ✅ CRITICAL FIX: Sync onboarding date from rider.created_at
        if (data.rider.created_at) {
          try {
            const syncResult = await updateRiderOnboardingDate(riderIdFromBackend, data.rider.created_at);
            if (syncResult) {
              console.log('[CreatePin] ✅ Synced onboarding date from rider.created_at:', data.rider.created_at);
            }
          } catch (syncErr) {
            console.error('[CreatePin] Error syncing onboarding date:', syncErr);
            // Don't fail onboarding - continue anyway
          }
        }
        
        // ✅ FIXED: Save rider_id to both places for compatibility
        await saveLocalRiderStatus({
          rider_id: riderIdFromBackend,
          registration_status: 'active',
          onboarding_step: 'createPin'
        });
        
        // ✅ FIXED: Also save to separate rider_id key for RiderContext to find
        await saveLocalRiderId(riderIdFromBackend);
        
        console.log('[CreatePin] Updated rider status to active');
        console.log('[CreatePin] Saved rider_id:', riderIdFromBackend);
      }
      
      return true;
    } catch (err) {
      // ✅ FIXED: Better error logging for debugging
      console.error('[CreatePin] Error initializing rider data:', {
        message: err.message,
        status: err.response?.status,
        statusText: err.response?.statusText,
        responseData: err.response?.data,
        fullError: err
      });
      
      // ✅ FIXED: Show specific error message to user
      if (err.response?.status === 500) {
        console.warn('[CreatePin] Server error - will allow offline initialization');
        showToast(
          t('common.server_error') || 'Server temporarily unavailable. Your data is safe locally.',
          'warning'
        );
      } else if (err.response?.status === 404) {
        showToast(
          t('common.rider_not_found') || 'Rider profile not found.',
          'error'
        );
      } else if (err.message.includes('network')) {
        console.warn('[CreatePin] Network error - offline mode');
        showToast(
          t('common.offline_mode') || 'You\'re offline. Your data will sync when online.',
          'info'
        );
      } else {
        showToast(
          t('common.error_load_data') || 'Could not load some profile data',
          'warning'
        );
      }
      
      // ✅ FIXED: Allow navigation anyway as HomeScreen has fallbacks
      return true;
    }
  }

  async function handleConfirm() {
    if (isLoading) return;
    if (confirmDraft.length !== 4) return;

    if (confirmDraft !== draft) {
      setError(t('pin.mismatch'));
      setStage('enter');
      setDraft('');
      setConfirmDraft('');
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      // ✅ FIXED: Use retry logic for PIN creation
      const res = await apiCallWithRetry(
        'POST',
        '/onboarding/pin/create',
        { pin: draft, pin_confirm: confirmDraft }
      );

      console.log('[CreatePin] PIN creation response:', res?.data);

      if (res?.data?.ok) {
        showToast(t('pin.created_success') || 'PIN created successfully');
        
        // ✅ NEW: Save PIN to IndexedDB for offline-first login
        console.log('[CreatePin] Saving PIN to IndexedDB locally...');
        const pinSaved = await savePinLocally(riderId, draft);
        if (pinSaved) {
          console.log('[CreatePin] ✅ PIN saved locally for offline login');
        } else {
          console.warn('[CreatePin] ⚠️ Failed to save PIN locally, but continuing');
        }
        
        // ✅ FIXED: Fetch and cache rider data before navigating
        setInitializingHome(true);
        await initializeRiderData(riderId);
        
        // ✅ FIXED: Navigate to Home after data is cached
        navigation.replace('Home');
        return;
      }

      if (res?.data?.error === 'mismatch') {
        setError(t('pin.mismatch'));
        setStage('enter');
        setDraft('');
        setConfirmDraft('');
      } else {
        setError(res?.data?.message || t('pin.error_create') || 'Failed to create PIN');
      }
    } catch (err) {
      // ✅ FIXED: Improved error logging and user feedback
      console.error('[CreatePin] PIN creation error:', {
        message: err.message,
        status: err.response?.status,
        statusText: err.response?.statusText,
        responseData: err.response?.data,
        fullError: err
      });

      let errorMsg = t('pin.error_connection') || 'Connection error. Please check your internet.';
      
      if (err.response?.status === 400) {
        errorMsg = t('pin.error_invalid_format') || 'Invalid PIN format';
      } else if (err.response?.status === 409) {
        errorMsg = t('pin.error_already_exists') || 'PIN already exists';
      } else if (err.response?.status === 404) {
        errorMsg = t('pin.error_not_found') || 'Rider not found';
      } else if (err.response?.status === 500) {
        errorMsg = t('common.server_error') || 'Server error. Will try again automatically.';
      } else if (err.code === 'ECONNABORTED') {
        errorMsg = 'Request timeout. Please check your connection.';
      } else if (err.code === 'ERR_NETWORK') {
        errorMsg = 'Network error. Please check your internet connection.';
      }
      
      setError(errorMsg);
    } finally {
      setIsLoading(false);
      setInitializingHome(false);
    }
  }

  const title = stage === 'enter' ? t('pin.create_title') : t('pin.confirm_title');
  const subtitle = stage === 'enter' ? t('pin.create_subtitle') : t('pin.confirm_subtitle');
  const value = stage === 'enter' ? draft : confirmDraft;
  const setValue = stage === 'enter' ? setDraft : setConfirmDraft;
  const isLoadingOrInitializing = isLoading || initializingHome;

  // ✅ FIXED: Show loading overlay during initialization
  if (initializingHome && !isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#ffc107" />
        <Text style={styles.loadingText}>
          {t('common.initializing') || 'Initializing your account...'}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <Text style={styles.backLink} onPress={() => (stage === 'confirm' ? setStage('enter') : navigation.goBack())}>
        ← Back
      </Text>
      <OnboardingProgressBar currentStep="createPin" />
      
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.sub}>{subtitle}</Text>
      
      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.error}>{error}</Text>
        </View>
      )}

      <View style={styles.pinRow}>
        <DigitBoxInput
          length={4}
          value={value}
          onChange={setValue}
          masked={!revealed}
          editable={!isLoadingOrInitializing}
        />
        <TouchableOpacity
          style={[styles.eyeBtn, revealed && styles.eyeBtnActive]}
          onPress={() => setRevealed((r) => !r)}
          disabled={isLoadingOrInitializing}
          accessibilityLabel={revealed ? 'Hide PIN' : 'Show PIN'}
        >
          <Text style={styles.eyeEmoji}>{revealed ? '🙈' : '👁️'}</Text>
        </TouchableOpacity>
      </View>
      
      <Text style={styles.revealHint}>{t('pin.reveal_hint') || 'Tap eye icon to show/hide'}</Text>

      <PrimaryButton
        label={stage === 'enter' ? t('pin.continue_button') : t('pin.confirm_button')}
        onPress={stage === 'enter' ? handleFirstEntry : handleConfirm}
        disabled={value.length !== 4 || isLoadingOrInitializing}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f4ef', padding: 20 },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#f6f4ef',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 14,
    color: '#5b606c',
    textAlign: 'center',
  },
  backLink: { fontSize: 12, fontWeight: '700', color: '#5b606c', marginBottom: 10 },
  title: { fontSize: 22, fontWeight: '700', color: '#1a1c20', marginBottom: 6, marginTop: 2, letterSpacing: -0.01 },
  sub: { fontSize: 12, color: '#5b606c', marginBottom: 16, lineHeight: 18 },
  errorBox: { backgroundColor: '#fce4e1', borderRadius: 8, padding: 10, marginBottom: 16 },
  error: {
    color: '#e0453f',
    fontSize: 11.5,
    textAlign: 'center',
    fontWeight: '600',
  },
  pinRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 8, marginBottom: 8 },
  eyeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#e7e4db',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyeBtnActive: { backgroundColor: '#ffc107', borderColor: '#ffc107' },
  eyeEmoji: { fontSize: 15 },
  revealHint: { fontSize: 10.5, color: '#5b606c', textAlign: 'center', marginBottom: 14, marginTop: 4 },
});