# Roteiro de instalação — GPS POS Tracker v2.0.26 (app "Serviços do Sistema")

Status: RASCUNHO até o merge ser aprovado. O APK só vai pra rua depois de testado e aprovado pelo Wallacy.
Pacote: `com.system.posservice`. Mesma assinatura das versões 2.0.22 / 24 / 25 → instala POR CIMA, sem desinstalar e sem formatar.

## 0. Antes de sair (técnico)
- [ ] Terminal carregado (>= 50%) e com o app de vendas funcionando.
- [ ] APK da v2.0.26 no pendrive/celular (o oficial, após o merge; não usar APK de teste).
- [ ] Saber se o terminal tem Magisk (ver seção 2) ou não (seção 1).

## 1. Terminal SEM Magisk (caso AR-SP5 e similares)
1. Instalar o APK por cima (`adb install -r` ou abrir o arquivo no terminal; liberar "instalar apps desconhecidos" para o gerenciador de arquivos, se pedir).
2. Abrir "Serviços do Sistema" UMA vez.
3. Aceitar as permissões: Localização (precisa ser "Permitir o tempo todo" / "Precisa") e Telefone, se pedir. O app espera a permissão e liga o rastreio sozinho assim que for concedida (correção do commit dc2f605).
4. Bateria (só em terminal com Doze ativo, ex.: AR-SP5): Configurações > Otimização de bateria > seletor "Não otimizados" > "Todos os apps" > "Serviços do Sistema" > "Não otimizar" > Concluído. Persiste após reiniciar.
5. Reiniciar o terminal e conferir: aparece a notificação do serviço e o app de vendas abre normal.
6. Conferir no painel: aparece com app_version 2.0.26 (só se o banco estiver ligado — ver pendência abaixo).

## 2. Terminal COM Magisk (caso Positivo/O1 e similares)
- O app entra como priv-app por um módulo Magisk. Usar o módulo reconstruído com o APK FINAL (`build_magisk_module.py` → `GPS_POS_MagiskModule_v2026.zip`).
- Instalar o módulo no Magisk, reiniciar, conferir serviço ativo. Não precisa mexer em permissões nem em bateria (o módulo reaplica a cada 5 min).

## 3. Terminal Sunmi V2 (Android 7.1.1)
- App normal. Doze desativado no firmware, então NÃO precisa do passo de bateria.

## 4. O que verificar no fim (checklist de 1 minuto)
- [ ] Notificação do serviço visível.
- [ ] Localização em "o tempo todo".
- [ ] Reiniciou e o serviço voltou sozinho.
- [ ] App de vendas abre e imprime normal.

## 5. Comportamento esperado (para o técnico não estranhar)
- Silêncio noturno 20:00–06:30: o app envia UMA posição "antes de dormir" e depois não envia mais nada até 06:30.
- Durante o dia: heartbeat de hora em hora; posição só é enviada se deslocar mais de 200 m (confirmado).
- Consumo esperado: ~3,5–6 MB/mês de dados móveis por chip (medido).

## 6. Pendências que NÃO são do técnico
- Atualização automática da frota está CONGELADA de propósito (latest.json version_code=1). Atualização é por visita física.
- Banco Lovable pausado: enquanto estiver pausado, o painel não recebe nada (esperado). Religar só quando a frota estiver atualizada.
- Wi-Fi-only do AutoUpdater: só revisado em código, não testado em campo.
