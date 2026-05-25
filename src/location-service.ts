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
 * ESTRATÉGIA: verifica com get* (não-bloqueante, sem diálogo) antes de chamar request*.
 * Se a permissão já está concedida → retorna imediatamente sem mostrar nada.
 * Se não está concedida → tenta pedir via diálogo (protegido pelo withTimeout no chamador).
 *
 * MOTIVO: quando o app é iniciado pelo BootReceiver (background), o sistema Android
 * pode suprimir diálogos de permissão silenciosamente. A chamada request* ficaria
 * aguardando uma resposta que nunca vem. Verificar antes evita esse await infinito
 * na maioria dos casos (permissões já foram concedidas na primeira instalação).
 */
export async function requestPermissions(): Promise<boolean> {
  // Verifica foreground sem mostrar diálogo
  const fgCheck = await Location.getForegroundPermissionsAsync();
  if (fgCheck.status !== 'granted') {
    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== 'granted') return false;
  }

  // Verifica background sem mostrar diálogo
  const bgCheck = await Location.getBackgroundPermissionsAsync();
  if (bgCheck.status !== 'granted') {
    const bg = await Location.requestBackgroundPermissionsAsync();
    if (bg.status !== 'granted') return false;
  }

  // READ_PHONE_STATE: verifica antes de pedir para evitar diálogo desnecessário
  if (Platform.OS === 'android') {
    try {
      const alreadyGranted = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE
      );
      if (!alreadyGranted) {
        await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
          {
            title: 'Identificação do Terminal',
            message: 'Necessário para identificar este terminal no sistema.',
            buttonPositive: 'Permitir',
          }
        );
      }
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
