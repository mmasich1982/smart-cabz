// ============================================================================
// CRITICAL FIX: Profile Confirmation Endpoint (422 Error Handler)
// Location: rider-app/src/screens/onboarding/ProfileConfirmationScreen.js
// ============================================================================
// Problem: POST /onboarding/profile-confirm returns 422 Unprocessable Content
// Solution: Validate all fields before sending, better error handling

import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import PrimaryButton from '../../components/PrimaryButton';
import { useTranslation } from '../../i18n/LocalizationProvider';
import { useToast } from '../../components/Toast';
import api from '../../api/client';
import {
  validateProfileData,
  getErrorMessage,
  logApiError,
  shouldAllowOfflineFallback,
  parse422Error,
} from '../../api/errorHandler';
import { saveLocalRiderStatus, enqueue } from '../../offline/db';

export default function ProfileConfirmationScreen({ route, navigation }) {
  const { riderId, profile } = route.params || {};
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  /**
   * ✅ FIXED: Pre-validate all required fields
   */
  function validateBeforeSubmit() {
    const errors = [];
    
    if (!riderId) {
      errors.push('Rider ID is missing');
    }
    
    if (!profile?.number_plate) {
      errors.push('Number plate is missing');
    } else if (profile.number_plate.length > 12) {
      errors.push('Number plate exceeds maximum length');
    }
    
    if (!profile?.fuel_type_code) {
      errors.push('Fuel type is missing');
    }
    
    if (errors.length > 0) {
      setError(errors.join('. '));
      return false;
    }
    
    return true;
  }

  /**
   * ✅ FIXED: Build properly formatted request payload
   */
  function buildRequestPayload() {
    return {
      rider_id: riderId,
      number_plate: profile.number_plate?.trim().toUpperCase() || '',
      fuel_type_code: profile.fuel_type_code || '',
      profile_type: 'cabz_driver',
      status: 'pending_verification',
      submitted_at: new Date().toISOString(),
    };
  }

  /**
   * ✅ FIXED: Submit profile with retry logic
   */
  async function handleConfirmProfile() {
    if (isSubmitting) return;
    
    try {
      // Pre-validate
      if (!validateBeforeSubmit()) {
        return;
      }
      
      setIsSubmitting(true);
      setError(null);
      
      const payload = buildRequestPayload();
      
      console.log('[ProfileConfirm] Submitting profile:', {
        riderId: payload.rider_id,
        plate: payload.number_plate,
        fuelType: payload.fuel_type_code,
      });
      
      // ✅ FIXED: Retry logic for backend submission
      let lastError = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`[ProfileConfirm] Submission attempt ${attempt}/3`);
          
          const response = await api.post(
            '/onboarding/profile-confirm',
            payload,
            { params: { rider_id: riderId } }
          );
          
          if (response?.data?.ok) {
            console.log('[ProfileConfirm] ✅ Profile confirmed successfully');
            
            // Update local status
            await saveLocalRiderStatus({
              rider_id: riderId,
              registration_status: 'verified',
              onboarding_step: 'profileConfirmed',
            });
            
            // Enqueue for sync
            await enqueue('profile_confirmation', payload);
            
            showToast(t('profile.confirmation_success') || 'Profile confirmed successfully');
            navigation.navigate('CabzProfile');
            return;
          } else {
            throw new Error(response?.data?.message || 'Confirmation failed');
          }
        } catch (err) {
          lastError = err;
          const status = err.response?.status;
          const message = err.message;
          
          console.error(`[ProfileConfirm] Attempt ${attempt} failed:`, {
            status,
            message,
            response: err.response?.data,
          });
          
          // Don't retry on 422 validation errors
          if (status === 422) {
            const parsed = parse422Error(err.response);
            if (parsed.hasDetails) {
              console.error('[ProfileConfirm] Validation errors:', parsed.validationErrors);
              setError(`Validation error: ${parsed.message}`);
            } else {
              setError(parsed.message);
            }
            break;
          }
          
          // Don't retry on 404
          if (status === 404) {
            setError('Rider not found. Please complete onboarding again.');
            break;
          }
          
          // Retry on 5xx errors
          if (status >= 500 && attempt < 3) {
            await new Promise(resolve => 
              setTimeout(resolve, 1000 * Math.pow(2, attempt - 1))
            );
          }
        }
      }
      
      // If we got here, submission failed
      if (lastError) {
        const userMessage = getErrorMessage(lastError);
        setError(userMessage);
        
        // ✅ FIXED: Allow offline submission if backend unavailable
        if (shouldAllowOfflineFallback(lastError)) {
          showToast(
            t('common.offline_save') || 
            'Saved locally - will sync when online',
            'info'
          );
          
          // Save locally and enqueue
          await saveLocalRiderStatus({
            rider_id: riderId,
            registration_status: 'pending',
            onboarding_step: 'profileConfirmed',
          });
          
          await enqueue('profile_confirmation', buildRequestPayload());
          
          // Still navigate forward
          setTimeout(() => navigation.navigate('CabzProfile'), 1500);
        }
      }
    } catch (err) {
      console.error('[ProfileConfirm] Unexpected error:', err);
      setError(getErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!riderId || !profile) {
    return (
      <View style={styles.container}>
        <Text style={styles.error}>
          Missing required information. Please start onboarding again.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <Text style={styles.title}>Confirm Your Profile</Text>
      <Text style={styles.subtitle}>Review the details below</Text>
      
      {/* Profile Summary */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Number Plate</Text>
          <Text style={styles.summaryValue}>{profile.number_plate}</Text>
        </View>
        
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Fuel Type</Text>
          <Text style={styles.summaryValue}>{profile.fuel_type_code}</Text>
        </View>
        
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Rider ID</Text>
          <Text style={styles.summaryValue} numberOfLines={1}>
            {riderId}
          </Text>
        </View>
      </View>
      
      {/* Error Display */}
      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
      
      {/* Loading State */}
      {isSubmitting && (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="small" color="#ff7a1a" />
          <Text style={styles.loadingText}>Confirming profile...</Text>
        </View>
      )}
      
      {/* Buttons */}
      <PrimaryButton
        label="Confirm"
        onPress={handleConfirmProfile}
        disabled={isSubmitting}
      />
      
      <PrimaryButton
        label="Back to Edit"
        onPress={() => navigation.goBack()}
        disabled={isSubmitting}
        style={styles.secondaryButton}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f6f4ef',
    padding: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1a1c20',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 12,
    color: '#5b606c',
    marginBottom: 20,
    lineHeight: 18,
  },
  summaryCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#ff7a1a',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  summaryLabel: {
    fontSize: 12,
    color: '#5b606c',
    fontWeight: '600',
  },
  summaryValue: {
    fontSize: 14,
    color: '#1a1c20',
    fontWeight: '600',
    flex: 1,
    textAlign: 'right',
    marginLeft: 10,
  },
  errorBox: {
    backgroundColor: '#fce4e1',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#e0453f',
  },
  errorText: {
    color: '#e0453f',
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  loadingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff9e6',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    gap: 10,
  },
  loadingText: {
    fontSize: 12,
    color: '#ffa502',
    fontWeight: '600',
  },
  secondaryButton: {
    marginTop: 8,
    backgroundColor: '#f0f0f0',
  },
});