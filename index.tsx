import { registerRootComponent } from 'expo';
import { useEffect } from 'react';
import { BackHandler, NativeModules, View } from 'react-native';
import { startLocationTracking } from './src/background-task';
import { requestPermissions } from './src/location-service';

/**
 * Timeout helper — garante que um await trave no máximo `ms` milissegundos.
 * Usado APENAS em requestPermissions() e finishActivity(), NÃO em startLocationTracking.
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
 * Activity de bootstrap — invisível ao usuário.
 *
 * Fluxo:
 *   1. requestPermissions()      — com timeout 5s (pode travar se sistema suprime diálogo)
 *   2. startLocationTracking()   — FIRE-AND-FORGET (não awaita)
 *   3. Espera 1s                 — tempo para Android chamar startForegroundService()
 *   4. finishActivity()          — fecha a Activity; ForegroundService continua
 *
 * POR QUE FIRE-AND-FORGET no GPS:
 *   startLocationUpdatesAsync() no AR-SP5 pode levar >8-15s no boot
 *   (GPS do sistema não está pronto). Awaitar com timeout curto cortava a
 *   inicialização no meio — ForegroundService nunca subia, GPS nunca funcionava.
 *   Sem await, o Android chama startForegroundService() em <500ms (antes do
 *   Promise resolver). A Activity fecha, mas o ForegroundService mantém o
 *   processo Android vivo e o GPS continua inicializando em background.
 *
 * POR QUE 1s DE ESPERA:
 *   Sem nenhuma pausa entre startLocationTracking() e finishActivity(), o
 *   processo pode morrer antes de startForegroundService() ser chamado no native.
 *   1s é mais que suficiente para o Android registrar o serviço.
 */
function App() {
  useEffect(() => {
    (async () => {
      // 1. Permissões — com timeout 5s
      // location-service.ts usa getForeground/BackgroundPermissionsAsync() (sem diálogo)
      // antes de request*. Se já concedidas → retorna imediato. Se não → timeout 5s garante
      // que não trava indefinidamente (sistema pode suprimir diálogos no boot).
      try {
        await withTimeout(requestPermissions(), 5_000);
      } catch (_) {}

      // 2. GPS — FIRE-AND-FORGET, não awaita
      // O native Android registra o ForegroundService em <500ms independente do
      // Promise resolver. Não precisamos esperar o Promise para fechar a Activity.
      startLocationTracking().catch(() => {});

      // 3. Pausa 2s — garante que startLocationUpdatesAsync() completou e o
      // ForegroundService está vivo antes da Activity fechar.
      // 2s é suficiente: quando o app está em foreground (janela visível),
      // startLocationUpdatesAsync() completa em < 500ms.
      await new Promise<void>(resolve => setTimeout(resolve, 2_000));

      // 4. Fecha a Activity — ForegroundService GPS continua rodando
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

  // Tela preta — fecha em ~1-2s normalmente, ~6s no primeiro boot
  return <View style={{ flex: 1, backgroundColor: '#000000' }} />;
}

registerRootComponent(App);
