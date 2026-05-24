import * as Location from 'expo-location';
import { NativeModules, PermissionsAndroid, Platform } from 'react-native';

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

/**
 * Retorna true se o app já está na whitelist de isenção de bateria.
 * Usa o método nativo isIgnoringBatteryOptimizations() do ImeiModule.
 */
export async function checkBatteryOptimization(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const result = await NativeModules.ImeiModule?.isIgnoringBatteryOptimizations?.();
    return result === true;
  } catch {
    return true; // assume OK se falhar — não bloqueia o serviço
  }
}

/**
 * Tenta abrir a tela de isenção de bateria.
 * Retorna true se a tela foi aberta (JS deve aguardar o usuário retornar).
 * Retorna false se: já isento, dispositivo não suporta, ou erro.
 * Nesse caso o JS deve prosseguir e iniciar o GPS sem esperar.
 */
export async function openBatterySettings(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    const opened = await NativeModules.ImeiModule?.requestBatteryOptimizationExemption?.();
    return opened === true;
  } catch (_) {
    return false;
  }
}
