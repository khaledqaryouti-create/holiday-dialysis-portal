// Where the app talks to. Change this to your server's address.
// Default is the Vercel TEST site; for an on-prem server use its internal URL, e.g. https://holiday-dialysis.hospital.local
import Constants from 'expo-constants';

export const API_URL = (Constants.expoConfig?.extra?.apiUrl || 'https://holiday-dialysis.dev').replace(/\/+$/, '');
export const COLORS = {
  green: '#14432c', greenDark: '#0e3020', orange: '#d65a1a', bg: '#f3f4f2', surface: '#ffffff',
  text: '#1b241f', muted: '#5b6b61', line: '#e2e7e3', bad: '#a12a1d', good: '#17643a', pend: '#8a6d1a', wait: '#1a5a8a',
};
