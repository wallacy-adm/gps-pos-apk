# CLAUDE.md — GPS POS APK
> Lido automaticamente pelo Claude Code ao abrir este projeto.
> Ultima atualizacao: 2026-05-25 | Versao do codigo: versionCode 19 / v2.0.2

---

## O QUE E ESTE PROJETO

APK Android invisivel que roda em terminais POS (Smartpos Arny AR-SP5, Sunmi V2, PDA POS generico).
Envia localizacao GPS a cada 30s para o Supabase. Se disfarça como "Servicos do Sistema".

- **Pacote Android**: `com.system.posservice`
- **APK local**: `C:\eas\gps-pos-apk\` (este diretorio — sem acento, path seguro para EAS)
- **Dashboard admin**: `C:\Users\walla\OneDrive\Area de Trabalho\gps-pos-tracker-lovable\`
- **GitHub APK**: https://github.com/wallacy-adm/gps-pos-apk
- **GitHub Dashboard**: https://github.com/wallacy-adm/gps-pos-tracker
- **Supabase**: https://pbzoggfmegmawbnmblpm.supabase.co
- **EAS Project ID**: `fad3e092-19a1-4762-8914-99b6d206aa03`

---

## STATUS ATUAL — 2026-05-25

### Build atual — v2.0.2 / versionCode 19 — FUNCIONANDO ✅
Commits: `b67bf35` (IMEI em GpsLocationService + buildDeviceBody + AlarmReceiver)

**VALIDADO NO AR-SP5 em 2026-05-25:**
- `imei: "861536050094847"` populado no Supabase apos reboot ✅
- `status: "online"`, coordenadas presentes ✅
- GpsLocationService rodando (`dumpsys activity services`) ✅
- Dashboard mostra IMEI + "Primeira localizacao hoje" ✅

### Build v2.0.1 / versionCode 18 — SUBSTITUIDO por v2.0.2
Commits: `200e1cc` (unify serial ANDROID_ID)

**VALIDADO NO AR-SP5 em 2026-05-25:**
- `dumpsys location` → `com.system.posservice: gps: Interval 30 seconds... Currently active` ✅
- `dumpsys activity services` → `GpsLocationService` rodando com `app=ProcessRecord` ✅
- Boot: GPS subiu em 662ms (ANTES da Activity pause timeout em 1112ms) ✅
- Device online no Supabase em <2 minutos apos boot ✅
- Heartbeat a cada 30s com TELA DESLIGADA confirmado ✅

**ROOT CAUSE RESOLVIDO (v2.0.0):**
expo-location tem check em LocationModule.kt: lanca excecao se
`AppForegroundedSingleton.isForegrounded == false`. No AR-SP5, Android
pausa a MainActivity em ~554ms (antes do React Native carregar). Isso
mantinha o singleton como false → GPS sempre bloqueado.

Solucao: **GpsLocationService Java nativo** usa `LocationManager.requestLocationUpdates()`
diretamente. Nao depende de expo-location nem de MainActivity estar em foreground.
BootReceiver inicia o servico ANTES de qualquer Activity.

**v2.0.1 — RESOLVIDO:**
Todos os receivers (BootReceiver, ShutdownReceiver, AlarmReceiver) agora usam
ANDROID_ID como serial. Um unico registro no Supabase por dispositivo.

**v2.0.2 — IMEI no dashboard (build em andamento):**
GpsLocationService.sendHeartbeat() agora inclui campo `imei` via TelephonyManager.
buildDeviceBody() em BootReceiver/ShutdownReceiver + AlarmReceiver tambem envia IMEI.
Apos instalacao: dashboard mostra IMEI do dispositivo ao lado do ANDROID_ID.

### Historico de builds
| Build | versionCode | Resultado |
|---|---|---|
| Build v2.0.2 | 19 | **FUNCIONANDO** — IMEI em todos os receivers |
| Build v2.0.1 | 18 | Substituido por v2.0.2 |
| Build v2.0.0 | 17 | **FUNCIONANDO** — GPS nativo Java completo |
| Build v1.9.0 | 16 | Parcial — removeu stale check, mas LocationModule.kt ainda bloqueava |
| Build v1.8.0 | 15 | Parcial — fix timeout, problema mais fundo |
| Build v1.7.0 | 14 | Parcial — fix tela preta, GPS ainda bloqueado |
| Build v1.6.0 | 13 | Parcial — BootReceiver fix |
| Build v1.5.0 | 12 | Parcial — removeu tela ativacao |
| Build v1.2.0 | 8 | GPS parava com tela off |
| Build v1.1.1 | 7 | GPS basico funcionando |

### EAS Free — reset em 01/06/2026
Ate la, builds via GitHub Actions (assembleRelease, ARM64+ARM32)

---

## ARQUITETURA v2.0.0

**expo-location nao e mais o GPS principal.** GPS via Java nativo ForegroundService.

### Arquivos src/ (simplificados)

| Arquivo | Papel |
|---|---|
| `src/config.ts` | SUPABASE_URL, ANON_KEY (hardcoded), GPS_INTERVAL_MS=30000 |
| `src/device-id.ts` | getDeviceId() — AndroidId (Settings.Secure.ANDROID_ID) |
| `src/location-service.ts` | requestPermissions() — apenas solicita permissoes |
| ~~`src/background-task.ts`~~ | REMOVIDO — GPS agora e Java |
| ~~`src/heartbeat-service.ts`~~ | REMOVIDO — heartbeat agora e Java |
| ~~`src/offline-queue.ts`~~ | Ainda existe mas nao e mais usado pelo GPS Java |

### index.tsx (simplificado)
Abre → requestPermissions() com timeout 5s → 500ms pause → finishActivity() → fecha.
Nao inicia GPS (o Java ja cuidou disso no BootReceiver).

### Plugins nativos (plugins/)

| Arquivo | Papel |
|---|---|
| `plugins/with-boot-receiver.js` | Cria classes Java + registra no AndroidManifest |

### Classes Java geradas pelo plugin

| Classe | Intent capturado | Acao |
|---|---|---|
| `ImeiModule` | (modulo nativo RN) | Le IMEI via TelephonyManager para dashboard |
| `ImeiPackage` | (registro do modulo) | Registra ImeiModule no ReactApplication |
| `BootReceiver` | BOOT_COMPLETED, QUICKBOOT_POWERON | startForegroundService(GpsLocationService) PRIMEIRO, depois MainActivity |
| `ShutdownReceiver` | ACTION_SHUTDOWN, ACTION_REBOOT | POST sincrono status=offline, timeout 4s |
| `AlarmReceiver` | com.system.posservice.BACKUP_PING | AlarmScheduler.schedule() PRIMEIRO, depois verifica GpsLocationService vivo |
| `AlarmScheduler` | (chamado por BootReceiver/AlarmReceiver) | setExactAndAllowWhileIdle a cada 5min (dispara no Doze) |
| `GpsLocationService` | (ForegroundService START_STICKY) | LocationManager.requestLocationUpdates(GPS, 30s, 0m) → HttpURLConnection → Supabase |

**GpsRestartService REMOVIDO** — nao mais necessario. AlarmReceiver chama startForegroundService diretamente.

### GpsLocationService — comportamento
- `onCreate()`: cria canal de notificacao, `startForeground()` (obrigatorio Android 8+)
- `onStartCommand()`: retorna `START_STICKY` (Android reinicia se OEM matar)
- `LocationListener.onLocationChanged()`: dispara thread → HttpURLConnection
  - `POST /rest/v1/devices?on_conflict=serial` (heartbeat, Prefer: merge-duplicates)
  - `POST /rest/v1/locations` (coordenada)
- Serial: `Settings.Secure.ANDROID_ID`
- Fallback: `NETWORK_PROVIDER` se GPS desabilitado
- Notificacao: canal `gps_tracking`, importancia LOW (sem som/vibracao), ongoing=true

---

## FLUXO COMPLETO v2.0.0

```
BOOT:
  BootReceiver → startForegroundService(GpsLocationService)  ← GPS online em <200ms
  GpsLocationService.onCreate() → LocationManager.requestLocationUpdates(GPS, 30s, 0m)
  BootReceiver → AlarmScheduler.schedule() → watchdog 5min
  BootReceiver → startActivity(MainActivity) → permissoes → finishActivity() em ~1s

A CADA 30s (quando ha fix GPS):
  LocationListener.onLocationChanged() → Thread → HttpURLConnection
  → POST /devices (heartbeat, status=online) → POST /locations (coordenada)

A CADA 5min (watchdog):
  AlarmReceiver.onReceive() → AlarmScheduler.schedule() (PRIMEIRO — garante chain)
  → verifica se GpsLocationService vivo
    SIM → so reagenda
    NAO → startForegroundService(GpsLocationService) + reagenda

DESLIGAMENTO:
  ShutdownReceiver → POST status=offline (timeout 4s)

TELA DESLIGADA:
  GpsLocationService continua (ForegroundService, START_STICKY)
  Se OEM matar → Android reinicia em segundos (START_STICKY)
  Se nao reiniciar → AlarmReceiver reinicia em max 5min
```

---

## PADRAO SUPABASE (CRITICO — nao alterar)

Todas as chamadas de upsert de devices OBRIGAM:
```
URL: /rest/v1/devices?on_conflict=serial
Header: Prefer: resolution=merge-duplicates,return=representation
```
Sem ?on_conflict=serial na URL → 409 Conflict no segundo heartbeat.

GpsLocationService usa `Settings.Secure.ANDROID_ID` como serial.

---

## CREDENCIAIS (hardcoded — correto assim)

```
SUPABASE_URL = 'https://pbzoggfmegmawbnmblpm.supabase.co'
ANON_KEY     = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
```
Anon key e publica por design do Supabase. Seguro hardcodar.
NAO usar .env — EAS Build nao le .env local. URL ficaria undefined no bundle.

---

## GITHUB ACTIONS — WORKFLOW DE BUILD

Arquivo: `.github/workflows/build-apk.yml`

1. `npm ci` — instala dependencias
2. `npx expo prebuild --platform android --clean` — gera pasta android/
3. Configura keystore de assinatura (secrets do repo)
4. Script Python: injeta abiFilters arm64-v8a + armeabi-v7a no build.gradle
5. `./gradlew assembleRelease` — compila APK assinado
6. Artifact: gps-pos-apk-{numero}/app-release.apk (~65MB)

---

## DISPOSITIVOS COMPATIVEIS

| Dispositivo | CPU | Android | Status |
|---|---|---|---|
| Smartpos Arny AR-SP5 | ARM64 | 9 | Testado e funcionando v2.0.0 |
| Sunmi V2 | ARM64 | 7.1+ | Compativel |
| PDA POS WiFi/BT generico | ARM64 ou ARM32 | 7+ | Compativel |

**minSdkVersion**: 24 (Android 7.0)

**Configuracao necessaria no AR-SP5 (uma vez, manual):**
Configuracoes → Apps → Servicos do Sistema → Bateria → Sem restricao

---

## REGRAS DESTE PROJETO

- Build sempre de `C:\eas\gps-pos-apk\` (sem acento)
- Nunca usar `expo prebuild` local — EAS Build cloud e o fluxo correto
- newArchEnabled: false (expo-location background nao funciona com Nova Arquitetura)
- Git no cmd, nao powershell (git nao esta no PATH do PowerShell neste ambiente)
- Commits com acentos: usar arquivo temp `echo msg > commit_msg.txt && git commit -F commit_msg.txt`
- versionCode deve incrementar a cada novo APK instalado

---

## DASHBOARD (repositorio separado)

```
Local:    C:\Users\walla\OneDrive\Area de Trabalho\gps-pos-tracker-lovable\
GitHub:   wallacy-adm/gps-pos-tracker
Deploy:   Vercel (auto-deploy em push na main)
Stack:    Vite + React + TanStack Router + Tailwind + Supabase
```

### Login
- Usuario: `wallacy` | PIN: `170804`
- Sessao: localStorage com expiracao de 7 dias

### Paginas principais
- `/login` — tela de login (publica)
- `/` — lista de todos os POS com status (protegida)
- `/devices/:id` — detalhe com nome editavel, timeline, mapa (protegida)
- `/events` — historico de eventos em BRT (protegida)
- `/settings` — versao do app + logout (protegida)

Logica online: `last_seen_at < 90 segundos` + setInterval(30s) para re-render.
Timezone: todas as datas usam `timeZone: 'America/Sao_Paulo'`.
