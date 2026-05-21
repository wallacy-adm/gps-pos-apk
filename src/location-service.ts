import * as Location from 'expo-location';

export function locationProviderFromGpsEnabled(gpsEnabled: boolean): string {
  return gpsEnabled ? 'gps' : 'network';
}

export async function requestPermissions(): Promise<boolean> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return false;
  const bg = await Location.requestBackgroundPermissionsAsync();
  return bg.status === 'granted';
}
