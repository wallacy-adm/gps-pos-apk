import { registerRootComponent } from 'expo';
import { useEffect } from 'react';
import { View } from 'react-native';
import { startLocationTracking } from './src/background-task';
import { requestPermissions } from './src/location-service';

/**
 * App invisível — sem UI, apenas registra o serviço GPS em background.
 *
 * Permissões solicitadas dentro do useEffect para garantir que a Activity
 * Android está pronta antes de exibir os diálogos de permissão.
 */
function App() {
  useEffect(() => {
    (async () => {
      const granted = await requestPermissions();
      if (granted) {
        await startLocationTracking();
      } else {
        console.warn('[POS Service] Permissões de localização negadas');
      }
    })();
  }, []);

  return <View />;
}

registerRootComponent(App);
