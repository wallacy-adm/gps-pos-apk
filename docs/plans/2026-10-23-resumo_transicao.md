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

---
# ATUALIZAÇÃO 24/10 — A+B implementados por outra sessão e AUDITADOS aqui
- Commits `298a1b7` (A+B) e `65ea60d` (flag não lida não suspende envio por localização), push ok. Esta sessão só auditou, não editou código.
- Decisão do Wallacy: horário de parada é 20h (ACTIVE_END_HOUR=20 fica). O "19h" citado acima estava errado. D = sem mudança.
- Verificado: diff lido linha a linha; `node --check` ok; javac: 61 símbolos não resolvidos idênticos aos de d4e20e8 (nenhum novo; 434->437 erros = chamadas extras às mesmas classes Android); zero erro real de sintaxe; run 40109154698 success com headSha 65ea60d; APK 65ea60d contém as strings novas e o d4e20e8 não (sha256 64EF8E7D...); os 3 zips Magisk (Downloads\GPS_POS_MagiskModule_v2026.zip, C:\Users\walla\GPS_POS_MagiskModule.zip) carregam o APK 65ea60d.
- NÃO testado em aparelho: A (retry após falha do latest.json) e B (silêncio noturno). Terminal de bancada sem ADB em 24/10 ~18:25 (não aparece no Windows).
- Cobertura de B conferida: os 3 pontos de envio por localização passam por `locationSendAllowed()`; torre de celular e IP só são chamados dentro do ramo ativo do heartbeat (gated); `sendBootHeartbeat` envia no boot em qualquer hora (intencional).
- Riscos abertos: (1) janela 6h30-20h usa o relógio/fuso do aparelho e agora vale também pro envio por localização: terminal com hora errada fica mudo de dia — conferir `adb shell date` em terminais de campo; (2) heartbeat ainda exige a flag lida (GitHub inacessível = terminal parado fica sem sinal de vida até ler); (3) ping-pong celular x GPS de dia ainda sem tratamento (item C, não aprovado).
- Reboot espontâneo de 23/10 04:52: Wallacy confirma que NÃO foi ele; causa desconhecida (não investigada: aparelho sem ADB).
- Ideia do Wallacy (24/10): enviar só no boot, 1x de dia e ao desligar. Análise: heartbeat de hora em hora custa estimados 2-4MB/mês (não medido); "ao desligar" não é confiável (0 eventos de shutdown em 2 anos); o envio das 20h e o do boot já existem; painel precisaria mudar o critério de "off". Alternativa: heartbeat a cada 3-4h configurável remotamente via latest.json + medir bytes reais antes. Aguarda decisão.
- Roteiro de teste (quando o aparelho voltar): instalar módulo -> reboot -> ~minuto 4 `svc data disable` -> ~minuto 7 `svc data enable` -> esperar "latest.json nao lido (fetch falhou) - nova tentativa em ~5min" e depois "Sem atualizacao ... tracking=true". Noite: soak esperando ZERO "Heartbeat erro" entre 20:00 e 06:30 além do único "Silencio noturno: enviando ultima localizacao" e logs "Envio por localizacao suspenso (silencio noturno)".

---
# ATUALIZAÇÃO 25/10 — A testado em hardware; B em teste noturno
- Terminal de bancada (O10202230269) agora roda o APK 65ea60d (sha256 64ef8e7d...af133), instalado via módulo Magisk às 06:30 de 25/10 (antes estava no d4e20e8: o módulo novo nunca tinha sido instalado).
- TESTE FORÇADO DE A (resultado real): dados cortados (`svc data disable`) antes da checagem do minuto 5; às 06:36:13 o log mostrou `latest.json nao lido (fetch falhou) - nova tentativa em ~5min`. Dados religados 06:38. A nova leitura só aconteceu às 07:00:15 (`Sem atualizacao (local=43 remoto=42) | tracking=true`), ~19 min depois do backoff vencer (06:41), porque a nova tentativa só dispara quando um evento de localização chega a `locationSendAllowed()` ou no tick do heartbeat (1h de dia, 15min à noite). Conclusão: A funciona, mas a latência da nova tentativa depende de eventos; pior caso ~1h de dia. Melhoria possível (NÃO aprovada): timer dedicado de retry.
- Controle com o APK velho (boot de 25/10): a flag foi lida normalmente no boot -> a falha de 22/10 não é determinística.
- Registro cortado às 07:03:56 NÃO foi o aparelho (uptime contínuo, app vivo): foi o PC (mini PC AZW GK mini, sem bateria) entrando em suspensão às 07:04:00 até 14:48. O PC dorme várias vezes por dia em horários soltos (22/10 00:34, 07:38, 12:34; 23/10 05:31, 12:29, 19:55; 24/10 07:57, 13:31, 18:33; 25/10 07:04) mesmo com timer de suspensão = nunca (algo/alguém manda dormir).
- O reboot do aparelho de 23/10 04:52 NÃO coincide com suspensão do PC (PC dormiu às 05:31): continua sem causa.
- LOGGER NO APARELHO (independe do PC), iniciado 25/10 14:53: `logcat -f /data/local/tmp/soak/gps_soak.log -r 2048 -n 6` como root (tags GpsLocationService, AutoUpdater, AndroidRuntime:E, ActivityManager:W). Morre se o aparelho reiniciar. Para puxar: `adb shell "su -c 'cp /data/local/tmp/soak/gps_soak.log* /sdcard/'"` e `adb pull /sdcard/gps_soak.log C:\eas\gps-pos-apk\test-build-2026\`.
- B: esperado a partir de 20:00 de 25/10: UMA linha "Silencio noturno: enviando ultima localizacao antes de dormir" (com erro de DNS esperado), logs "Envio por localizacao suspenso (silencio noturno)" no máximo 1 a cada 10 min, e ZERO outros "Heartbeat erro"/"Keepalive erro" até 06:30.


## 26/10 - Resultado do teste B (silencio noturno 25/10 20:00 -> 26/10 06:30), APK 65ea60d

Fonte: log on-device (soak-ondevice-1025/gps_soak.log), processo do app vivo o tempo todo (PID 2571, sem crash/restart).

- 20:00:00 "Silencio noturno: enviando ultima localizacao antes de dormir" (1 tentativa). Depois disso ZERO tentativas de envio ate 06:30:00. Entre 20:00 e 06:30 so "Envio por localizacao suspenso (silencio noturno)" (log limitado a 1 a cada 10 min). B APROVADO.
- 06:30:00 heartbeat de abertura da janela (age=66287s = fix velho, terminal parado na bancada).
- Todos os envios falharam com DNS (backend supabase do Lovable morto) - a tentativa foi contada, o MB real NAO foi medido.
- Manha: 06:56, 07:00 e 07:08 "Heartbeat erro" sem "Heartbeat: enviando" = envios por localizacao com terminal PARADO (3 em ~40 min). Indicio de ping-pong torre x GPS (item C, NAO aprovado).
- AutoUpdater: leituras do latest.json em 25/10 19:00 e 26/10 07:13 (12h de intervalo, gate e 6h). Hipotese (nao provada): leitura de ~01:00 falhou em silencio (retrySoon sai sem log quando a flag ja e conhecida). Flag segue tracking=true.
- Bateria do terminal de teste: 35% (USB). PC dormindo corta energia.
- Fuso do device: America/Sao_Paulo, hora certa (07:23 -03).



## 26/10 (noite) - Item C aprovado + deploy de teste do 9addf97

- Decisoes do Wallacy: C aprovado; heartbeat segue de 1 em 1 hora (sem mudanca de escopo).
- C ja estava commitado em 9addf97 (histerese: desloca so se > max(30m, precisao) E um 2o fix concordante em ate 5 min chega; voltar perto do ultimo envio cancela). Aplicado nos 3 pontos de envio por localizacao. node --check OK. CI workflow_dispatch run 40350828008 (sha 9addf97) = success.
- APK do CI: SHA256 74D20A86D5FD10F4178155C7EC5D5218E53016C3E47A50F009CD25F538AFC3B0 (test-build-2026/gps-pos-v2.0.26-9addf97.apk).
- Modulo Magisk regenerado com esse APK (build_magisk_module.py) e instalado no terminal de bancada; apos reboot /system/priv-app/GPSPosService/GPSPosService.apk = 74d20a86 (versionCode 43, 2.0.26). Logger on-device religado 20:00. Log antigo salvo em test-build-2026/soak-ondevice-1026/gps_soak.log.
- Limite conhecido do C: terminal em movimento rapido (fix a fix > 50m de distancia) so confirma ao desacelerar; aceitavel porque terminais sao fixos/portateis.
- Proximo: ler log da noite 26->27/10 e checar de manha: (1) 1 so envio as 20:00, nada ate 06:30; (2) apos 06:30, mensagens "Possivel movimento ... aguardando 2o fix" sem envios falsos com terminal parado.



## 27/10 - Resultado da noite 26->27/10 com APK 9addf97 (item C), log on-device

Fonte: test-build-2026/soak-ondevice-1027 (eventos.txt). Aparelho: boot 19:59 do dia 26 (reboot do deploy), uptime 11h26 as 07:26, bateria 86%, 0 crash (AndroidRuntime).

- C FUNCIONOU: 0 "Movimento confirmado"; 3 "Possivel movimento (166m / 175m / 74m) - aguardando 2o fix concordante" entre 06:49 e 07:05 e NENHUM envio falso. Antes do C (65ea60d) eram 3 envios falsos em ~40 min na mesma janela.
- Silencio noturno OK: entre o envio de "antes de dormir" e 06:30 so "Envio por localizacao suspenso". O envio de "antes de dormir" saiu 2x (20:45:23 e 21:26:45) porque o processo reiniciou no meio (flag e por processo, nao por dia). Custo: 1 envio extra por reinicio noturno do app.
- 06:30:00 heartbeat de abertura + 06:31:05 1 envio extra = "primeiro envio apos iniciar" (lastSentLocation nulo no processo novo), por desenho.
- "age=1793093400s" no log do heartbeat NAO e bug de posicao: age = tempo desde o ultimo envio (lastSentTime=0 em processo novo). So log.
- Ruido de rede persistente: "NETWORK rejeitou GPS" ~900-1100m (ate 3km) e "Jump impossivel" a noite toda = torre x GPS divergem ~1km. Filtros seguram; sem consequencia de envio.
- AutoUpdater pos-boot: 3 falhas de leitura do latest.json (20:02, 20:07, 20:17) com backoff 5/10/20 min, leitura OK 20:37:46 (tracking=true). A funciona.
- ANOMALIA ABERTA: 26/10 21:11:33 o sistema matou varios processos de uma vez (LatinIME, posservice pid 2573 e outros) - "Scheduling restart of crashed service ... GpsLocationService in 10986ms"; servico voltou em ~12s (START_STICKY), sem AndroidRuntime. Mesmo padrao de 22/10 21:42. Memoria nao e a causa (MemAvailable 1.27GB de 1.9GB). Suspeita NAO provada: MDM (com.xcheng.mdm). Load average ~20 constante.

