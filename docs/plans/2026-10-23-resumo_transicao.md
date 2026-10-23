# Resumo de transição — 23/10/2026 (soak de 8h45 no terminal de bancada)

## Status do projeto
- Branch `v2.0.26-dev`, último commit de código `d4e20e8`. NADA mergeado em `main`. Frota intacta.
- Lovable sem crédito, banco (Supabase kyxowmjriiqzjacwltja) fora do ar (DNS não resolve) -> nenhum dado chega ao painel.
- Terminal de bancada (serial O10202230269, Positivo O1, Android 9, dados móveis, sem Wi-Fi): módulo Magisk v2.0.26 instalado e ativo (app em /system/priv-app, versionCode 43, mesma assinatura do .25).
- Módulo gerado em C:\Users\walla\Downloads\GPS_POS_MagiskModule_v2026.zip (APK do commit d4e20e8, artefato do run 39407345255).

## Teste: logcat contínuo 22/10 20:04 -> 23/10 04:51 (arquivo test-build-2026\soak-20261022-2005.log)
- Terminal parado, em dados móveis. 0 crashes. Parou às 04:51 porque o aparelho reiniciou às ~04:52 (causa NÃO identificada).
- App trocou de processo (PID 2558 -> 15425) às 21:42:36 sem crash registrado (causa NÃO identificada, log só tinha tags do app).
- 519 decisões "Parado ... nao envia" (filtro de 30m funciona nesse caminho). AutoUpdater reaproveitou/checou 2x (21:47 e 03:57, intervalo 6h ok).
- 51 tentativas de envio em 8h45, TODAS de madrugada (deveria ser silêncio): 41 logo após "GPS convergiu" (L1459-1479), o resto após fix de celular/NETWORK.

## ACHADOS NOVOS (nenhum corrigido; exigem aprovação do Wallacy antes de mexer — regra: não mudar escopo sem avisar)
1. [GRAVE] AutoUpdater.checkAndUpdate grava `lastCheckAtMs = now` ANTES do fetch (plugins/with-boot-receiver.js ~L895). Se o fetch do latest.json falha (rede celular ainda subindo logo após boot), `trackingEnabled` fica false (padrão) e a próxima tentativa só ocorre 6h depois. Enquanto isso o heartbeat periódico não envia ("Envio desligado remotamente", log real PID 2558, 20:15 a 21:30, 6 ocorrências, nenhum "Sem atualizacao" em 1h42). Efeito provável no campo: terminal reiniciado aparece "off" por até 6h. NÃO provado que o fetch falhou (o código não loga a falha) — evidência: código + log.
2. [GRAVE] Silêncio noturno não vale para envio por localização: `isActiveWindow()` só é usada no tick do heartbeat (L1572). O envio por localização (L1384-1412 e L1459-1479) não checa horário nem `trackingEnabled`. Consistente com os 4 terminais que reportam 24h.
3. [GRAVE p/ meta de 20MB] Terminal PARADO ainda gera envios: posição de celular (acc=200m) e GPS divergem ~1km ("NETWORK rejeitou GPS: ~1019m"), GPS convergido cai a >=30m do `lastSentLocation` e envia. `lastSentLocation` é gravado antes do envio (não depende de sucesso), então o banco morto NÃO explica. Estimativa (não medida, ~10KB/envio da análise de 17/09): ~0,5MB nessa noite; extrapolação mensal pode passar de 20MB. Precisa medir bytes reais quando o banco voltar.
4. [MENOR] `ACTIVE_END_HOUR = 20`; combinado era 19h. Domingo 13h nunca implementado (gap antigo).
5. [OBSERVAÇÃO] load average do aparelho ~20 constante (boot e 14h depois). Causa não investigada.

## Correções propostas (NÃO implementadas)
- A. Mover `lastCheckAtMs = now` para depois do fetch bem-sucedido (falha = tenta de novo no próximo tick: 15min à noite, 1h de dia). Logar falha do fetch.
- B. `if (!isActiveWindow() || !AutoUpdater.trackingEnabled) return;` nos 3 pontos de envio por localização. Decidir 19h x 20h.
- C. Log da distância em cada envio (diagnóstico) e histerese anti ping-pong celular x GPS (desenho a definir com dados).

## Próximos passos
1. Wallacy aprova/ajusta A, B, C (e 19h x 20h). 2. Implementar 1 por vez, commit, verificação de sintaxe como nas rodadas anteriores. 3. Gerar build de teste (workflow_dispatch na branch, só artefato). 4. Reinstalar módulo e repetir teste: reboot + olhar se "Sem atualizacao ... tracking=true" aparece logo no 1º tick; noite sem envios. 5. Só com banco no ar medir MB reais. 6. Merge para main só depois.
## Pendências antigas
- Conferir assinatura dos APKs antigos da frota (keystore aleatória) antes do rollout; backup da keystore-prod; `app.json` owner "wallacy1"; fila HTTP serializada; reuso de conexão; notificação "Atualização concluída".
## Perguntas em aberto para o Wallacy
- Quem reiniciou o aparelho às 04:52 de 23/10? (se ninguém: investigar reboot espontâneo / reboot agendado de MDM)
