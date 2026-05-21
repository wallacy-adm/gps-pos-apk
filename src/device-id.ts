import * as Application from 'expo-application';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DEVICE_ID_KEY = '@pos_device_id';
let cached: string | null = null;

/**
 * Retorna o ID único do dispositivo (Android ID).
 *
 * - Prioridade: AndroidId → fallback persistido → gera e persiste novo fallback
 * - O fallback é salvo no AsyncStorage para sobreviver a reinicializações do app
 * - Sem persistência, um novo ID seria gerado a cada restart → múltiplos registros no Supabase
 */
export async function getDeviceId(): Promise<string> {
  if (cached) return cached;

  // Tenta Android ID (disponível na maioria dos dispositivos POS)
  const androidId = Application.getAndroidId();
  if (androidId) {
    cached = androidId;
    return cached;
  }

  // Fallback: busca ID persistido no AsyncStorage
  const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (stored) {
    cached = stored;
    return cached;
  }

  // Última opção: gera ID único e persiste para reutilização
  const generated = `pos-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await AsyncStorage.setItem(DEVICE_ID_KEY, generated);
  cached = generated;
  return cached;
}
