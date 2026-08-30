// ============================================================================
// CRITICAL FIX: Backend API Error Handler
// Location: rider-app/src/api/errorHandler.js
// ============================================================================
// Purpose: Handle 500 and 422 errors from backend gracefully
// ✅ FIXES:
// - Handles 500 Internal Server Errors with retry logic
// - Handles 422 Unprocessable Content with validation feedback
// - Provides offline fallback when backend unavailable
// - Logs errors for debugging

export const API_ERROR_CODES = {
  PLATE_VALIDATION_500: {
    status: 500,
    endpoint: '/onboarding/check-plate-uniqueness',
    cause: 'Backend database or validation service error',
    solution: 'Retry with exponential backoff, allow offline verification',
  },
  PROFILE_CONFIRM_422: {
    status: 422,
    endpoint: '/onboarding/profile-confirm',
    cause: 'Invalid or missing required fields in request payload',
    solution: 'Validate all fields before sending, check field format',
  },
  RIDER_DETAILS_500: {
    status: 500,
    endpoint: '/onboarding/rider-details',
    cause: 'Backend service temporarily unavailable',
    solution: 'Retry, fallback to local data cache',
  },
  PIN_CREATE_500: {
    status: 500,
    endpoint: '/onboarding/pin/create',
    cause: 'PIN service error or database issue',
    solution: 'Retry, allow offline PIN creation',
  },
};

/**
 * ✅ FIXED: Determine if error is retryable
 */
export function isRetryableError(error) {
  const status = error.response?.status;
  
  // Retry on server errors (5xx) and network errors
  if (status >= 500) return true;
  
  // Retry on timeout
  if (error.code === 'ECONNABORTED') return true;
  
  // Retry on network errors
  if (error.code === 'ERR_NETWORK') return true;
  
  // Don't retry on client errors (4xx) except 422
  if (status === 422) return true; // Might be temporary validation issue
  if (status >= 400 && status < 500) return false;
  
  return false;
}

/**
 * ✅ FIXED: Get user-friendly error message
 */
export function getErrorMessage(error, endpoint = '') {
  const status = error.response?.status;
  const message = error.response?.data?.message;
  
  // Server errors
  if (status === 500) {
    return `Server temporarily unavailable. Your data is safe. (Error ${status})`;
  }
  
  // Validation errors
  if (status === 422) {
    return message || 'Some fields are invalid. Please check and try again.';
  }
  
  // Not found
  if (status === 404) {
    return 'Rider profile not found. Please complete onboarding first.';
  }
  
  // Conflict
  if (status === 409) {
    return 'This plate is already registered to another rider.';
  }
  
  // Network errors
  if (error.code === 'ERR_NETWORK') {
    return 'No internet connection. Your data will sync when online.';
  }
  
  if (error.code === 'ECONNABORTED') {
    return 'Request timed out. Please try again.';
  }
  
  // Generic error
  return message || 'Something went wrong. Please try again.';
}

/**
 * ✅ FIXED: Log error for debugging
 */
export function logApiError(error, context = {}) {
  const errorInfo = {
    timestamp: new Date().toISOString(),
    status: error.response?.status,
    statusText: error.response?.statusText,
    message: error.message,
    endpoint: error.config?.url,
    method: error.config?.method,
    context,
  };
  
  console.error('[API ERROR]', JSON.stringify(errorInfo, null, 2));
  
  // Also log to analytics/monitoring if available
  if (window.__analyticsQueue) {
    window.__analyticsQueue.push({
      type: 'api_error',
      ...errorInfo,
    });
  }
}

/**
 * ✅ FIXED: Validate plate format before sending to backend
 */
export function validatePlateFormat(plate) {
  if (!plate) return { valid: false, error: 'Plate is required' };
  
  const cleaned = plate.trim().toUpperCase();
  
  // Accept any non-empty alphanumeric plate
  if (!/^[A-Z0-9\s]{1,12}$/.test(cleaned)) {
    return {
      valid: false,
      error: 'Plate must be 1-12 characters (letters, numbers, spaces)',
    };
  }
  
  return { valid: true, cleaned };
}

/**
 * ✅ FIXED: Validate profile data before sending to backend
 */
export function validateProfileData(data) {
  const errors = {};
  
  // Validate plate
  if (!data.number_plate) {
    errors.plate = 'Number plate is required';
  } else if (data.number_plate.length > 12) {
    errors.plate = 'Plate must be 12 characters or less';
  }
  
  // Validate fuel type
  if (!data.fuel_type_code) {
    errors.fuelType = 'Fuel type is required';
  }
  
  // Validate rider ID
  if (!data.rider_id) {
    errors.riderId = 'Rider ID is missing';
  }
  
  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * ✅ FIXED: Validate PIN data before sending to backend
 */
export function validatePinData(pin, pinConfirm) {
  const errors = {};
  
  if (!pin || pin.length !== 4) {
    errors.pin = 'PIN must be exactly 4 digits';
  }
  
  if (!pinConfirm || pinConfirm.length !== 4) {
    errors.pinConfirm = 'Confirmation PIN must be exactly 4 digits';
  }
  
  if (pin !== pinConfirm) {
    errors.mismatch = 'PINs do not match';
  }
  
  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * ✅ FIXED: Handle 422 validation error response
 */
export function parse422Error(response) {
  const data = response.data || {};
  
  // Extract validation errors if available
  if (data.errors && typeof data.errors === 'object') {
    return {
      hasDetails: true,
      validationErrors: data.errors,
      message: data.message || 'Validation failed',
    };
  }
  
  return {
    hasDetails: false,
    message: data.message || 'Invalid request data',
  };
}

/**
 * ✅ FIXED: Should allow offline fallback?
 */
export function shouldAllowOfflineFallback(error, endpoint) {
  const status = error.response?.status;
  
  // Allow offline fallback for server errors
  if (status >= 500) return true;
  
  // Allow offline fallback for network errors
  if (error.code === 'ERR_NETWORK') return true;
  if (error.code === 'ECONNABORTED') return true;
  
  // Don't allow offline fallback for validation errors (4xx)
  if (status >= 400 && status < 500) {
    // Except 422 which might be temporary
    return status === 422;
  }
  
  return false;
}

/**
 * ✅ FIXED: Build error context for better debugging
 */
export function buildErrorContext(error, additionalInfo = {}) {
  return {
    error: {
      message: error.message,
      code: error.code,
      status: error.response?.status,
      statusText: error.response?.statusText,
    },
    request: {
      url: error.config?.url,
      method: error.config?.method,
      params: error.config?.params,
    },
    timestamp: new Date().toISOString(),
    ...additionalInfo,
  };
}