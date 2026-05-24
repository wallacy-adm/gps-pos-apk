import { NativeModules, Platform } from 'react-native';
import * as Application from 'expo-application';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DEVICE_ID_KEY = '@pos_device_id';
let cached: string | null = null;

/**
 * Retorna o ID único do dispositivo.
 *
 * Prioridade (Android 9):
 *   1. IMEI via ImeiModule (TelephonyManager — requer READ_PHONE_STATE)
 *   2. Android ID (fallback se permissão negada)
 *   3. ID gerado e persistido no AsyncStorage (último recurso)
 *
 * O IMEI é o identificador obrigatório pois permite saber quem está
 * com o terminal para depois renomear no dashboard.
 */
/**
 * Retorna apenas o IMEI sem afetar o serial do dispositivo.
 * Usado para enriquecer os dados no Supabase (campo imei separado).
 */
export async function getImeiOnly(): Promise<string | null> {
  if (Platform.OS !== 'android') return null;
  try {
    const imei: string | null = await NativeModules.ImeiModule?.getImei?.();
    if (imei && imei.trim().length >= 14) return imei.trim();
  } catch (_) {}
  return null;
}

export async function getDeviceId(): Promise<string> {
  if (cached) return cached;

  // 1. Tenta IMEI via módulo nativo (Android 9 suporta diretamente)
  if (Platform.OS === 'android') {
    try {
      const imei: string | null = await NativeModules.ImeiModule?.getImei?.();
      if (imei && imei.trim().length >= 14) {
        cached = imei.trim();
        return cached;
      }
    } catch (_) {
      // Permissão ainda não concedida — cai para fallback
    }
  }

  // 2. Fallback: Android ID
  const androidId = Application.getAndroidId();
  if (androidId) {
    cached = androidId;
    return cached;
  }

  // 3. Último recurso: ID persistido
  const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (stored) {
    cached = stored;
    return cached;
  }

  const generated = `pos-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await AsyncStorage.setItem(DEVICE_ID_KEY, generated);
  cached = generated;
  return cached;
}
