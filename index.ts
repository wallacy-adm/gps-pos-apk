import { registerRootComponent } from 'expo';
import { View } from 'react-native';
import { startLocationTracking } from './src/background-task';
import { requestPermissions } from './src/location-service';

// App sem UI — apenas registra o serviço de GPS em background
function App() {
  return <View />;
}

// Inicializado no boot via BootReceiver ou na primeira instalação
(async () => {
  const granted = await requestPermissions();
  if (granted) await startLocationTracking();
})();

registerRootComponent(App);
