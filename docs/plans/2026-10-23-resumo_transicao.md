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



## 27/10 (manha) - Correcoes pos-soak: silencio noturno por NOITE + heartbeat sem exigir flag lida (APK 9ac366a)

Pedido do Wallacy: corrigir o envio duplicado "antes de dormir" com rigor maximo (zero retrabalho).

Causa raiz: nightSilenceSent era volatile em memoria -> app morto pelo sistema (21:11) ou reiniciado = processo novo reenviava. Agravante achado na auditoria: o tick do heartbeat exigia trackingEnabled (default false) -> com a flag ainda nao lida o 1o tick apos boot era engolido (envio "antes de dormir" saiu 45 min depois do boot).

Commits (branch v2.0.26-dev, main intocada):
- 55ffe39: noite persistida em SharedPreferences (posservice_state / night_sent_id, commit sincrono). Id = yyyyMMdd da data em que a noite COMECOU (20h); antes das 6h30 ainda e a noite de ontem. Heartbeat de boot feito de noite tambem marca a noite como coberta (nao gasta 2o envio).
- 9ac366a: tick do heartbeat so suspende se flag LIDA e desligada (mesma regra de locationSendAllowed). Heartbeat de boot ja era incondicional. Interruptor remoto continua valendo assim que a flag e lida.

Verificacao feita: node --check OK; javac so reclama de simbolos do Android (sem android.jar), nenhum erro de sintaxe; teste Java da logica da noite (virada de mes/ano, 20:00-06:29 = 1 id so) = TUDO OK; CI run 40490002085 (sha 9ac366a) success; APK SHA256 28F5986BE28794F4273A02606D2889D093CADEBB6E30DFD334615A62C522A080 contem night_sent_id; instalado na bancada via modulo (sha em /system/priv-app confere, versionCode 43), logger on-device religado 07:46.

Pendente de validacao em hardware (so possivel a noite): (1) 1 unico envio "antes de dormir" por noite; (2) matar o processo depois do envio (kill) e confirmar que o processo novo NAO reenvia; (3) 06:30 heartbeat normal.
Risco residual conhecido: relogio do aparelho errado/ajustado no boot muda o id da noite -> no maximo 1 envio extra por ajuste.



## 28/10 - Validacao da noite 27->28 (APK 9ac366a) + Fase 0 do plano (assinatura e latest.json)

### Noite 27->28 (log on-device, soak-ondevice-1028)
- 1 unico "Silencio noturno: enviando" as 20:00:00; nada ate 06:30:00 (heartbeat de abertura). 0 crash. Heartbeat horario cravado no minuto :46:08.
- Marca persistida confirmada no aparelho: shared_prefs/posservice_state.xml -> night_sent_id=20261027.
- AutoUpdater: leituras do latest.json 19:47 e 01:52 (gate de 6h OK; a leitura "12h depois" de 26/10 nao se repetiu).
- AINDA NAO TESTADO: matar o processo de noite depois do envio e confirmar que o processo novo nao reenvia (fazer a noite).
- Observacao (nao alterado): 5 "Movimento confirmado" no dia, varios de 60-96m (GPS indoor derivando, 2 fixes concordam). Geofence do painel e 250m -> envio < ~100m nao ajuda a detectar "saiu do ponto". Possivel ajuste futuro: limiar maior (ex. max(100m, precisao)). Decisao do Wallacy.

### Fase 0.1 - Assinatura: RESOLVIDA (todos os APKs tem o MESMO certificado)
- Metodo: leitura do APK Signing Block v2 (script sigparse.py) dos APKs: releases v2.0.14, .16, .18, .20, .21, .22, .23, .24, .25 e todos os builds 2.0.26 (d4e20e8, 65ea60d, 9addf97, 9ac366a, build 18/10). Resultado: SHA-256 do cert comeca com fac61745dc090378 em TODOS.
- Conclusao: instalar a 2.0.26 POR CIMA da instalada funciona, sem desinstalar, mantendo permissoes e dados -> terminais sem Magisk NAO precisam de migracao unica. A hipotese anterior ("keystore aleatorio a cada build") estava ERRADA para as releases. Logo a perda do app no bench em 18/10 nao foi por assinatura (foi a troca de app de sistema para app comum + MDM).
- Ressalva: falta confirmar em 1 terminal real da frota (adb/pm path) que o APK instalado tem esse mesmo cert. Backup da keystore-prod continua obrigatorio (nao verifiquei que o cert da keystore-prod e fac617..., exige senha).

### Fase 0.2 - latest.json atual e downloads em terminais antigos
- latest.json em main = version_code 42 (2.0.25), apk_url release v2.0.25 (29,5 MB), tracking_enabled true.
- Codigo das tags v2.0.20, v2.0.22 e v2.0.25 (AutoUpdater): a cada 6h (gate em MEMORIA, zera a cada reinicio do processo) le o latest.json e, se latestCode > versionCode local, BAIXA o APK inteiro (29,5 MB) por qualquer rede, sem trava de Wi-Fi e sem cache (cache so na 2.0.26). Chamadores: 5 min apos start do servico e todo tick de heartbeat.
- versionCode por versao: 2.0.18=35, .20=37, .21=38, .22=39, .23=40, .24=41, .25=42. Terminais em 2.0.18-2.0.24 (vc < 42) baixam 29,5 MB a cada ~6h (ou a cada reinicio do app) enquanto o latest.json disser 42. Chip: 20 MB/mes. Hipotese forte (NAO medida - backend morto) para os terminais "mudos por dias".
- Proposta (NAO executada, aguarda OK do Wallacy): congelar latest.json em main com version_code baixo (ex. 1) por commit com "[skip ci]" (nao dispara build). Interruptor remoto tracking_enabled continua valendo. Reversivel por novo commit. Cuidado: o CI sobrescreve latest.json em todo push normal para main -> ajustar o workflow antes do merge da v2.0.26 (ex.: nao publicar version_code novo para auto-update ate a frota estar toda na 2.0.26+).



## 28/10 (tarde) - Trava de Wi-Fi no download do APK + limiar 100m (commit d17412b, APK 978F7C3D...86A7C)

Autorizacao do Wallacy: "faca tudo que for melhoria" (28/10), congelamento do latest.json aprovado ("sim").

- NAO executado: congelar latest.json em main (version_code=1, commit com [skip ci]). A protecao de seguranca do ambiente bloqueou o push para main ("Production Deploy"); nao foi contornado. Pendente: o Wallacy liberar a acao OU editar o arquivo no site do GitHub (passo a passo dado a ele). main continua em 48983ae.
- d17412b (v2.0.26-dev): (1) AutoUpdater so baixa o APK em rede sem cobranca (onUnmeteredNetwork: rede conectada e !isActiveNetworkMetered; qualquer erro = nao baixa); so o JSON pequeno usa o chip. (2) MIN_SEND_DIST_M 30 -> 100. (3) addPerm ACCESS_NETWORK_STATE.
- Prova no aparelho (APK de TESTE, branch descartavel test-wifi-guard apontando o updater para test-latest.json v99): no chip -> "Atualizacao vCode=99 disponivel - NAO baixa pelo chip" e nenhum download; com Wi-Fi ligado (brisa-980917) + app reiniciado -> "Nova versao vCode=99 baixando... Download OK: 175 bytes". Os dois lados funcionam. Arquivo staged de teste removido antes do watcher agir; Wi-Fi do bench desligado de novo.
- Build real: CI run 40675599269 success, sha d17412b, APK 978F7C3D8EF39D9B04C1D5C63646A6531CF814B303839FF7242B52852AE86A7C, cert fac61745... (igual a frota). Instalado na bancada via modulo, versionCode 43, logger religado ~08:35.
- Verificacao de codigo: node --check ok; javac so reclama de simbolos do Android.
- Pendente ainda: teste de "matar o app de noite depois do envio" (fazer depois das 20:00 com este APK); confirmar cert num terminal real da frota; backup da keystore-prod pelo Wallacy; ajuste do workflow antes do merge (CI nao pode religar o download automatico para a frota antiga); painel "pendentes de instalacao" quando o banco voltar.



## 29/10 - latest.json CONGELADO em main + ajuste anti ping-pong (APK 313e7d7)

- FEITO (liberado pelo Wallacy em 28-29/10): main 48983ae -> 2ba28af = latest.json com version_code=1 (tracking_enabled=true, apk_url e version_name inalterados, campo _nota explicando), commit com [skip ci]. Verificado: nenhum run novo de CI em main (ultimo run de main segue 06/10); raw.githubusercontent mostra version_code 1. Reverter = novo commit voltando o numero (nao subir acima de 42 sem a frota atualizada). ATENCAO: qualquer push normal em main faz o CI sobrescrever latest.json (workflow le versao do app.json) - ajustar o workflow ANTES do merge da v2.0.26.
- Noite 28->29 (APK d17412b): 1 envio "antes de dormir" as 20:00:00, nada ate 06:30:00 (heartbeat). Sem reinicio do app (mesmo PID 2581, uptime 23h). Heartbeat horario OK.
- DEFEITO achado no C: 14 "Movimento confirmado (224m...)" em 28/10 10:14-15:44 com o terminal parado. Causa: fixes de torre (acc=200m) alternando a 224m passavam o limiar (need = max(100, 1x precisao) = 200 < 224). Corrigido em 313e7d7: need = max(100m, 2x precisao) (torre 200m -> 400m, GPS bom -> 100m). Build CI 40856260330 success, APK SHA256 FE543E6017F5DC7B319E55A4C98D5F47ACC3F98A15CC35BE4861B6C5050FB8F7, cert fac61745..., instalado na bancada e logger religado.
- ESTIMATIVA (nao medida): cada envio abre 2 conexoes HTTPS novas (~5-10KB cada); 13 heartbeats/dia + 14 movimentos/dia podia chegar a ~8MB/mes so de envios. Medicao real depende do backend.
- ALERTA: bateria da bancada em 7% (USB do PC nao sustenta; PC nao dormiu). Precisa tomada de parede. Se desligar, perde logger/teste.
- PENDENTE: teste de matar o app de noite depois do envio (com 313e7d7); ajuste do workflow antes do merge; assinatura num terminal real da frota; backup keystore-prod; painel "pendentes de instalacao" quando o banco voltar.



## 30/10 - Noite 29->30 (APK 313e7d7) + workflow protegido para o merge

- Resultado da noite (log on-device, soak-ondevice-1030): 0 "Movimento confirmado" em 24h com o terminal parado (era 14 no dia anterior) -> ajuste 2x precisao FUNCIONA; 3 "Possivel movimento" (803/988/923m, torre) ficaram so pendentes. 13 heartbeats horarios, 1 "Silencio noturno: enviando" as 20:00:00, nada ate 06:30:00, 0 crash, sem reinicio (uptime ~24h), bateria 84% (Wallacy ligou na tomada).
- Congelamento confirmado no aparelho: AutoUpdater leu "local=43 remoto=1 | tracking=true" (29/10 07:27, 13:27, 19:28; 30/10 01:30) - gate de 6h ok.
- Posservice_state.xml: night_sent_id=20261029 persistido.
- Teste de matar o app de noite AUTOMATIZADO no PC: script killtest.ps1 mata o processo as 20:30 de 30/10 e as 03:00 de 31/10, espera 15 min e grava em test-build-2026/killtest-30-10.txt (prefs antes/depois, pid, linhas de envio). Esperado: NENHUMA linha "Silencio noturno: enviando" depois do kill (o heartbeat de boot a noite e incondicional e silencioso = 1 envio por reinicio, inerente).
- Workflow (commit 1a9902a, so v2.0.26-dev): passo "Atualizar latest.json" preserva o version_code existente (padrao 1) e grava o codigo novo em released_version_code. Testado em bash real em 5 cenarios (congelado, tracking false, ausente, corrompido, ja liberado 42) + YAML validado (js-yaml). Simulacao de merge (git merge-tree v2.0.26-dev -> main): SEM conflito; latest.json resultante continua congelado; app.json = versionCode 43.
- Efeito colateral conhecido do CI (inalterado): se latest.json estiver ausente/corrompido grava tracking_enabled=false (kill switch ligado). Nao mexido.
- PENDENTE: ler killtest (31/10 cedo); assinatura num terminal real da frota; backup keystore-prod; painel "pendentes de instalacao" quando o banco voltar; roteiro de instalacao manual nos terminais sem Magisk; decidir merge (so com OK explicito).



## 31/10 - Teste de matar o app de noite: APROVADO (APK 313e7d7)

- Contexto: queda de energia em 30/10 desligou o PC (19:51 religou); script killtest.ps1 religado 20:01.
- KILL 1 (20:30, 30 min depois do envio das 20:00): pid 2570 -> 17204; prefs antes/depois iguais (night_sent_id=20261030); apos o kill so "GPS_PROVIDER iniciado" e "Envio por localizacao suspenso"; NENHUM novo "Silencio noturno: enviando".
- KILL 2 (03:00): pid 17204 -> 2088; prefs iguais; apos o kill so "GPS_PROVIDER iniciado" e "suspenso"; NENHUM novo "Silencio noturno: enviando". Contagem no arquivo = 2 (as das noites 29/10 e 30/10 as 20:00, ambas ANTES dos kills).
- Conclusao: o envio "antes de dormir" agora e 1 por noite e sobrevive a morte do processo (comportamento esperado: o heartbeat de boot de noite e silencioso e incondicional).
- ALERTA: as 06:30 de 31/10 o terminal de bancada nao aparece no adb (nenhum dispositivo). Bateria estava em 38% as 20:01 de 30/10, so no USB do PC (sem tomada de parede) -> provavel desligamento por bateria. Logs da noite ficam em /data/local/tmp/soak no aparelho (sobrevivem ao desligamento; puxar depois de religar).



## 31/10 - Teste 'sem Magisk' no terminal de bancada (O10202230269, Android 9)

- Desativei o modulo (arquivo disable) e reiniciei: app sumiu (sem priv-app). Instalei o APK 313e7d7 via adb como app comum: 'Success' (07:44:43 e 07:46:30).
- RESULTADO: o pacote foi REMOVIDO ~8 s depois nas 2 tentativas (07:46:30 instalou; 07:46:38 'deletePackageX'). Quem removeu NAO esta identificado (logcat nao mostra o chamador). Suspeitos: com.xcheng.mdm / com.pos.mdmservice / com.xcheng.store (todos apps de sistema, nao removiveis).
- IMPLICACAO: neste modelo/firmware, instalar como app comum NAO se sustenta. Nao assumir que 'sem Magisk' funciona na frota ate testar em 1 terminal real.
- Restaurei: removi o disable, reiniciei; priv-app de volta (codePath=/system/priv-app/GPSPosService, versionCode=43), app rodando, logger no aparelho religado.
- Obs: bateria parada em 35% com 'USB powered: true, AC: false' mesmo na tomada (carrega muito pouco ou nada).


## 31/10 - Teste em 2o terminal (Sunmi V2, serial VB52231920081, Android 7.1.1, firmware ZAP1522-Sunmi, sem MDM Xcheng, app de vendas cambista instalado)

- Estado inicial: app NAO instalado; tem /sbin/magisk mas su negado (sem root pratico).
- adb install -r do APK 313e7d7 como app comum (/data/app): PERMANECEU instalado (diferente do terminal de bancada, que removeu em ~8 s).
- Abrir o app uma vez (monkey): permissoes de localizacao/telefone ficaram concedidas; app fechou sozinho (moveTaskToBack).
- ACHADO: depois da instalacao + abrir o app, o GpsLocationService NAO subiu. So sobe em BOOT_COMPLETED / QUICKBOOT / MY_PACKAGE_REPLACED (BootReceiver). Instalacao nova nao dispara nenhum dos tres.
- Apos reboot: BootReceiver rodou, GpsLocationService em foreground (foregroundId=99), pedindo localizacao 'network' a cada 15 s, 3 alarmes registrados. Funciona.
- Obs: neste terminal o provedor GPS esta desligado nas configuracoes do sistema (location_providers_allowed=network): so localizacao por torre/rede.
- Obs: whitelist de bateria (deviceidle) NAO inclui o app (o dialogo so aparece 1x na 1a abertura e nao apareceu/nao foi aceito aqui).
- Conclusao: a frota tem pelo menos 2 modelos com comportamento diferente. Instalar manual = instalar + REINICIAR o terminal (ou corrigir o app para subir o servico ao abrir).
