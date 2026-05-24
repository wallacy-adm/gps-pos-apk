import { registerRootComponent } from 'expo';
import { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, BackHandler, Text, TouchableOpacity, View } from 'react-native';
import { startLocationTracking } from './src/background-task';
import { checkBatteryOptimization, openBatterySettings, requestPermissions } from './src/location-service';

/**
 * Activity de inicialização do serviço GPS.
 *
 * Fluxo:
 *   1. Solicita permissões de localização e telefone
 *   2. Verifica se otimização de bateria está desativada
 *      → Se SIM: inicia GPS e fecha o app imediatamente
 *      → Se NÃO: mostra tela pedindo ao usuário para ativar
 *   3. Quando usuário retorna das configurações (AppState: background→active):
 *      → Reconfirma isenção → inicia GPS → fecha o app
 *
 * O ForegroundService continua rodando após o fechamento do app.
 */
function App() {
  const [step, setStep] = useState<'loading' | 'battery' | 'done'>('loading');
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  const launchAndClose = async () => {
    try {
      await startLocationTracking();
    } catch (_) {
      // Serviço pode já estar rodando — ignora
    }
    BackHandler.exitApp();
  };

  // Inicialização: permissões → checar bateria
  useEffect(() => {
    (async () => {
      try {
        const granted = await requestPermissions();
        if (!granted) {
          BackHandler.exitApp();
          return;
        }
        const exempt = await checkBatteryOptimization();
        if (exempt) {
          await launchAndClose();
        } else {
          setStep('battery');
        }
      } catch (_) {
        // Falha silenciosa — BootReceiver vai tentar novamente
        BackHandler.exitApp();
      }
    })();
  }, []);

  // Quando usuário volta das configurações de bateria
  useEffect(() => {
    if (step !== 'battery') return;
    const sub = AppState.addEventListener('change', async (next: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if ((prev === 'inactive' || prev === 'background') && next === 'active') {
        const exempt = await checkBatteryOptimization();
        if (exempt) {
          setStep('done');
          await launchAndClose();
        }
      }
    });
    return () => sub.remove();
  }, [step]);

  // Tela preta durante carregamento / após confirmação
  if (step === 'loading' || step === 'done') {
    return <View style={{ flex: 1, backgroundColor: '#000000' }} />;
  }

  // Tela de ativação de bateria — mantém o app aberto até o usuário agir
  return (
    <View style={{
      flex: 1,
      backgroundColor: '#0f172a',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 32,
    }}>
      <Text style={{
        color: '#f1f5f9',
        fontSize: 20,
        fontWeight: 'bold',
        textAlign: 'center',
        marginBottom: 12,
      }}>
        Ativação necessária
      </Text>

      <Text style={{
        color: '#94a3b8',
        fontSize: 15,
        textAlign: 'center',
        lineHeight: 24,
        marginBottom: 36,
      }}>
        Para funcionar com a tela desligada, este serviço precisa ser excluído da
        otimização de bateria.{'\n\n'}
        Na próxima tela, toque em{' '}
        <Text style={{ color: '#22c55e', fontWeight: 'bold' }}>"Permitir"</Text>.
      </Text>

      <TouchableOpacity
        onPress={openBatterySettings}
        activeOpacity={0.8}
        style={{
          backgroundColor: '#3b82f6',
          paddingVertical: 16,
          paddingHorizontal: 40,
          borderRadius: 12,
        }}
      >
        <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 16 }}>
          ATIVAR AGORA
        </Text>
      </TouchableOpacity>

      <Text style={{
        color: '#475569',
        fontSize: 11,
        textAlign: 'center',
        marginTop: 28,
        lineHeight: 17,
      }}>
        Após permitir, este app fecha automaticamente.{'\n'}
        Nenhum dado pessoal é coletado.
      </Text>
    </View>
  );
}

registerRootComponent(App);
