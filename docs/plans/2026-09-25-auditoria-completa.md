# Auditoria Completa — GPS POS Tracker
**Gerado em:** 25/09/2026, consolidando toda a investigação desta sessão (não substitui o resumo de 13/09, complementa)

**STATUS:** MODO PLANEJAMENTO. Nenhuma linha de código alterada nesta sessão. A v2.0.26 só entra em produção quando cada item abaixo estiver resolvido E o escopo confirmado explicitamente por Wallacy. Tolerância ZERO a erro nessa versão — lição direta do dia de trabalho perdido com a v2.0.25.

**Como usar:** se abrir um chat novo, arraste este arquivo junto com o `2026-09-13-resumo_transicao.md` e diga "leia os dois e me diga onde paramos".

---

## 1. Especificação combinada (fonte de verdade, confirmada por Wallacy em 25/09)
- Janela ativa da frota: **19h00 às 6h30**, segunda a sábado
- Domingo: ativo só das **6h30 às 13h00**
- Dado móvel: **20MB/mês, individual por chip** (não é pool compartilhado entre terminais)
- Terminal Bia Campos sales: desloca-se **no máximo 3 metros** fisicamente (balcão até a tomada mais próxima) — qualquer leitura muito além disso é erro de GPS, nunca movimento real
- Wallacy acha que deixou marcado, em alguns terminais, "não trabalhar em segundo plano" e "permitir instalação de app desconhecido" — não tem certeza do nome exato de cada configuração

---

## 2. Bugs confirmados — app Android (`gps-pos-apk`, `plugins/with-boot-receiver.js`)

### 2.1 [GRAVE] Threads sem fila no envio de rede — diagnóstico refinado (26/09, leitura completa do `onLocationChanged`)
Correção importante em relação ao que estava registrado antes: dentro de uma ÚNICA chamada a `sendToSupabase()`, heartbeat e location NÃO são duas threads separadas — são sequenciais, uma espera a outra (heartbeat primeiro, usa o `device_id` da resposta pra gravar location depois). A causa real da falta de fila é outra, e mais ampla: existem **3 pontos independentes** que cada um dispara sua própria `new Thread`, sem nenhuma coordenação entre eles: (1) `onLocationChanged` a cada fix aceito de GPS/rede, (2) o loop interno de heartbeat (`scheduleHeartbeat`, dentro do próprio serviço, dispara `sendKeepalive` ou `sendToSupabase` conforme o caso), (3) o `AlarmReceiver` externo (via `AlarmManager` do Android, funciona mesmo se o processo caiu). Quando dois desses disparam quase juntos — ex: um fix GPS chega bem na hora que o heartbeat interno também dispara — as duas threads competem sem fila, e é aí que o banco pode gravar fora de ordem.

Cada heartbeat/location dispara em `new Thread` separada, sem fila nem sincronização entre os 3 pontos acima. Causa raiz de dois problemas ao mesmo tempo:
- Falso positivo de geofence (leituras chegam fora de ordem no banco)
- Falso negativo de geofence (gatilho do banco não acha a leitura correspondente e fica em silêncio — ver 2.7)

**Fix:** fila única (`ExecutorService` de 1 thread, ou `WorkManager`) — todo envio de rede passa por ali, em ordem, um de cada vez.

### 2.2 [GRAVE] `MIN_DIST_M = 0f`
Reporta posição a cada 30s mesmo com o terminal completamente parado, sem nenhum filtro de distância mínima. Maior causa isolada do consumo de dado — terminais ativos chegam a 340-780MB/mês contra um plano de 20MB.

**Fix:** limiar de distância mínima pra justificar um novo report.

### 2.3 [GRAVE] Sem reaproveitamento de conexão HTTP
`HttpURLConnection` nova a cada chamada (`conn = url.openConnection()` ... `conn.disconnect()` no finally) — handshake TLS completo em toda chamada, mesmo pra ~340 bytes de dado útil.

**Fix:** cliente HTTP único, com connection pool, reaproveitado entre chamadas.

### 2.4 Janela de silêncio noturno errada e incompleta
`ACTIVE_END_HOUR = 20` no código (deveria ser 19, conforme o combinado). A função `isActiveWindow()` não verifica dia da semana em nenhum momento — a exceção de domingo (6h30-13h) nunca foi implementada. E essa janela só afeta o heartbeat de backup (`AlarmReceiver`/`AlarmScheduler`) — o loop principal de GPS não tem nenhuma lógica de horário, tenta rodar 24h por dia sozinho.

**Fix:** corrigir a hora de 20 pra 19, implementar checagem de dia da semana pro domingo, e aplicar a janela também no loop principal de GPS, não só no heartbeat de backup.

### 2.5 `wakeLock.acquire()` sem timeout
Chamado sem parâmetro de prazo — se o serviço morrer de forma anormal (kill abrupto do processo, sem passar por `onDestroy()`), a trava de bateria pode ficar presa indefinidamente.

**Fix:** acquire com prazo máximo (ex: 2h), renovando periodicamente enquanto o serviço estiver de fato ativo.

### 2.6 Isenção de bateria incompleta — hipótese mais forte pro "sumiço sem volta"
`requestBatteryOptimizationExemption()` existe e funciona, mas:
- Comentário no próprio código confirma: "alguns ROMs de POS não implementam essa tela" — nesses terminais não tem como conceder a isenção por nenhum caminho padrão do Android
- Essa API só alterna entre os níveis "Otimizado" e "Ilimitado" — **não tira o app do nível "Restrito"**, que é uma configuração manual separada, mais agressiva, e bloqueia toda atividade em segundo plano

**Hipótese forte, ainda não confirmada fisicamente:** Wallacy lembra de ter deixado marcado "não trabalhar em segundo plano" em alguns terminais. Se isso corresponder ao nível Restrito, explica por que as duas camadas de recuperação do app (START_STICKY do serviço + restart via `AlarmReceiver`) falham ao mesmo tempo — um app Restrito não pode nem iniciar serviço em primeiro plano a partir de segundo plano, nem recebe o alarme que dispara essa tentativa direito.

**Por que só alguns terminais, não todos:** frota tem hardware/ROM heterogêneo (Positivo, CIE2020, AR-SP5, Sunmi, outros) — a mesma ação pode ter efeito diferente ou nenhum efeito dependendo do modelo; instalação foi feita aos poucos, ao longo de meses, procedimento evoluindo no caminho, não necessariamente igual em todos.

**Fix:** reportar `isIgnoringBatteryOptimizations()` pro banco a cada heartbeat — a checagem já existe no código nativo (`ImeiModule`) e tem wrapper em `location-service.ts` (`checkBatteryOptimization()`), mas o resultado nunca é enviado pro servidor. Hoje ninguém sabe, olhando o painel, quais terminais têm essa proteção ativa.

### 2.7 Gatilho de geofence com a direção de erro invertida (banco, mas causa raiz é a 2.1)
`check_geofence_on_location_update`: quando não acha, na tabela `locations`, uma leitura GPS que bata com a posição em até 10 segundos, simplesmente sai sem fazer nada — não confirma, não nega, não alerta. Como a causa 2.1 faz esse cruzamento falhar com frequência (a leitura em `locations` pode não ter sido gravada ainda quando o gatilho roda), o resultado observado é grave: terminal pode se deslocar quilômetros com leituras GPS de altíssima precisão confirmadas e nunca disparar alerta nenhum.

Casos reais confirmados com dado: Graciane (18 leituras de 1-3m de precisão, 27 minutos seguidos, a 4km do ponto — zero alerta); "Nome" (1 leitura de 1,1m de precisão, a 3km do ponto — zero alerta, terminal foi mudo logo depois).

**Fix:** a mesma fila única de 2.1 resolve a causa de fundo. Complementar: o gatilho não deveria "ficar em silêncio" quando não confirma — deveria marcar como "não confirmado/pendente" em vez de tratar como "dentro do ponto" por padrão. Um sistema de alerta nunca deveria ter "não sei" e "está tudo bem" com a mesma aparência.

### 2.8 `last_lat`/`last_lng` não filtra por qualidade de leitura
Esse campo alimenta o pino no mapa e o histórico de posição do terminal — aceita qualquer provider, inclusive leitura de rede ruim, mesmo quando o alerta formal (2.7) já sabe ignorar rede pra essa decisão.

Caso real: leitura de rede a ~500m do lugar certo, registrada pra Bia Campos sales no mesmo dia da checagem — não gerou alerta formal, mas apareceu no histórico/mapa. Essa é a explicação mais provável pro "sinal falso" que Wallacy via no dia a dia e que motivou o confronto com a funcionária (ver seção 5).

**Fix:** priorizar GPS sobre rede nesse campo também — mesmo filtro que já existe pro alerta formal.

---

## 3. Bugs confirmados — painel (`gps-cg`, repositório separado, React/TS via Lovable)

### 3.1 Janela de horário duplicada, com o mesmo erro do app
`src/lib/fleet.ts`, função `isWithinActiveWindow()`: cópia própria e independente da mesma lógica do item 2.4 — mesmo erro (20h em vez de 19h), sem checagem de domingo. Corrigir só no app não resolve o painel, e vice-versa — são dois códigos separados, em dois repositórios diferentes, que precisam ficar sincronizados.

### 3.2 Lista e detalhe do terminal mostram estados diferentes pro mesmo terminal
- Lista (`devices.index.tsx`) usa `connState()`: 3 estados (ligado / em repouso / sem sinal) — RESPEITA a janela de horário
- Detalhe (`devices.$id.tsx`) usa `deviceHealth()`: efetivamente 2 estados (online/offline) — NÃO respeita a janela de horário, sempre mostra "Offline" (vermelho) fora do horário mesmo quando o terminal está só em repouso programado

Resultado possível: o mesmo terminal, no mesmo instante, aparece "em repouso" (cinza, tranquilo) na lista e "Offline" (vermelho, alarmante) no detalhe. Essa é a explicação mais provável, no código, pra sensação de "não saber no que confiar" que Wallacy descreveu.

**Fix:** unificar os dois cálculos num só, usado em ambas as telas.

### 3.3 Campo `status` do banco nunca reflete a realidade
Sempre "online" no banco, mesmo em terminais parados há mais de 8 dias — confirmado que nenhuma lógica real (nem app, nem painel) depende desse campo pra decidir online/offline hoje. Provável resquício de uma versão anterior do sistema.

---

## 4. Não é bug de código (confirmado, fechado, sem ação necessária)
- **Nome do dispositivo salvando errado**: confirmado que não é o app (o app nunca manda um campo "nome" pro banco) nem lógica aleatória no painel — o painel tem uma função `renameDevice()` real, chamada quando alguém digita um nome na tela. O valor "Nome" salvo era erro humano de digitação (provavelmente o texto de exemplo do campo, submetido sem ser trocado). Já corrigido manualmente por Wallacy. Só fica o cuidado de conferir o nome na hora de cadastrar um terminal novo.
- **Terminais parando de reportar por volta das 18h**: mundano, confirmado por Wallacy — é o horário real em que o pessoal fecha o ponto de venda, não bug. (Ainda seria bom o horário programado, 19h, bater melhor com a realidade, 18h — ver item 2.4/3.1, mas o gatilho em si não é bug.)

---

## 5. Incidentes reais já causados por esses bugs (harm concreto, não só técnico)
- **Bia Campos sales**: 2 alertas falsos de "saiu do ponto" (22/09, 281m e 304m de desvio — confirmado fisicamente impossível, o raio real de deslocamento dela é 3m). Wallacy confrontou a funcionária sobre isso, chamou de mentirosa, baseado no dado falso do sistema — ela não tinha saído do lugar em momento algum.
- **Michelle** (256m, 22/09) e **Luana são josé** (326m, 19/09): mesmo tipo de alerta falso registrado no sistema — risco real de repetir o mesmo erro com elas se checadas do mesmo jeito, sem saber que o dado pode ser falso.
- **Graciane**: 4km de deslocamento real, confirmado com 18 leituras de GPS de alta precisão — zero alerta disparado (falso negativo, o oposto do problema acima, mesma causa raiz).
- **7 de 28 terminais (25% da frota)** presos além do ciclo normal no momento da checagem em 25/09 (de 27h a 196h sem reportar). Angelica e Bia salão tinham WiFi validado (internet de verdade, confirmado via `NetworkCapabilities.NET_CAPABILITY_VALIDATED` no código) e mesmo assim pararam — descarta "acabou o dado do plano" como explicação única pra esses dois casos específicos, aponta mais pro item 2.6.

---

## 6. Perguntas que só acesso físico a um terminal resolve
- [ ] Configurações → Apps → app → Bateria: está em "Restrito"? (hipótese principal pro sumiço sem volta, item 2.6)
- [ ] Existe algum menu próprio do fabricante tipo "apps protegidos"/"autostart"/"gerenciador de energia"?
- [ ] A tela padrão de isenção de bateria do Android existe nesse aparelho, ou é um dos ROMs que não implementam?
- [ ] Testar Magisk completo no Positivo L3 — pendente desde 22/09: baixar o APK completo (não o stub) da fonte oficial e `adb install -r` direto, sem passar pelo updater quebrado
- [ ] Confirmar no app da operadora o consumo de dado de 1-2 chips parados (Graciane, "Nome"), pra medir se dado acabando é causa real em algum caso

---

## 7. Ordem de prioridade proposta (aguardando confirmação de escopo do Wallacy)
1. Fila única + conexão HTTP reaproveitada + limiar de movimento (2.1 + 2.2 + 2.3) — resolve falso positivo, falso negativo E consumo de dado numa única refatoração
2. Gatilho nunca ficar em silêncio quando não confirma (2.7)
3. `last_lat`/`last_lng` priorizar GPS sobre rede (2.8)
4. Corrigir janela de horário nos dois lugares — app e painel (2.4 + 3.1) — e unificar o cálculo de status entre lista e detalhe (3.2)
5. Reportar status de isenção de bateria pro banco (2.6) — isso sozinho destrava enxergar o problema terminal por terminal, sem precisar mais adivinhar
6. `wakeLock` com timeout (2.5)
7. O item 6 desta lista (perguntas de campo) decide se falta algo mais grave: Restrito manual (2.6) vs autostart de fabricante — só resolve com acesso físico

**Nada disto entra em código até Wallacy confirmar o escopo explicitamente, por item.**

---

## 8. ACHADO NOVO E CRÍTICO (25/09, sessão de continuação) — interruptor remoto de envio, hoje DESLIGADO em produção

`AutoUpdater` tem um campo `trackingEnabled` (static, começa `false` "por segurança"), atualizado a partir de `tracking_enabled` no arquivo `latest.json` publicado em `raw.githubusercontent.com/wallacy-adm/gps-pos-apk/main/latest.json`. Esse arquivo é lido a cada heartbeat em horário ativo (throttle de 6h entre checagens reais).

**Confirmado ao vivo, buscando o arquivo de verdade agora:**
```json
{ "version_code": 42, "version_name": "2.0.25", "tracking_enabled": false }
```

**O que esse interruptor afeta, confirmado no código (único ponto de leitura, linha ~1458 de `GpsLocationService.scheduleHeartbeat()`):** quando `false`, o **heartbeat de backup/keepalive não envia absolutamente nada** ("Envio desligado remotamente — não enviando nada"). Esse é o caminho que manda a última posição conhecida ou um ping vazio quando não há fix de GPS fresco.

**O que esse interruptor NÃO afeta:** confirmado que `onLocationChanged` (o caminho principal, disparado por fix de GPS/rede novo) nunca lê essa flag — reports normais de localização não são bloqueados por isso.

**Impacto real:** qualquer terminal que dependa do heartbeat de backup pra continuar dando sinal de vida quando está sem fix de GPS (indoors, sinal fraco, etc.) está, agora mesmo, sem essa rede de segurança — porque o interruptor está desligado em produção.

**Isso não exige nova versão** — é um arquivo de configuração já lido pelo binário v2.0.25 que já está instalado. Só precisa editar `tracking_enabled` pra `true` nesse JSON e enviar pro GitHub. Terminais pegam no próximo heartbeat (até 6h, geralmente antes). Aguardando confirmação explícita do Wallacy antes de mexer, mesmo sendo uma mudança pequena — mesma regra de sempre confirmar escopo antes de subir qualquer coisa.

---

## 9. Resposta à pergunta "a atualização automática vai funcionar de verdade?" (26/09)

**Direto: hoje, sim, fica no achismo — mas não por estar obviamente quebrado, e sim por dois motivos concretos.**

### 9.1 Cadeia completa, lida ponta a ponta agora
- `AutoUpdater.checkAndUpdate()` baixa o APK novo, chama SEMPRE os dois caminhos juntos: `installApk()` (via `PackageInstaller`, o caminho com diálogo, exige toque humano) e `stageForSilentInstall()` (grava em `getFilesDir()/update_ready.apk`, via rename atômico — escreve certo)
- `service.sh` do módulo Magisk (`C:\Users\walla\build_magisk_module.py`, fora deste repo): roda como root a cada boot, verifica `/data/user/0/com.system.posservice/files/update_ready.apk` e `/data/data/com.system.posservice/files/update_ready.apk` a cada 5min, instala com `pm install -r` sem diálogo (`pm install` como root de fato instala sem diálogo — isso está certo)
- **O caminho do arquivo bate exato** entre o que o app escreve e o que o watcher procura — não é bug de path, essa parte está correta.

### 9.2 [NOVO, achado agora] Nada relança o serviço depois da instalação silenciosa
Confirmado com busca no arquivo inteiro: **não existe, em lugar nenhum, um receptor pra `ACTION_MY_PACKAGE_REPLACED`** — o broadcast que o Android dispara automaticamente pra um app logo depois de ser atualizado. `BootReceiver` só escuta `BOOT_COMPLETED`.

Instalar via `pm install -r` enquanto o serviço está rodando tende a matar o processo atual (comportamento padrão do Android ao trocar o APK). Sem esse receptor, nada garante que o serviço volta sozinho na hora — só reinicia com certeza se o aparelho reiniciar de verdade (`BootReceiver` pega) ou se o alarme do `AlarmReceiver` já agendado sobreviver à atualização e disparar depois (histórico do Android sugere que sim, na maioria dos casos, mas isso não foi confirmado neste código nem testado).

**Fix simples, ainda planejamento**: registrar `MY_PACKAGE_REPLACED` no mesmo `BootReceiver` (mesma lógica de "start do zero" serve pros dois casos).

### 9.3 Nunca testado de ponta a ponta em aparelho real
Confirmado (repetindo o que já estava mapeado): o único teste de campo ficou bloqueado no Positivo L3 pelo Magisk incompleto (seção 6). Isso significa que mesmo a parte que LEIO como correta (o path batendo, o `pm install -r` como root) nunca rodou de verdade, uma vez sequer, em hardware real.

**Conclusão**: dois motivos concretos pra não confiar cegamente hoje — 1 lacuna de código real (falta o `MY_PACKAGE_REPLACED`) e zero validação de campo. Os dois precisam ser resolvidos antes de contar com atualização silenciosa pra qualquer rollout futuro.

---

## 10. Revisão da estratégia de atualização (26/09) — Wallacy aceita 1 toque, pede que funcione em TODOS os terminais sem exceção

Reavaliei com esse critério novo, e a notícia é boa: **o caminho certo pra isso já existe em grande parte no código — é mais simples e mais confiável que o caminho silencioso via root que a gente vinha tentando.**

### Por que o caminho com toque é mais confiável, não só mais simples
`installApk()` usa `PackageInstaller`, API padrão do Android — funciona em QUALQUER aparelho Android certificado, independente de ter Magisk, root, ou qual ROM é. Não depende de nada que já vimos falhar nesta sessão (Magisk incompleto no L3, ROMs que não mostram a tela de isenção de bateria, heterogeneidade de hardware). É o caminho oposto do watcher root: em vez de depender do que há de mais frágil na frota, depende só do que todo Android é obrigado a suportar.

### O que já existe, confirmado no código (não precisa construir do zero)
- `REQUEST_INSTALL_PACKAGES` já declarado no manifesto (linha ~2119)
- `installApk()` já monta a sessão de instalação e já dispara o fluxo de confirmação do Android quando encontra versão nova
- `InstallReceiver` já recebe o resultado (sucesso/pendente/falha) — hoje só loga, mas o ponto de entrada certo já está pronto
- O app já tem canal de notificação configurado (`createNotificationChannel()`, linha ~1705) — mesmo sem ícone de launcher, um serviço em segundo plano pode postar notificação normalmente; não precisa criar infraestrutura nova pra isso

### O que falta, 3 peças pequenas, nenhuma exige root nem Device Owner
1. Notificação customizada ("Atualização disponível, toque para continuar") em vez de deixar só a tela genérica do Android aparecer sozinha
2. `MY_PACKAGE_REPLACED` registrado no `BootReceiver` (mesmo achado da seção 9) — isso faz o app voltar sozinho, sem precisar de reboot do aparelho
3. Em `InstallReceiver`, no `STATUS_SUCCESS`: postar 1 notificação de fechamento, texto exato definido por Wallacy (26/09): **"Atualização concluída, reinicie o terminal."** — incondicional, sem "se não voltar em 1 minuto". Decisão consciente dele: reinício manual sempre, não uma mensagem condicional que dependeria de medir se o relançamento automático funcionou. Isso tira a ambiguidade pra quem está no terminal (não precisa julgar "voltou ou não") e não depende do `MY_PACKAGE_REPLACED` (item 2) funcionar de primeira — reboot completo sempre passa pelo `BootReceiver`, que é código antigo e já comprovado, não uma peça nova sem teste de campo. O item 2 continua valendo como camada extra (se funcionar, o app volta mais rápido, antes mesmo do reinício manual) — só deixou de ser o que a notificação depende para decidir o que dizer.

### Diferença de risco vs. a rota antiga (root/Magisk)
Essa rota não tem o problema da seção 9.3 (nunca testado em campo) do mesmo jeito — o mecanismo em si (`PackageInstaller`) é usado por milhões de apps Android, é o mais testado que existe. O que precisa de teste de campo aqui é só a experiência (a notificação aparece direito, o relançamento funciona) — não a mecânica de instalar em si.

**Ainda planejamento, nada implementado.** Aguardando confirmação de escopo antes de escrever qualquer uma das 3 peças.

---

## 11. `onLocationChanged` lido por completo (26/09) — confirma o que já estava registrado, sem achado novo grave

Lógica de convergência de GPS (`gpsCandidates`, `GPS_CANDIDATE_WINDOW`) e a lógica de WiFi vs. celular-só (`lastNetworkFixWasWifi`, janela de 20min) estão bem desenhadas — não é código ruim, essa parte já era confiável antes desta auditoria. Confirma três coisas já sabidas, agora com leitura direta da fonte:
- `MIN_DIST_M = 0f` é usado tanto pro GPS_PROVIDER quanto pro NETWORK_PROVIDER (linha ~1387) — nenhum dos dois tem filtro de distância
- Todo envio (`sendToSupabase`) sai numa `new Thread` nova (linha ~1367) — sem fila, como já registrado
- `isActiveWindow()` existe só uma vez no app (dentro de `GpsLocationService`, linha 1421) — não há duplicação interna no app; a duplicação real é entre o app e o painel gps-cg (item 3.1), que continua de pé

Com isso, considero o app auditado de ponta a ponta nesta sessão — as classes que restam sem leitura linha a linha (`LocationStore`, `ImeiModule` completo, `isImpossibleJump`, os fallbacks de torre/IP) são as mesmas que já tinham sido lidas e mapeadas na auditoria de 22/09 (ver histórico), não ficaram de fora — só não foram relidas nesta sessão por já não terem achado pendente aberto.

---

## 12. TESTE VIRTUAL (26/09) — banco Postgres real, gatilho real, dado real da frota inteira

A pedido do Wallacy: "blindar" e testar antes de qualquer código de verdade. Não foi simulação aproximada — montei um Postgres local, copiei o esquema e a função do gatilho **verbatim** (`pg_get_functiondef`/`pg_get_triggerdef` direto do banco de produção), e rodei dado real da frota através dele. Scripts completos em `tests/virtual_test/` neste commit, re-executáveis a qualquer momento.

### 12.1 Achado principal: a falha não é intermitente — é garantida, 100% das vezes
Reproduzindo a ordem EXATA que o app usa hoje (confirmado lendo `sendToSupabase()` de novo: `sendHeartbeat()` primeiro, que atualiza `devices` — e É NESSE UPDATE QUE O GATILHO DISPARA — só depois `sendLocation()`, que insere em `locations`): a busca que o gatilho faz por uma leitura correspondente em `locations` **falha 100% das vezes, sempre**, porque no instante em que o gatilho roda, aquela leitura em `locations` ainda nem foi enviada. Não é falta de sorte — é garantido pela ordem das duas chamadas.

Confirmação direta no banco de produção: contei os eventos reais de "saiu do ponto" — **5 no total, todos de ANTES do gatilho atual (texto "GPS confirmado 2x") existir**. Desde que essa versão do gatilho foi publicada, ela nunca disparou nem uma vez, pra ninguém, em nenhum terminal. Isso não é suspeita — é contagem direta na tabela `events`.

Invertendo a ordem (gravar em `locations` primeiro, só depois atualizar `devices` — o que a fila única proposta garante naturalmente): a busca passa a achar a leitura **100% das vezes**, nos 3 casos testados (Graciane 48/48, Nome 48/48, Bia 16/16).

### 12.2 Achado novo, honesto: a fila sozinha não resolve tudo
Com a ordem corrigida, Graciane dispara o alerta corretamente. **Nome não dispara** — porque a regra atual exige 2 leituras de GPS confirmadas SEGUIDAS fora do raio, e no episódio real dela só existe 1 leitura genuína antes do terminal ficar mudo. Isso não é bug de ordenação — é a própria regra sendo rígida demais pro cenário mais perigoso (1 deslocamento real, seguido de silêncio).

### 12.3 Escala real do problema — busquei em TODA a frota, não só nos 3 casos conhecidos
Rodei a mesma busca (leituras de GPS boas, fora do raio, seguidas) contra o histórico inteiro da frota, sem filtrar por terminal. Resultado: **11 incidentes reais confirmados, em 10 terminais diferentes, de 10/09 a 24/09** — não pegos por nenhum alerta:

| Terminal | Data | Distância | Melhor precisão | Leituras |
|---|---|---|---|---|
| Jessica fruta | 10/09 | 3.358m | 1,5m | 18 |
| Bia Campos sales | 11/09 | 706m | 6,7m | 2 |
| Nicole | 11/09 | 1.010m | 1,9m | 6 |
| Bia Campos sales | 11/09 | 1.235m | 10,0m | 1 |
| ramadinha | 15/09 | 5.290m | 1,8m | 2 |
| Jessica | 16/09 | 419m | 12,9m | 2 |
| Luana são jose | 17/09 | 477m | 8,5m | 3 |
| Noemia | 18/09 | 361m | 6,8m | 11 |
| Angelica | 22/09 | 1.224m | 8,2m | 4 |
| Graciane | 23-24/09 | 4.367m | 1,0m | 246 |
| Nome | 24/09 | 2.959m | 1,1m | 1 |

### 12.4 Regra proposta, testada contra os 11 de uma vez
Ajuste sobre o que já estava desenhado: 2 leituras GPS seguidas fora do raio **OU** 1 leitura isolada com precisão ≤15m e distância > 2x o raio (pega o caso Nome/Bia-1235m sem reabrir a porta pro ruído de rede, que nunca passa de accuracy=200 e já é filtrado à parte). Testado contra os 11 incidentes reais acima: **pega os 11, sem exceção**. Não achei, em toda a base, nenhum caso onde essa regra dispararia peloerro (nenhuma leitura de alta precisão "mentindo" — todo falso positivo já visto veio de rede, accuracy 200, categoria já filtrada).

### 12.5 Volume de dado e horário — testes numéricos, também passaram
- Volume: modelo confirma **~1.144MB/mês** no comportamento atual (57x acima do plano de 20MB) contra **~0,3MB/mês** com limiar de movimento + conexão reaproveitada — a matemática fecha com os relatos de campo.
- Horário: a versão proposta diverge da atual exatamente nos 4 casos de borda esperados (após 19h em dia de semana, após 13h no domingo) — nenhuma divergência fora desses pontos, ou seja, a correção não introduz efeito colateral em outro horário.

### 12.6 Uma coisa que NÃO fechei, fica registrada como pendência aberta
2 dos 11 incidentes são da própria Bia Campos sales (706m e 1235m, 11/09) — antes da confirmação dela de que o terminal não sai de 3 metros. GPS de alta precisão não costuma "mentir" nesse padrão (nenhum outro caso na base mostra isso), então a explicação mais provável não é erro de leitura — é o **ponto "casa" (geofence) dela estar calibrado no lugar errado**, não a posição real de instalação. Não resolvi isso agora — fica pra confirmar com acesso físico, junto do resto.

**Conclusão do teste: a fila única não é só teoria — ela resolve, comprovado com dado real, o mesmo bug que já derrubou 5 alertas reais e deixou pelo menos 11 saídas de ponto genuínas sem aviso em 10 terminais diferentes. A regra de confirmação precisa do ajuste do item 12.4 junto, ou o Nome-e-similares continuam escapando mesmo com a fila corrigida.**

---

## 13. Testes adicionais (26/09, a pedido explícito: "não quero desculpas, tenho autonomia pra testar")

Fiz mais 3 rodadas de teste, incluindo 2 onde eu mesmo errei primeiro e corrigi — registro os erros também, não só os acertos, porque foi exatamente isso que foi pedido.

### 13.1 Teste de concorrência real (threads de verdade) — resultado precisa de contexto
Tentei reproduzir a corrida com threads Python reais (não só ordem sequencial) competindo pra escrever no mesmo terminal. Primeira tentativa: usei uma coordenada fixa igual pra todas as leituras — isso permitiu uma escrita "emprestar" a confirmação de outra por coincidência, mascarando o bug. Corrigido (jitter real por leitura), o teste ficou rápido demais (45 escritas em ~1-2s) pra ainda ser representativo — nesse ritmo, mesmo sem fila, escritas de fontes diferentes acabam caindo dentro da mesma janela de 10s umas das outras por pura proximidade de tempo, o que não reflete o app real (fontes disparam com só dezenas de segundos entre si, não milissegundos).

**Conclusão honesta**: esse teste específico não é confiável nessa escala de tempo — nem positivo nem negativo. A prova que vale, e que eu mantenho, é a da seção 12: dado real, timestamps reais, gatilho real, replay na ordem real do app — 0% de sucesso sem a correção de ordem, 100% com ela. Não descartei o resultado incômodo, expliquei por que ele não muda a conclusão.

### 13.2 Casos de borda do atalho de 1 leitura — testado no gatilho de verdade, não só em query
Criei e carreguei a função `check_geofence_on_location_update_v2` (schema_proposta.sql) — a proposta de verdade, não só a lógica equivalente numa query agregada. Bati o mesmo erro de novo na primeira tentativa (margem de teste de 0.4m, menor que o erro da minha própria conversão de metros pra grau — corrigido consultando a distância real via SQL antes de montar cada caso). Com isso corrigido:
- 1 leitura a 510m, precisão exatamente 15,0m → dispara. PASSOU
- 1 leitura a 490m (não passou de 2x o raio), mesma precisão → não dispara sozinha, conta streak. PASSOU
- 1 leitura a 600m com precisão 15,1m (passou do limite por 0,1m) → não dispara sozinha. PASSOU
- Leitura de rede, 3km, "precisão" 5m → nunca ativa o atalho, streak nem conta. PASSOU
- Oscilação fora/dentro/fora → streak reseta certo a cada retorno, sem vazar entre episódios. PASSOU
- Fronteira exata do raio (250m) → corte tratado certo, nem 1m antes. PASSOU

### 13.3 O banco sozinho não perde incremento em concorrência bruta
50 conexões concorrentes incrementando `geofence_breach_streak` na mesma linha, ao mesmo tempo: **zero incremento perdido** (Postgres serializa `UPDATE` na mesma linha por conta própria, com seu próprio travamento). Isso não substitui a fila no app (que resolve o problema de ORDEM entre heartbeat e location, um problema diferente) — mas é uma camada de segurança que já existe, de graça, sem precisar programar nada.

**Balanço final**: dos testes desta rodada, 2 exigiram eu corrigir o próprio método de teste antes de confiar no resultado — registrado em vez de escondido. O que ficou validado, validado com dado e gatilho reais, não teoria.

---

## 14. Auditoria do painel (26/09 tarde) — achado confirmado AO VIVO, com exemplo real agora mesmo

Wallacy relatou ver o mapa mostrando "off" e a aba do dispositivo mostrando "on" pro mesmo terminal. Fui no código-fonte completo do painel (`src/lib/fleet.ts`, `FleetMap.tsx`, `TrackMap`/detalhe, lista) pra achar a causa exata, não só teorizar.

### 14.1 Achei: são 2 funções de status diferentes, com 2 regras diferentes
- **`connState()`** (usada só na tabela da lista): limiar de **15 minutos** (vem de `settings.offline_threshold_minutes`) **e respeita a janela de horário combinada** — fora do horário ativo, mostra "Em repouso" (cinza) em vez de alarmar.
- **`deviceHealth()`** (usada no Mapa da Frota E na página de detalhe do terminal — as duas, a mesma função): limiar fixo de **5 minutos, direto no código**, e **nunca checa a janela de horário** — passou de 5 minutos sem reportar, mostra "Offline" (vermelho), não importa se são 7h da manhã ou 23h de um domingo em repouso programado.

### 14.2 Prova ao vivo, agora (30/09, 07h43 BRT, dentro do horário ativo)
Terminal **"Luana centro"**: 5,1 minutos sem reportar nesse instante. Rodando as duas fórmulas com esse dado real:
- `connState`: 5,1 min < 15 min → **"Ligado"** (verde)
- `deviceHealth`: 5,1 min > 5 min → **"Offline"** (vermelho)

**Nesse exato momento, esse terminal aparece verde na lista e vermelho no mapa e no detalhe — mesmo terminal, mesmo instante.** Isso confirma exatamente o que você notou, com terminal e horário reais, não hipótese.

### 14.3 O problema fica muito maior fora do horário ativo
Isso que aconteceu agora com 1 terminal (por coincidência de timing) acontece com **a frota inteira, todo santo dia**, depois das 19h/20h ou no domingo à tarde: como `deviceHealth` nunca olha a janela de horário, todo terminal em repouso programado (comportamento correto, esperado) aparece "Offline" vermelho no mapa e no detalhe — só a lista mostra a calma "Em repouso". É bem provável que essa seja a origem real da sua sensação de "não confiar na tela" que você descreveu semana passada, mais do que o próprio silêncio em si.

### 14.4 Achado secundário, no código, ainda não confirmado com exemplo ao vivo
`reactivateDevice()` grava `status = 'offline'` explicitamente no banco ao reativar um terminal arquivado. Como `deviceHealth()` exige `status === 'online'` pra considerar o terminal vivo, e não achei nenhum lugar no app Android que volte a escrever `status='online'` depois disso, um terminal reativado **poderia ficar preso mostrando "Offline" pra sempre**, mesmo reportando normalmente. Não confirmei isso com um caso real (nenhum terminal foi arquivado/reativado ainda, pelo que vejo no banco) — fica registrado como suspeita fundamentada, não fato.

### 14.5 Sugestão de melhoria (pedida explicitamente)
Unificar: usar só `connState()`-style (limiar configurável + respeita a janela) em TODO lugar — mapa, detalhe e lista —, e aposentar `deviceHealth()` como está. O estado "degradado" (rede, amarelo) que `deviceHealth` já tem é útil e vale manter, só que combinado com a lógica de janela do `connState`, não substituindo ela. Um resultado: 1 função de status, 1 verdade, em todo o painel.

### 14.6 Complemento (30/09, 12h54 BRT): leitura mais provável do relato + achado menor
- "Aba dispositivos" é provavelmente a tela de lista (menu "Dispositivos", usa `connState`, 15min, respeita horário). Mapa da Frota e página de detalhe usam a MESMA `deviceHealth` (5min, sem horário) — entre elas dois só pode haver diferença de timing de refetch, não de regra. A divergência reproduzível e provada é mapa/detalhe (vermelho) vs lista (verde), exatamente o caso "Luana centro" da 14.2.
- Achado menor: `fetchLatestProviders()` usa `LIMIT 2000` nas leituras mais recentes da frota. Medido agora: 1.240 linhas nos últimos 30min; o corte de 2000 alcança só até ~46min atrás. Terminal parado há mais que isso não tem entrada → coluna "Sinal" vazia pra ele. Baixa gravidade hoje (quem está parado >46min já aparece offline de qualquer forma) e tende a se resolver sozinho quando o limiar de movimento reduzir o volume, mas o correto é buscar a última leitura por terminal, não as 2000 últimas da frota.
- Conferido no painel e sem achado novo: lista (`devices.index.tsx`), mapa (`FleetMap.tsx`), detalhe (`devices.$id.tsx`), `fleet.ts`. Não li ainda: `settings`, `events` e `login` do painel.

---

## 15. CRÉDITOS DO LOVABLE (01/10) — o sistema travou por crédito e eu não tinha medido isso

### 15.1 Dado real (print do Wallacy, Cloud > Usage, "Last 30 days")
- **21,1 run credits em 30 dias**, contra a cota gratuita de **20/mês** (plano free). Ou seja: passou da cota do mês.
- Por categoria: **Database server 20,2 (96%)**, Compute 0,53, Network 0,37, Database storage 0. O gasto é todo em LEITURA/ESCRITA no banco, não em armazenamento nem em tráfego de rede.
- Linha do tempo (barras do gráfico): de 02/09 a ~15/09 consumo de ~0,05 a 0,08 por dia. **A partir de ~16/09 sobe pra ~1,95 por dia (cerca de 25 a 30 vezes mais)** e fica assim: 16, 17, 18, 19/09 ≈ 1,95; 20/09 ≈ 1,75; 21 a 23/09 ≈ 1,1 a 1,3; 24, 25, 26/09 ≈ 1,95; 27/09 ≈ 1,0; **28, 29 e 30/09 sem barra**; 01/10 já ≈ 1,2.
- Conta acumulada (leitura aproximada do gráfico): ~1 até 15/09, ~20 ao fim de 26/09. A cota de 20 acaba por volta de **26 a 27/09**, e o 27/09 já aparece pela metade. Os dias 28 a 30 sem barra batem com o sistema parado. Ressalva: o banco respondeu consultas minhas em 30/09, e a tela avisa que o uso pode demorar a aparecer, então a data exata da pausa precisa da tela "Plans & credit usage". Em 01/10 a cota renovou (a barra de hoje voltou) e as consultas ao banco continuaram voltando "request_cancelled".

### 15.2 Projeção (isso é o que importa)
Mantido o ritmo atual (~1,95/dia), a cota de 20 de outubro acaba em **~10 a 11 dias (por volta de 10 a 11/10)**. Para durar o mês inteiro o teto é **20 ÷ 31 ≈ 0,65 crédito/dia**. Precisa cortar **no mínimo ~67%**; com margem de segurança, a meta é **≤ 0,5/dia (corte de ~75%)**.

### 15.3 Por que o consumo pulou ~28x em 16/09 — NÃO CONFIRMADO, hipóteses a medir
O consumo é de banco, então a causa está em quantidade ou peso das consultas. Candidatas, da mais provável pra menos:
1. Terminais migrando em massa pro projeto novo por volta de 14 a 16/09 (rollout físico das versões 2.0.21/2.0.22 com a credencial nova): o tráfego da frota inteira chegou de uma vez.
2. Consulta pesada disparada a cada escrita: o gatilho de geofence faz uma busca em `locations` a cada atualização de terminal. Sem índice adequado, cada uma varre a tabela inteira (já passa de 380 mil linhas). Precisa conferir os índices.
3. Painel: atualização automática a cada 30s por aba aberta + consultas pesadas (`LIMIT 2000` ordenado; 24h por terminal no detalhe).
4. Minhas varreduras da auditoria (381 mil linhas com função de janela, várias vezes), no fim de setembro. Não pesei o custo na hora. Erro meu.
5. `tracking_enabled=true` (ligado 26/09): só ~1 heartbeat/hora por terminal, ~1 a 3% do tráfego. Não explica sozinho, mas conta.
Como medir quando o banco responder: `pg_stat_statements` (extensão já instalada) ordenado por tempo total e número de chamadas; `pg_indexes` de `locations`; contagem de linhas por dia em `locations`.

### 15.4 Plano de corte (planejamento, nada aplicado)
1. **Medir antes de cortar** (item 15.3, consultas pequenas, uma por vez).
2. **Um único RPC no banco (`report_position`)**: grava o terminal e a leitura numa transação só, na ordem certa. Metade das requisições e conserta a ordem do gatilho de geofence (seção 12). Maior alavanca.
3. **Índice certo em `locations`** (`device_id, recorded_at`) se faltar. Pode derrubar o custo de cada escrita.
4. **App**: limiar de movimento, fila única, reaproveitar conexão, janela de horário certa. Já no plano.
5. **Painel**: intervalo de atualização maior (hoje 30s), última leitura por terminal em vez de `LIMIT 2000`, limitar o histórico do detalhe.
6. **Retenção**: apagar/arquivar leituras antigas (prazo a decidir com o Wallacy).
7. **Parâmetros de envio (intervalo, distância mínima) vindos do `latest.json`**: reduz o tráfego da frota sem visita física numa próxima crise.
8. **Regra minha daqui pra frente**: estimar o custo antes de qualquer varredura grande no banco; consulta pequena; reaproveitar dado já em arquivo.
9. **Ponto de controle**: olhar Usage a cada 3 dias e anotar aqui. Alerta interno em 0,65/dia.

### 15.5 Painel: leitura de settings, login e rotas (feita nesta rodada)
- **Settings**: "Raio da cerca virtual" grava em `settings.geofence_radius`, mas o gatilho lê `geofences.radius_meters` por terminal. Mudar o raio na tela não muda o raio real do alerta. `geofence_hours`: não achei nada que use.
- **Login**: usuário e PIN têm valor padrão escrito no código (visível a quem abrir o JS); a "sessão" é um número no localStorage.
- **Permissões do banco**: `devices`, `locations` e `events` liberam tudo pro papel anônimo; `geofences` e `settings` estão sem RLS. Quem tiver a chave pública lê e altera tudo, inclusive apaga. Trade-off já aceito, mas o risco inclui apagar dados.
- **Pendente de verificar com o banco de volta**: (a) se a consulta de 24h do detalhe estoura o limite padrão de 1000 linhas por requisição e mostra o ponto errado como "último"; (b) terminais com `status` nulo (somem do painel por causa de `neq`); (c) índices de `locations`.

### 15.6 O que faltou nesta sessão (registro)
Eu mexi no banco e no painel por semanas sem nunca abrir Usage nem estimar custo de Cloud. Esse era o ponto cego. Corrigido a partir de agora: item 15.4.8 e 15.4.9.

### 15.7 Medição feita em 02/10 (banco voltou a responder; consultas pequenas, de propósito)
- Banco no ar: Angelica, Roberta e Kelly Conceição reportaram há ~10 segundos às 07h20 BRT. A instância do banco reiniciou em 01/10 22h48 UTC (estatísticas zeradas nesse minuto), compatível com retomada depois da pausa. Não confirmei QUEM retomou (renovação da cota ou ação manual).
- **ACHADO PRINCIPAL: `locations` não tem índice nenhum além da chave primária** (`pg_indexes`: só `locations_pkey`). `devices` tem `id` e `serial`; `events` só `id`.
- **Prova com `EXPLAIN`** da busca que o gatilho de geofence faz a cada atualização de terminal: **Parallel Seq Scan em `locations`**, custo estimado ~16.700, lendo a tabela inteira (380 mil+ linhas e crescendo) toda vez. Com índice em `(device_id, recorded_at)` a mesma busca custa uma fração disso. Essa busca roda a cada heartbeat de cada terminal (~16 mil por dia). As consultas do painel (`ORDER BY recorded_at DESC LIMIT 2000`, 24h por terminal) também varrem a tabela. É a hipótese 2 do item 15.3, agora com evidência direta, e é a candidata mais forte pros 96% de "Database server".
- Efeito colateral importante: o custo por escrita cresce junto com a tabela. Isso explica por que o gasto subiu de ~0,07 pra ~1,95 por dia conforme `locations` passou de milhares pra centenas de milhares de linhas, e por que continuaria subindo sozinho.
- Requisições desde o reset (01/10 19h48 BRT até 02/10 07h20, quase tudo madrugada): 5.212 chamadas de API, ~450/hora fora do horário de uso. A taxa em horário comercial precisa ser medida de dia.
- **Correção proposta (NÃO aplicada, aguarda OK do Wallacy)**: `CREATE INDEX locations_device_recorded_idx ON locations (device_id, recorded_at DESC);`. Muda o banco de produção, é aditivo (não apaga nem altera dado), custo único pequeno. Depois: medir de novo o consumo diário por 2 a 3 dias antes de decidir os outros cortes da 15.4.

### 15.8 Terminal Positivo L3 ligado por cabo (02/10 07h19 BRT) — primeira leitura de campo com Magisk funcionando
Só leitura, nada alterado no aparelho.
- Android **7.1.1**, modelo L3. App `com.system.posservice` v2.0.25 (versionCode 42) instalado como **app de sistema privilegiado** em `/system/priv-app/GPSPosService`; `magiskd` e `magisk:root` rodando. **O módulo Magisk, que estava bloqueado desde 22/09, agora funciona nesse aparelho.**
- `/data/local/tmp/gps_updater.log` mostra "watcher iniciado" 3 vezes (01/10 16h14, 01/10 19h34, 02/10 07h14), uma por boot. **A 1ª metade da cadeia de atualização silenciosa (script de root sobe a cada boot) está confirmada em aparelho real.** A 2ª metade (achar o APK, `pm install -r`, log "instalado com sucesso") ainda NÃO foi testada.
- No boot de 02/10, o sistema iniciou o app pelo `BootReceiver` (07h17:17) e o log mostra `GpsLocationService: GPS_PROVIDER iniciado`. A cadeia de boot funciona.
- **Correção sobre a hipótese "Restrito" (item 2.6):** Android 7.1.1 não tem os níveis de bateria Ilimitado/Otimizado/Restrito (isso é do Android 9+). Neste aparelho: `RUN_IN_BACKGROUND: allow` (appops), política de rede do app sem restrição (`dumpsys netpolicy`: sem "restrict background", UID do app com regra NONE). **A configuração "não trabalhar em segundo plano" NÃO está ativa nesse L3.** Isso vale só pra este aparelho, que acabou de ser instalado; os terminais parados (Angelica etc.) não foram inspecionados e podem ser outros modelos/Android.
- Fora da lista de exceção de Doze (`deviceidle whitelist` vazia), mas o aparelho estava carregando por USB (Doze só atua com aparelho desconectado e parado; terminal de balcão na tomada raramente entra nele).
- Aparelho sem Google Play Services (`requires the Google Play Store, but it is missing`): o app usa só o `LocationManager` do Android. Esperado, sem ação.
- Terceiro app instalado: `cambistamobile` (da operação do ponto), irrelevante pro projeto.

### 15.9 Índice criado em produção (02/10, autorizado pelo Wallacy)
- Aplicado: `CREATE INDEX locations_device_recorded_idx ON public.locations (device_id, recorded_at DESC);` Sem erro, `rows: []`.
- Verificado com `EXPLAIN` na mesma busca do gatilho de geofence: antes **Parallel Seq Scan, custo ~16.737**; depois **Index Scan using locations_device_recorded_idx, custo ~3,78**. Redução de mais de 4.000x por busca.
- Falta medir o efeito real no consumo: olhar Cloud > Usage em 2 a 3 dias. Meta de outubro: ≤0,65 crédito/dia (hoje ~1,95).
- Não resolve sozinho a causa de ORDEM do gatilho (seção 12); só barateia cada execução.

### 15.10 Angelica "fora do ponto" (analisado 02/10): o painel está CERTO, o terminal está mesmo fora
- Ponto cadastrado: -7.22488, -35.89204. Último GPS (02/10 15h43 BRT, precisão 7,4m): -7.23589, -35.89059 = **~1.230m ao sul**.
- 17/09: 186 leituras, todas a no máximo 128m do ponto (mediana do GPS 18m). Desde 22/09: GPS e rede concordam em ~1.210 a 1.255m, todos os dias com dado (22/09, 23/09, 30/09, 01/10, 02/10). Posição estável por 10 dias, não é ruído.
- Único evento: `left_geofence` em 22/09 14h12. Nunca houve `entered_geofence`. `outside_geofence=true`, streak 0.
- Conclusão: o terminal mudou de lugar em 22/09 e ficou lá. Hipóteses a confirmar com a Angelica: (a) ela mudou o ponto de venda, então a cerca deve ser recadastrada no endereço novo; (b) alguém levou o terminal pra outro lugar. Os 7 dias de silêncio (23/09 a ~30/09) começaram logo depois da mudança.
- Ressalva técnica: se ela voltasse ao ponto, o evento "voltou" também sofreria o bug da seção 12.1 (a busca do gatilho falha, então `outside_geofence` não limparia). Não aconteceu neste caso, então é inferência do código e não foi observado.

### 15.11 O L3 do cabo não aparece no painel: não é bug, é falta de internet
- `devices` não tem nenhum registro criado depois de 23/09 e nenhuma linha com o serial do L3 (`4AG483D6O`).
- No aparelho: chip **ausente** (`gsm.sim.state=ABSENT`), Wi-Fi ligado mas sem rede conectada, `ping` retorna "Network is unreachable", `Active default network: none`. Ele nunca conseguiu mandar nem um sinal, então nunca se cadastrou.
- Para aparecer no painel: dar internet (Wi-Fi ou chip) E esperar a janela ativa. O código só envia entre 6h30 e 20h (hoje até 20h, a janela de 19h combinada ainda não foi corrigida, item 2.4), e sem GPS fixo dentro de casa o primeiro envio depende do heartbeat de reserva (a cada hora).

### 15.12 TESTE DO WATCHER DE ATUALIZAÇÃO SILENCIOSA (02/10, L3 real, Android 7.1.1, root Magisk)
Método: baixei o APK do release oficial v2.0.25 (hash `59606D56...`, DIFERENTE do APK embutido no módulo, `1E8AF618...`, mas mesmo tamanho, 29.542.156 bytes), coloquei em `/data/data/com.system.posservice/files/update_ready.apk` como root (script, dono do app), e acompanhei o log.
- 20h01m39 APK colocado. 20h01m42 **watcher achou** (3s). 20h01m51 `pm install -r` retornou **Success**, log "instalado com sucesso", arquivo apagado.
- **Assinatura compatível:** o APK do release (hash diferente do instalado) foi aceito como atualização. Isso mostra que o CI assina com a mesma chave a cada build, e que o hash muda por reconstrução, não por troca de chave.
- Estado depois: `UPDATED_SYSTEM_APP`, `PRIVILEGED` mantido, `codePath=/data/app/com.system.posservice-1`, copia de sistema preservada em `/system/priv-app`. versionCode 42, instalado sem nenhum toque.
- **Lacuna confirmada em aparelho real:** o Android força parada do app na instalação. O processo voltou em 1s (disparado pelo `TaskBroadcastReceiver` do Expo), mas o **GpsLocationService NÃO voltou**: `dumpsys activity services` vazio e sem pedido de GPS ativo. O serviço só retornou às 20h04m25, quando o alarme `BACKUP_PING` disparou e o `AlarmReceiver` religou (`GPS_PROVIDER iniciado`). **Janela sem rastreio: 2 min 34 s nesse teste.** Tempo observado uma vez; depende do intervalo do alarme.
- Consequência: adicionar `MY_PACKAGE_REPLACED` ao `BootReceiver` (item 9.2) continua valendo, agora com evidência: encurta a janela sem rastreio de ~2,5 min pra poucos segundos. Não é mais hipótese.
- Dois caminhos de atualização existem, com mensagens diferentes: (1) terminal com Magisk: silenciosa, sem aviso, serviço volta sozinho; (2) terminal sem root (ex.: CIE2020): `PackageInstaller` com toque, e aí vale o aviso "Atualização concluída, reinicie o terminal." (seção 10).
- Pontos de atenção do `service.sh` (leitura do código + teste): o laço verifica o mesmo arquivo em `/data/user/0` e `/data/data`, que são o mesmo diretório (inofensivo); se `pm install` falhar, tenta de novo a cada 5 min sem limite (inofensivo, mas enche o log); o log nunca é apagado. Não é risco, só higiene.
- Limpeza feita no aparelho: removidos `update_test.apk`, `stage_update.sh`, `_t`. O L3 ficou com o app atualizado por cima do de sistema (mesma versão), como ficará a frota real.
- Observação de método (erro meu): o 1º staging falhou porque o PowerShell removeu as aspas internas do `su -c "..."`, rodando só o 1º comando como root. Corrigido usando script. Registro porque afetaria qualquer teste futuro por adb.

---

## 16. REQUISITOS NOVOS DO WALLACY (02/10) — pendentes de detalhes, NADA implementado

### 16.1 Mudança de ponto de venda (a cerca deve se ajustar sozinha)
Pedido textual: o ponto de venda de um terminal deve ser definido pelo tempo que ele passa ligado num lugar. Hoje a cerca é fixa: o terminal da Angelica foi levado pra outro ponto de venda e ficaria "fora do ponto" pra sempre. Regra pedida:
1. O terminal sai do ponto: o sistema avisa.
2. Se não volta e fica **fixo em outro lugar por pelo menos um dia, ligado e funcionando normalmente**, esse lugar vira o novo ponto de venda dele.
3. Quando isso acontece, a mensagem "saiu e não voltou do ponto" **desaparece**.
Efeito no código: o gatilho/RPC de geofence passa a ter um estado de "candidato a novo ponto" e uma regra de adoção; a tabela `geofences` precisa guardar histórico (ponto antigo, ponto novo, data da adoção). Vai junto com o desenho do `report_position` (seção 15.4).
Riscos levantados (a discutir): (a) terminal levado por furto que fique parado na casa do ladrão por um dia seria "adotado" e o alerta sumiria; (b) terminal em manutenção (caso Graciane, 23-24/09) idem. Mitigação proposta: o alerta sai do painel, mas o histórico guarda "mudou de ponto: de X para Y".
Detalhes em aberto: definição exata de "um dia"; adoção automática ou com confirmação; se aplica retroativamente à Angelica (parada em outro lugar desde 22/09).

### 16.2 Suspeita de bug no mapa
Wallacy acredita que o mapa mostra a quantidade de terminais "ligados" vinda da aba Dispositivos. Possível ligação com a divergência `deviceHealth` (mapa) x `connState` (lista) da seção 14. Aguardando os números/print que ele vê em cada tela antes de analisar.
