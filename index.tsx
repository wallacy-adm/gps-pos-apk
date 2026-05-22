import { registerRootComponent } from 'expo';
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { startLocationTracking } from './src/background-task';
import { requestPermissions } from './src/location-service';

function App() {
  const [status, setStatus] = useState('Iniciando...');

  useEffect(() => {
    (async () => {
      try {
        setStatus('Solicitando permissoes...');
        const granted = await requestPermissions();

        if (!granted) {
          setStatus('ERRO: Permissao de localizacao negada.\nVa em Configuracoes > Apps > POS Service > Permissoes > Localizacao > Sempre permitir');
          return;
        }

        setStatus('Iniciando servico GPS...');
        await startLocationTracking();
        setStatus('Servico GPS ativo\nEnviando localizacao a cada 30s');
      } catch (err: any) {
        setStatus('ERRO: ' + (err?.message ?? String(err)));
      }
    })();
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>POS Service</Text>
      <Text style={styles.status}>{status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    color: '#94a3b8',
    fontSize: 14,
    marginBottom: 16,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  status: {
    color: '#e2e8f0',
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 26,
  },
});

registerRootComponent(App);
