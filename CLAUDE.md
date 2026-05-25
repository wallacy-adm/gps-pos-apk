# CLAUDE.md — GPS POS APK
> Lido automaticamente pelo Claude Code ao abrir este projeto.
> Ultima atualizacao: 2026-05-24 | Versao do codigo: versionCode 12 / v1.5.0

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
- **Documentacao completa**: `PROJETO.md` neste diretorio

---

## STATUS ATUAL — 2026-05-24

### Build atual — v1.5.0 / versionCode 12 — EM ANDAMENTO (GitHub Actions)
Commit: `3341485` | Push: 2026-05-24 (noite)

**Mudancas v1.5.0:**
- `index.tsx`: Tela de ativacao de bateria REMOVIDA completamente
  - Novo fluxo: permissions → startLocationTracking → closeActivity
  - App fecha em ~1-2s, ForegroundService continua rodando
  - Sem mais loop de ativacao em todo boot/reinicializacao
- `AlarmReceiver`: agora faz 2 coisas alem do ping HTTP:
  1. Envia ultima localizacao conhecida (last_lat/last_lng atualizados a cada 5min)
  2. Abre MainActivity para reiniciar GPS se OEM tiver matado o task
- Auto-recuperacao: GPS morto → AlarmReceiver reinicia em ≤5 minutos

**Configuracao obrigatoria no AR-SP5 (uma vez, manual):**
Configuracoes → Apps → Servicos do Sistema → Bateria → Sem restricao

### Historico de builds
| Build | versionCode | Resultado |
|---|---|---|
| Build #12 (v1.5.0) | 12 | Em andamento |
| Build #11 (v1.4.1) | 11 | Ineficaz — battery button fix apenas |
| Build #10 (v1.4.0) | 10 | Ineficaz — finishActivity era no-op |
| Build #9 (v1.2.0) | 8 | Funcionou parcialmente — GPS parava com tela off |
| Build #7 (v1.1.1) | 7 | GPS basico funcionando |

**APRENDIZADO CRITICO (2026-05-24):**
BackHandler.exitApp() em React Native NAO chama System.exit(). Ele chama
invokeDefaultOnBackPressed() → activity.finish(). O ForegroundService
sobrevive nos dois casos. A v1.4.0 foi um no-op completo.
O GPS parava com tela desligada por OEM power management do AR-SP5
matando o task expo-location — nao era o exitApp o culpado.

### O que funciona no POS (confirmado)
- Heartbeat a cada 30s com localizacao GPS
- ForegroundService com WakeLock (online com tela desligada, SE bateria configurada)
- Fila offline: AsyncStorage, flush ao reconectar
- BootReceiver: app sobe automaticamente ao ligar o dispositivo (abre MainActivity)
- ShutdownReceiver: manda status=offline ao desligar (timeout 4s)
- AlarmReceiver: ping a cada 5min + envia localizacao + reinicia GPS se morto
- ImeiModule: le IMEI via modulo nativo Java

### EAS Free — reset em 01/06/2026
Ate la, builds via GitHub Actions (assembleDebug, ~65MB ARM64+ARM32)

---

## HISTORICO DE COMMITS (resumo do mais recente ao mais antigo)

| Hash | Descricao |
|---|---|
| `2a51e23` | ci: ARM64+ARM32 filter para compatibilidade POS Sunmi e PDA |
| `63c18da` | ci: add abiFilters arm64-v8a to reduce APK size |
| `5144d0b` | fix: hora BRT na descricao boot/shutdown, timeout 4s, versionCode 6, v1.1.0 |
| `76f7624` | feat: IMEI serial, tela-off online, localizacao boot/shutdown, versionCode 5 |
| `a33a440` | ci: add GitHub Actions workflow for Android APK build |
| `2ff777f` | docs: CLAUDE.md atualizado estado final versionCode4 |
| `fdef8a6` | docs: documentacao completa PROJETO.md |
| `ec1cbe6` | feat: ShutdownReceiver + AlarmReceiver 3h backup + versionCode 4 |

---

## ARQUITETURA DO CODIGO

**supabase-js foi REMOVIDO.** Todas as chamadas usam fetch() nativo.

### Arquivos src/

| Arquivo | Papel |
|---|---|
| `src/config.ts` | SUPABASE_URL, ANON_KEY (hardcoded), GPS_INTERVAL_MS=30000 |
| `src/device-id.ts` | getDeviceId() — AndroidId (Settings.Secure.ANDROID_ID) com fallback |
| `src/heartbeat-service.ts` | sendHeartbeat(lat, lng) — upsert device online no Supabase |
| `src/background-task.ts` | GPS_LOCATION_TASK: recebe coords, envia heartbeat + location, fila |
| `src/location-service.ts` | requestPermissions(), locationProviderFromGpsEnabled() |
| `src/offline-queue.ts` | OfflineQueue: AsyncStorage, max 1000 itens, flush ao reconectar |

### Plugins nativos (plugins/)

| Arquivo | Papel |
|---|---|
| `plugins/with-boot-receiver.js` | Cria 6 classes Java + registra receivers no AndroidManifest |
| ~~`plugins/with-no-launcher-icon.js`~~ | REMOVIDO em v1.1.1 — causava getLaunchIntentForPackage null |

### 6 Classes Java geradas pelo plugin (criadas no build)

| Classe | Intent capturado | Acao |
|---|---|---|
| `ImeiModule` | (modulo nativo RN) | Le IMEI via TelephonyManager |
| `ImeiPackage` | (registro do modulo) | Registra ImeiModule no ReactApplication |
| `BootReceiver` | BOOT_COMPLETED, QUICKBOOT_POWERON | Agenda alarme 3h + abre app + envia localizacao boot |
| `ShutdownReceiver` | ACTION_SHUTDOWN, ACTION_REBOOT | POST sincrono status=offline com localizacao, timeout 4s |
| `AlarmReceiver` | com.system.posservice.BACKUP_PING | POST status=online + ultima loc a cada 5min + reinicia MainActivity |
| `AlarmScheduler` | (chamado pelo BootReceiver) | AlarmManager.setInexactRepeating a cada 5min |

---

## PADRAO SUPABASE (CRITICO — nao alterar)

Todas as chamadas de upsert de devices OBRIGAM:
```
URL: /rest/v1/devices?on_conflict=serial
Header: Prefer: resolution=merge-duplicates,return=representation
```
Sem ?on_conflict=serial na URL → 409 Conflict no segundo heartbeat.

O serial do device e sempre `Settings.Secure.ANDROID_ID` (sem permissoes especiais).
O mesmo valor e usado pelo JS (via expo-application) e pelo Java nativo.

---

## FLUXO RAPIDO: LIGA / DESLIGA / 30s

```
LIGA:  BootReceiver → AlarmScheduler.schedule() → envia localizacao boot
         → startActivity(Main) → requestPermissions
         → startLocationUpdatesAsync → finishActivity() (tela preta, ~1-2s)
         → GPS Task a cada 30s → heartbeat + location → Supabase

DESLIGA: ShutdownReceiver → POST status=offline (timeout 4s) → dashboard offline

BACKUP (a cada 5min):
  AlarmReceiver → POST status=online + ultima localizacao conhecida
                → startActivity(Main) → GPS ainda rodando? retorna imediato
                                      → GPS morto? relanca + fecha em 1s
```

---

## CREDENCIAIS (hardcoded em src/config.ts — correto assim)

```typescript
export const SUPABASE_URL      = 'https://pbzoggfmegmawbnmblpm.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBiem9nZ2ZtZWdtYXdibm1ibHBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzMDYzOTksImV4cCI6MjA5NDg4MjM5OX0.OpRY-AH7vHsQYHzi39QpqiYL_uNxWOZFE_pYvOSo3Ic';
export const GPS_INTERVAL_MS   = 30_000;
```
Anon key e publica por design do Supabase. Seguro hardcodar.
NAO usar .env — EAS Build nao le .env local. URL ficaria undefined no bundle.

---

## GITHUB ACTIONS — WORKFLOW DE BUILD

Arquivo: `.github/workflows/build-apk.yml`

O workflow roda em push no main e gera APK debug instalavel sem keystore:
1. `npm ci` — instala dependencias
2. `npx expo prebuild --platform android --clean` — gera pasta android/
3. Script Python: injeta `abiFilters "arm64-v8a", "armeabi-v7a"` no build.gradle
4. `./gradlew assembleDebug` — compila o APK
5. Artifact disponivel em Actions → gps-pos-apk-{numero} → app-debug.apk

**Por que abiFilters?** Sem esse filtro, o Gradle compila para 4 arquiteturas
(ARM64, ARM32, x86, x86_64), gerando APK de 108MB que o POS nao aceita.
Com o filtro, APK fica em ~65MB e roda em qualquer terminal POS real.

**Limitacao do GitHub Actions vs EAS:**
O workflow usa `expo prebuild` (que CLAUDE.md diz para nao usar localmente).
E uma solucao temporaria ate o EAS resetar em 01/06/2026.
O EAS gera APK com assinatura consistente e sem variacao de tamanho.

---

## DISPOSITIVOS COMPATIVEIS

| Dispositivo | CPU | Android | Status |
|---|---|---|---|
| Smartpos Arny AR-SP5 | ARM64 | 9 | Testado e funcionando |
| Sunmi V2 | ARM64 | 7.1+ | Compativel |
| PDA POS WiFi/BT generico | ARM64 ou ARM32 | 7+ | Compativel |
| Emulador x86 | x86 | qualquer | NAO compativel (filtrado) |

**minSdkVersion**: 24 (Android 7.0) — definido pelo Expo SDK 54.

**Configuracao necessaria no Sunmi V2:**
Configuracoes → Gerenciar aplicativos → Servicos do Sistema → Permissoes
→ ativar "Iniciar em segundo plano" + desativar "Otimizacao de bateria"

---

## PROXIMO BUILD — 01/06/2026

```bash
cd C:\eas\gps-pos-apk
eas build --platform android --profile preview --non-interactive
```

Apos buildar:
1. Baixar o APK do link gerado pelo EAS
2. Instalar no POS sobre a versao anterior (versionCode 6 > versoes anteriores)
3. Aceitar permissao de localizacao (sempre permitir) + desativar otimizacao de bateria
4. App fecha sozinho — nao precisa mais mexer

---

## REGRAS DESTE PROJETO

- Build sempre de `C:\eas\gps-pos-apk\` (sem acento — path 8.3 do EAS quebra com acentos)
- Nunca usar `expo prebuild` local — EAS Build cloud e o fluxo correto
- Antes de qualquer build: git add + git commit (EAS nao ve arquivos nao commitados)
- newArchEnabled: false (expo-location background nao funciona com Nova Arquitetura)
- Git no cmd, nao powershell (git nao esta no PATH do PowerShell neste ambiente)
- Commits com acentos: usar arquivo temp com `echo msg > commit_msg.txt && git commit -F commit_msg.txt`
- Verificar APK baixado: tamanho deve ser ~55-70MB. Se for 108MB, o abiFilter nao funcionou.

---

## DASHBOARD (repositorio separado)

```
Local:    C:\Users\walla\OneDrive\Area de Trabalho\gps-pos-tracker-lovable\
GitHub:   wallacy-adm/gps-pos-tracker
Deploy:   Vercel (auto-deploy em push na main)
Stack:    Vite + React + TanStack Router + Tailwind + Supabase
```

### Login (adicionado em 23/05/2026)
- Usuario: `wallacy` | PIN: `170804`
- Sessao: localStorage com expiracao de 7 dias
- Arquivos: `src/utils/auth.ts`, `src/routes/login.tsx`, `src/routes/__root.tsx`
- AuthGuard em `__root.tsx` redireciona para /login se nao autenticado
- Botao de logout em `src/routes/settings.tsx`

### Paginas principais
- `/login` — tela de login (publica)
- `/` — lista de todos os POS com status (protegida)
- `/devices/:id` — detalhe com nome editavel, timeline, mapa (protegida)
- `/events` — historico de eventos em BRT (protegida)
- `/settings` — versao do app + logout (protegida)

Logica online: `last_seen_at < 90 segundos` + setInterval(30s) para re-render.
Timezone: todas as datas usam `timeZone: 'America/Sao_Paulo'`.
