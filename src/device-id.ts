import * as Application from 'expo-application';

let cached: string | null = null;

export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  const id = Application.getAndroidId() ?? `fallback-${Date.now()}`;
  cached = id;
  return cached;
}
