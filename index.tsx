import { registerRootComponent } from 'expo';
import * as TaskManager from 'expo-task-manager';
import { useEffect } from 'react';
import { BackHandler, NativeModules, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { requestPermissions, checkBatteryOptimization, openBatterySettings } from './src/location-service';

const BATTERY_ASKED_KEY = 'battery_exemption_asked_v1';

/**
 * Timeout helper — garante que um await trave no maximo `ms` milissegundos.
 * Usado em requestPermissions() e finishActivity().
 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), ms)
    ),
  ]);
}

/**
 * Activity de bootstrap — invisivel ao usuario.
 *
 * Fluxo v2.0.0:
 *   1. requestPermissions()   — com timeout 5s
 *   2. Espera 500ms
 *   3. finishActivity()       — fecha; GpsLocationService ja esta rodando (Java nativo)
 *
 * O GPS e gerenciado pelo GpsLocationService (Java ForegroundService).
 * Nao depende desta Activity estar em foreground.
 */
function App() {
  useEffect(() => {
    (async () => {
      // 0. Remove tasks Expo legadas (v1.x usava BackgroundFetch/TaskManager)
      //    Sem isso, GPS_LOCATION_TASK fica em loop de 2s causando memory leak
      try {
        await TaskManager.unregisterAllTasksAsync();
      } catch (_) {}

      // 1. Permissoes — com timeout 5s
      try {
        await withTimeout(requestPermissions(), 5_000);
      } catch (_) {}

      // 1c. Isenção de otimização de bateria — só pergunta UMA VEZ (na
      // instalação/primeiro boot, quando alguém está fisicamente ali pra
      // tocar "Permitir"). Sem isso, o Android/fabricante pode matar o
      // GpsLocationService e revogar o alarme de backup depois de alguns
      // dias sem ninguém "usar" o app (ele não tem UI visível nunca).
      // Nunca repete em boots seguintes — não queremos diálogo aparecendo
      // sozinho no meio da madrugada sem ninguém pra ver.
      try {
        const jaPerguntou = await AsyncStorage.getItem(BATTERY_ASKED_KEY);
        if (!jaPerguntou) {
          await AsyncStorage.setItem(BATTERY_ASKED_KEY, '1');
          const isento = await withTimeout(checkBatteryOptimization(), 3_000);
          if (!isento) {
            await withTimeout(openBatterySettings(), 3_000).catch(() => {});
            // da um tempo extra pro dialogo do sistema aparecer/fechar
            await new Promise<void>(resolve => setTimeout(resolve, 4_000));
          }
        }
      } catch (_) {}

      // 2. GPS e gerenciado pelo GpsLocationService (Java nativo).
      // Nao e necessario iniciar aqui. Pausa curta antes de fechar.
      await new Promise<void>(resolve => setTimeout(resolve, 500));

      // 3. Fecha a Activity — GpsLocationService continua rodando
      try {
        const finished = await withTimeout(
          NativeModules.ImeiModule?.finishActivity?.() ?? Promise.resolve(false),
          2_000
        );
        if (!finished) BackHandler.exitApp();
      } catch (_) {
        BackHandler.exitApp();
      }
    })();
  }, []);

  // Tela preta — fecha em ~1s (permissoes ja concedidas)
  return <View style={{ flex: 1, backgroundColor: '#000000' }} />;
}

registerRootComponent(App);
