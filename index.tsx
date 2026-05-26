import { registerRootComponent } from 'expo';
import * as TaskManager from 'expo-task-manager';
import { useEffect } from 'react';
import { BackHandler, NativeModules, View } from 'react-native';
import { requestPermissions } from './src/location-service';

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
