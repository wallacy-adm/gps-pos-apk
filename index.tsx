import { registerRootComponent } from 'expo';
import { useEffect } from 'react';
import { BackHandler, NativeModules, View } from 'react-native';
import { startLocationTracking } from './src/background-task';
import { requestPermissions } from './src/location-service';

/**
 * Garante que uma Promise resolve dentro de `ms` milissegundos.
 * Se a Promise original travar (await infinito), rejeita com 'timeout'.
 * O catch externo captura e o fluxo continua para fechar a Activity.
 *
 * MOTIVO: requestPermissions() e startLocationUpdatesAsync() podem travar
 * indefinidamente quando o app é iniciado em background (BootReceiver):
 *   - O sistema Android suprime diálogos de permissão mas o Promise não resolve
 *   - O GPS do sistema pode não estar pronto logo após o boot
 * Sem esse timeout, finishActivity() nunca é chamado → tela preta permanente.
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
 *   1. Solicita permissões (já concedidas → retorna imediato; diálogo suprimido → timeout 5s)
 *   2. Inicia ForegroundService GPS (já rodando → retorna imediato; boot lento → timeout 8s)
 *   3. Fecha a Activity — o ForegroundService continua em background
 *
 * Tempo máximo antes de fechar: ~15s (garantido pelo withTimeout em cada etapa).
 * Tempo normal: ~1-2s (permissões já concedidas + GPS já rodando).
 *
 * Abre em toda reinicialização (BootReceiver) e a cada 5 min (AlarmReceiver)
 * para garantir auto-recuperação caso o OEM mate o serviço GPS.
 */
function App() {
  useEffect(() => {
    (async () => {
      // Permissões: 5s máximo.
      // Se o sistema suprimir diálogos (contexto de boot/background), não trava.
      try {
        await withTimeout(requestPermissions(), 5_000);
      } catch (_) {
        // Timeout ou permissão negada — GPS pode não funcionar, mas Activity fecha
      }

      // GPS: 8s máximo.
      // startLocationUpdatesAsync pode travar se o GPS do sistema ainda não inicializou.
      try {
        await withTimeout(startLocationTracking(), 8_000);
      } catch (_) {
        // Timeout ou GPS já rodando — ForegroundService pode já estar ativo
      }

      // Fecha a Activity — SEMPRE chega aqui (máx ~13s após abrir)
      // ForegroundService GPS continua rodando independentemente
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

  // Tela preta — fecha em no máximo ~15s, normalmente ~1-2s
  return <View style={{ flex: 1, backgroundColor: '#000000' }} />;
}

registerRootComponent(App);
