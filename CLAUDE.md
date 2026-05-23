# CLAUDE.md — GPS POS APK
> Lido automaticamente pelo Claude Code ao abrir este projeto.
> Ultima atualizacao: 2026-05-22 | Versao do codigo: versionCode 4

---

## O QUE E ESTE PROJETO

APK Android invisivel que roda em terminais POS (Smartpos Arny AR-SP5, Android 9).
Envia localizacao GPS a cada 30s para o Supabase. Se disfarça como "Servicos do Sistema".

- **Pacote Android**: `com.system.posservice`
- **APK local**: `C:\eas\gps-pos-apk\` (este diretorio)
- **Dashboard admin**: `C:\Users\walla\OneDrive\Area de Trabalho\gps-pos-tracker-lovable\`
- **GitHub dashboard**: https://github.com/wallacy-adm/gps-pos-tracker
- **Supabase**: https://pbzoggfmegmawbnmblpm.supabase.co
- **EAS Project ID**: `fad3e092-19a1-4762-8914-99b6d206aa03`
- **Documentacao completa**: `PROJETO.md` neste diretorio

---

## STATUS ATUAL — 2026-05-22

### Codigo pronto, build bloqueado ate 01/06/2026
O plano Free do EAS esgotou os builds mensais de Android.
Nao tem como buildar antes de junho sem pagar ou instalar Android Studio local.

### O que ja funciona (APK instalado no POS)
- Heartbeat a cada 30s → Supabase → dashboard mostra Online/Offline
- GPS com ForegroundService (notificacao disfarçada)
- Fila offline: registros guardados no AsyncStorage quando sem internet, enviados ao reconectar
- Dispositivo confirmado online no dashboard

### O que esta codificado mas aguarda build de junho
- **BootReceiver**: sobe o app automaticamente quando o POS liga
- **ShutdownReceiver**: envia status=offline quando o POS desliga
- **AlarmReceiver**: ping de backup a cada 3 horas (caso Doze Mode limite o servico)
- **AlarmScheduler**: agenda o alarme de 3h no boot

---

## HISTORICO DE COMMITS (resumo)

| Hash | Descricao |
|---|---|
| `fdef8a6` | docs: documentacao completa PROJETO.md |
| `ec1cbe6` | feat: ShutdownReceiver + AlarmReceiver 3h backup + versionCode 4 |
| `5adb298` | fix: withDangerousMod corrigido para versao instalada do config-plugins |
| `c1b83af` | fix: boot receiver com Java class real e versionCode 3 |
| `d739bdc` | feat: app oculto sem icone, fecha sozinho, nome disfarcado |
| `3ad71a7` | fix: remove supabase-js, usa fetch nativo, credenciais hardcoded |
| `cb956011` | build: PRIMEIRO BUILD FUNCIONAL (referencia) |

---

## ARQUITETURA DO CODIGO

**supabase-js foi REMOVIDO.** Todas as chamadas usam fetch() nativo.

### Arquivos src/

| Arquivo | Papel |
|---|---|
| `src/config.ts` | SUPABASE_URL, ANON_KEY (hardcoded), GPS_INTERVAL_MS=30000 |
| `src/device-id.ts` | getDeviceId() → AndroidId (Settings.Secure.ANDROID_ID) com fallback |
| `src/heartbeat-service.ts` | sendHeartbeat(lat, lng) → upsert device online no Supabase |
| `src/background-task.ts` | GPS_LOCATION_TASK: recebe coords, envia heartbeat + location, gerencia fila |
| `src/location-service.ts` | requestPermissions(), locationProviderFromGpsEnabled() |
| `src/offline-queue.ts` | OfflineQueue: AsyncStorage, max 1000 itens, flush ao reconectar |

### Plugins nativos (plugins/)

| Arquivo | Papel |
|---|---|
| `plugins/with-boot-receiver.js` | Cria 4 classes Java + registra 3 receivers no AndroidManifest |
| `plugins/with-no-launcher-icon.js` | Remove app da gaveta de apps (invisivel para o operador) |

### Classes Java geradas pelo plugin (criadas no build)

| Classe | Intent capturado | Acao |
|---|---|---|
| `BootReceiver` | BOOT_COMPLETED, QUICKBOOT_POWERON | Agenda alarme 3h + abre app |
| `ShutdownReceiver` | ACTION_SHUTDOWN, ACTION_REBOOT | POST sincrono → status=offline |
| `AlarmReceiver` | com.system.posservice.BACKUP_PING | POST sincrono → status=online |
| `AlarmScheduler` | (chamado pelo BootReceiver) | AlarmManager.setInexactRepeating a cada 3h |

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
LIGA:  BootReceiver → AlarmScheduler.schedule() → startActivity(Main)
         → requestPermissions → startLocationUpdatesAsync → exitApp()
         → GPS Task a cada 30s → heartbeat + location → Supabase

DESLIGA: ShutdownReceiver → POST status=offline → dashboard muda na hora

BACKUP:  AlarmReceiver (a cada 3h) → POST status=online
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

## PROXIMO BUILD — 01/06/2026

```bash
cd C:\eas\gps-pos-apk
eas build --platform android --profile preview --non-interactive
```

Apos buildar:
1. Baixar o APK do link gerado pelo EAS
2. Instalar no POS sobre a versao anterior (versionCode 4 > versoes anteriores)
3. Aceitar permissao de localizacao (sempre permitir) + desativar otimizacao de bateria
4. App fecha sozinho — pronto, nao precisa mais mexer

---

## REGRAS DESTE PROJETO

- Build sempre de `C:\eas\gps-pos-apk\` (sem acento — path 8.3 do EAS quebra com acentos)
- Nunca usar `expo prebuild` local — EAS Build cloud e o fluxo correto
- Antes de qualquer build: git add + git commit (EAS nao ve arquivos nao commitados)
- newArchEnabled: false (expo-location background nao funciona com Nova Arquitetura)
- Git no cmd, nao powershell (git nao esta no PATH do PowerShell neste ambiente)
- Commits com acentos ou caracteres especiais: usar arquivo .bat para evitar erros de shell
- Verificar APK baixado: deve ser ZIP valido com EOCD + conter URL Supabase no bundle

---

## DASHBOARD (repositorio separado)

```
Local:    C:\Users\walla\OneDrive\Area de Trabalho\gps-pos-tracker-lovable\
GitHub:   wallacy-adm/gps-pos-tracker
Deploy:   Vercel (auto-deploy em push na main)
```

Paginas principais:
- `/devices` — lista todos os POS (Online/Offline, ultima localizacao, tempo)
- `/devices/:id` — detalhe com nome editavel, timeline de eventos, mapa
- `/events` — historico de eventos em BRT

Logica online: `last_seen_at < 90 segundos` + setInterval(30s) para re-render.
Timezone: todas as datas usam `timeZone: 'America/Sao_Paulo'`.
