// Where the app talks to. Change this to your server's address.
// Default is the Vercel TEST site; for an on-prem server use its internal URL, e.g. https://holiday-dialysis.hospital.local
import Constants from 'expo-constants';

const trimEndSlashes = (s) => {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47) end -= 1;
  return end === s.length ? s : s.slice(0, end);
};
export const API_URL = trimEndSlashes(Constants.expoConfig?.extra?.apiUrl || 'https://holiday-dialysis.dev');
export const COLORS = {
  green: '#14432c', greenDark: '#0e3020', orange: '#d65a1a', bg: '#f3f4f2', surface: '#ffffff',
  text: '#1b241f', muted: '#5b6b61', line: '#e2e7e3', bad: '#a12a1d', good: '#17643a', pend: '#8a6d1a', wait: '#1a5a8a',
};
