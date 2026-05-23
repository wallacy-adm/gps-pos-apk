import * as Location from 'expo-location';
import { PermissionsAndroid, Platform } from 'react-native';

export function locationProviderFromGpsEnabled(gpsEnabled: boolean): string {
  return gpsEnabled ? 'gps' : 'network';
}

/**
 * Solicita todas as permissões necessárias:
 *   - Localização em foreground e background
 *   - READ_PHONE_STATE (para IMEI no Android 9)
 *
 * A isenção de otimização de bateria (REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
 * está declarada no manifest — garante que o serviço continue rodando
 * mesmo com tela desligada ou bloqueada.
 */
export async function requestPermissions(): Promise<boolean> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return false;

  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status !== 'granted') return false;

  // Solicita READ_PHONE_STATE para leitura do IMEI (Android 9+)
  if (Platform.OS === 'android') {
    try {
      await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
        {
          title: 'Identificação do Terminal',
          message: 'Necessário para identificar este terminal no sistema.',
          buttonPositive: 'Permitir',
        }
      );
    } catch (_) {
      // Não bloqueia o serviço se falhar — usa fallback Android ID
    }
  }

  return true;
}
