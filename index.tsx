import { registerRootComponent } from 'expo';
import { useEffect } from 'react';
import { BackHandler, NativeModules, View } from 'react-native';
import { startLocationTracking } from './src/background-task';
import { requestPermissions } from './src/location-service';

/**
 * Activity de bootstrap — invisível ao usuário.
 *
 * Fluxo:
 *   1. Solicita permissões de localização (já concedidas → retorna imediatamente)
 *   2. Inicia o ForegroundService GPS (já rodando → retorna imediatamente)
 *   3. Fecha a Activity — o ForegroundService continua em background
 *
 * Abre em toda reinicialização (BootReceiver) e a cada 5 min (AlarmReceiver)
 * para garantir auto-recuperação caso o OEM mate o serviço GPS.
 *
 * NUNCA mostra tela de ativação de bateria: o usuário configura isso
 * uma única vez manualmente em Configurações → Apps → Bateria → Sem restrição.
 */
function App() {
  useEffect(() => {
    (async () => {
      try {
        await requestPermissions();
        await startLocationTracking();
      } catch (_) {
        // GPS pode já estar rodando — ignora
      }
      // Fecha a Activity mantendo o ForegroundService vivo
      try {
        const finished = await NativeModules.ImeiModule?.finishActivity?.();
        if (!finished) BackHandler.exitApp();
      } catch (_) {
        BackHandler.exitApp();
      }
    })();
  }, []);

  // Tela preta — fecha em ~1-2 segundos, nunca visível ao usuário
  return <View style={{ flex: 1, backgroundColor: '#000000' }} />;
}

registerRootComponent(App);
