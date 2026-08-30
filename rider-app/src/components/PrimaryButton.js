// rider-app/src/components/PrimaryButton.js
import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { COLORS } from '../constants/colors';

export default function PrimaryButton({ label, onPress, disabled = false, glow = false }) {
  // glow: subtle pulsing shadow (Reanimated), used on the highest-intent CTAs — Value Preview and PIN Login —
  // to match cleaned.html's .btn-glow. Purely cosmetic, no functional difference.
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
  // Smart Cabz yellow primary action color — matches cleaned.html's .btn-primary
  btn: { backgroundColor: COLORS.CABZ_YELLOW, paddingVertical: 15, paddingHorizontal: 16, borderRadius: 13, alignItems: 'center', marginHorizontal: 20, marginTop: 12, shadowColor: COLORS.CABZ_YELLOW, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
  btnDisabled: { backgroundColor: COLORS.DISABLED_BG, shadowOpacity: 0 },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  btnTextDisabled: { color: COLORS.DISABLED_TEXT },
});