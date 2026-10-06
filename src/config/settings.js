import * as SecureStore from 'expo-secure-store';

import { DEFAULT_SETTINGS, sanitizeSettings } from './settingsModel';

const KEY = 'dualcast_settings';

export async function loadSettings() {
  try {
    const stored = await SecureStore.getItemAsync(KEY);
    return sanitizeSettings(stored ? JSON.parse(stored) : null);
  } catch {
    return sanitizeSettings(DEFAULT_SETTINGS);
  }
}

export async function saveSettings(settings) {
  const clean = sanitizeSettings(settings);
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(clean));
  } catch (error) {
    console.warn('[settings] could not save:', error);
  }
  return clean;
}
