// rider-app/src/components/GhostButton.js
import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { COLORS } from '../constants/colors';

/**
 * GhostButton - An outlined/ghost style button for secondary actions
 * @param {string} label - Button text/label
 * @param {function} onPress - Callback function when pressed
 * @param {boolean} disabled - Whether button is disabled
 */
export default function GhostButton({ label, onPress, disabled = false }) {
  return (
    <TouchableOpacity
      style={[styles.btn, disabled && styles.btnDisabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
    >
      <Text style={[styles.btnText, disabled && styles.btnTextDisabled]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: COLORS.CABZ_YELLOW,
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderRadius: 13,
    alignItems: 'center',
    marginHorizontal: 20,
    marginTop: 12,
  },
  btnDisabled: {
    borderColor: COLORS.DISABLED_BG,
  },
  btnText: {
    color: COLORS.CABZ_YELLOW,
    fontWeight: '700',
    fontSize: 15,
  },
  btnTextDisabled: {
    color: COLORS.DISABLED_TEXT,
  },
});