// Push notifications: ask permission, get the device's Expo push token, register it with the portal.
// On a network with no route to the Expo push service (fully offline on-prem), registration simply does nothing useful
// and the app still works with pull-to-refresh and the in-app list.
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { api } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: true }),
});

let lastToken = null;

export async function registerForPush() {
  if (!Device.isDevice) return null; // no push on simulators
  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return null;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('requests', { name: 'Requests', importance: Notifications.AndroidImportance.HIGH });
  }
  const projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
  const tokenData = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  lastToken = tokenData.data;
  await api.post('/api/auth/devices', { token: lastToken, platform: Platform.OS });
  return lastToken;
}

export async function unregisterPush() {
  if (lastToken) { await api.del('/api/auth/devices', { token: lastToken }).catch(() => {}); lastToken = null; }
}
