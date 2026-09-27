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

### 2.1 [GRAVE] Threads sem fila no envio de rede
Cada heartbeat/location dispara em `new Thread` separada, sem fila nem sincronização (8 pontos no código, já mapeados em sessão anterior). Causa raiz de dois problemas ao mesmo tempo:
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
3. Em `InstallReceiver`, no `STATUS_SUCCESS`: postar 1 notificação de fechamento — algo como "Atualização concluída. Se o app não voltar em 1 minuto, reinicie o terminal." Cobre os dois casos que o Wallacy pediu (volta sozinho OU avisa pra reiniciar) com uma mensagem só, sem precisar detectar se o relançamento automático funcionou de verdade.

### Diferença de risco vs. a rota antiga (root/Magisk)
Essa rota não tem o problema da seção 9.3 (nunca testado em campo) do mesmo jeito — o mecanismo em si (`PackageInstaller`) é usado por milhões de apps Android, é o mais testado que existe. O que precisa de teste de campo aqui é só a experiência (a notificação aparece direito, o relançamento funciona) — não a mecânica de instalar em si.

**Ainda planejamento, nada implementado.** Aguardando confirmação de escopo antes de escrever qualquer uma das 3 peças.
