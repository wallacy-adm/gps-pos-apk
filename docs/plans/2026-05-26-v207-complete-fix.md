# GPS POS Tracker — Plano de Implementação v2.0.7

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir 4 bugs críticos confirmados por varredura ADB + entregar 3 melhorias de UI em uma única release coordenada dos dois sistemas.

**Architecture:** APK usa um novo `DeviceIdentifier.java` como única fonte de verdade para serial e IMEI, eliminando a colisão de ANDROID_ID entre dispositivos. Dashboard recebe ajustes cirúrgicos de UI independentes da build do APK. Os dois sistemas constroem em paralelo e convergem na validação final.

**Tech Stack:** APK: React Native + Java (Expo plugin) / build via GitHub Actions. Dashboard: Vite + React + TanStack Router + Supabase / deploy Vercel.

---

## Mapa de Arquivos

### APK (`C:\eas\gps-pos-apk\`)

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `plugins/with-boot-receiver.js` | **Modificar** | Única fonte de todos os Java classes gerados |
| `app.json` | **Modificar** | Version bump: versionCode 24, version "2.0.7" |
| `CLAUDE.md` | **Modificar** | Atualizar status pós-deploy |

Dentro do plugin, novos blocos Java e modificações aos existentes:

| Classe Java | Ação | O que muda |
|---|---|---|
| `DeviceIdentifier.java` | **NOVA** | `getSerial()` + `readImei()` com fallback chain + cache SharedPrefs |
| `GpsLocationService.java` | Modificar | Wake lock + usa DeviceIdentifier + filtro GPS-only + app_version |
| `BootReceiver.java` | Modificar | Usa DeviceIdentifier em vez de ANDROID_ID direto |
| `ShutdownReceiver.java` | Modificar | Idem |
| `AlarmReceiver.java` | Modificar | Idem |

### Dashboard (`C:\Users\walla\OneDrive\Área de Trabalho\gps-pos-tracker-lovable\`)

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `src/integrations/supabase/types.ts` | Modificar | Adicionar `app_version: string \| null` ao tipo Device |
| `src/routes/devices_.$deviceId.tsx` | Modificar | Última localização: adicionar hora/data e precisão |
| `src/routes/index.tsx` | Modificar | Card do dispositivo: exibir versão APK |
| `src/routes/__root.tsx` | Modificar | `<title>` + og:title + apple-mobile-web-app-title → "Painel de Monitoramento" |
| `src/routes/login.tsx` | Modificar | Heading `<h1>` → "Painel de Monitoramento" |
| `src/routes/settings.tsx` | Modificar | String de versão → "Painel de Monitoramento v2.0.7" |

---

## Bugs Corrigidos neste Plano

| # | Bug | Root Cause | Fix |
|---|---|---|---|
| 1 | GPS para com tela desligada (AR-SP5) | `Wake Locks: size=0` — sem `PARTIAL_WAKE_LOCK` | Acquire no `onCreate()`, release no `onDestroy()` |
| 2 | Localização errática / alertas falsos | `NETWORK_PROVIDER` no mesmo listener do GPS | Filtro `if (!GPS_PROVIDER.equals(loc.getProvider())) return;` |
| 3 | IMEI null no AR-SP5 | `tm.getImei()` falha no MT6761 sem tentar slots/API legada | Fallback chain: `getImei()` → `getImei(0)` → `getDeviceId()` → null |
| 4 | Dois terminais sobrescrevem um ao outro | Mesmo `ANDROID_ID` → mesmo serial → mesma linha Supabase | Serial = IMEI (se disponível) com fallback ANDROID_ID, cacheado em SharedPreferences |

---

## FASE 0 — Banco de Dados (pré-requisito, ~5min, independente)

**Execute antes de tudo. Não requer nada da build do APK.**

### Task 0: SQL Schema

**Onde executar:** Qualquer ferramenta com acesso ao Supabase (curl, dashboard SQL editor).

- [ ] **Step 0.1 — Adicionar coluna `app_version`**

```bash
curl -s -X POST "https://pbzoggfmegmawbnmblpm.supabase.co/rest/v1/rpc/exec_sql" \
  -H "apikey: eyJhbGci..." \
  -H "Content-Type: application/json" \
  -d '{"query":"ALTER TABLE devices ADD COLUMN IF NOT EXISTS app_version TEXT;"}'
```

Ou via Supabase dashboard → SQL Editor:
```sql
ALTER TABLE devices ADD COLUMN IF NOT EXISTS app_version TEXT;
```

- [ ] **Step 0.2 — Verificar**

```bash
curl -s "https://pbzoggfmegmawbnmblpm.supabase.co/rest/v1/devices?select=app_version&limit=1" \
  -H "apikey: ..." -H "Authorization: Bearer ..."
# Deve retornar: [{"app_version":null}]
```

---

## FASE 1 — APK v2.0.7 (único build, todas as correções)

> **Execução:** Todas as Tasks 1–6 modificam APENAS `plugins/with-boot-receiver.js`.
> Tasks 1–6 acumulam mudanças. Task 7 faz o único commit + push.
> Build via GitHub Actions leva ~10min — use esse tempo para executar Fase 2 (Dashboard).

---

### Task 1 — Nova classe `DeviceIdentifier` (resolve Bugs 3 + 4)

**Arquivo:** `plugins/with-boot-receiver.js`

**Por que:** Centraliza serial e IMEI em um único lugar. Evita duplicar lógica nas 4 classes existentes. Usa IMEI como serial primário (dispositivos distintos → seriais distintos → sem colisão no Supabase).

- [ ] **Step 1.1 — Adicionar constante `DEVICE_IDENTIFIER_JAVA` no plugin**

Inserir ANTES do bloco `IMEI_MODULE_JAVA` (linha ~15):

```javascript
// ─────────────────────────────────────────────────────────────────────────────
// DeviceIdentifier — única fonte de verdade para serial e IMEI
// Serial = IMEI (se disponível) com fallback para ANDROID_ID
// Cacheado em SharedPreferences — nunca muda após primeira leitura
// ─────────────────────────────────────────────────────────────────────────────
const DEVICE_IDENTIFIER_JAVA = `package com.system.posservice;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Settings;
import android.telephony.TelephonyManager;
import androidx.core.content.ContextCompat;

public class DeviceIdentifier {

    private static final String PREFS       = "posservice_device";
    private static final String KEY_SERIAL  = "serial";
    private static final String KEY_IMEI    = "imei";

    /**
     * Retorna o serial estável do dispositivo.
     * Preferência: IMEI (único por hardware) > ANDROID_ID (pode colidir).
     * Resultado cacheado em SharedPreferences — não muda entre reinicializações.
     */
    public static String getSerial(Context ctx) {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String cached = prefs.getString(KEY_SERIAL, null);
        if (cached != null && !cached.isEmpty()) return cached;

        String imei = readImei(ctx);
        String serial = (imei != null)
            ? imei
            : Settings.Secure.getString(ctx.getContentResolver(), Settings.Secure.ANDROID_ID);

        prefs.edit().putString(KEY_SERIAL, serial).apply();
        return serial;
    }

    /**
     * Lê o IMEI do dispositivo.
     * Cadeia de fallback: getImei() → getImei(0) → getDeviceId() → getDeviceId(0) → null
     * Resultado cacheado em SharedPreferences.
     */
    public static String readImei(Context ctx) {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String cached = prefs.getString(KEY_IMEI, null);
        // Sentinela "NONE" evita re-tentativas desnecessárias em dispositivos sem IMEI
        if ("NONE".equals(cached)) return null;
        if (cached != null && !cached.isEmpty()) return cached;

        String imei = null;
        try {
            if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_PHONE_STATE)
                    == PackageManager.PERMISSION_GRANTED) {

                TelephonyManager tm =
                    (TelephonyManager) ctx.getSystemService(Context.TELEPHONY_SERVICE);
                if (tm != null) {
                    // Tentativa 1: getImei() — API 26+
                    if (Build.VERSION.SDK_INT >= 26) {
                        try { imei = tm.getImei(); } catch (Exception ignored) {}
                        if (isValid(imei)) { cache(prefs, imei); return imei; }
                    }
                    // Tentativa 2: getImei(0) — slot 0 explícito, API 26+
                    if (Build.VERSION.SDK_INT >= 26) {
                        try { imei = tm.getImei(0); } catch (Exception ignored) {}
                        if (isValid(imei)) { cache(prefs, imei); return imei; }
                    }
                    // Tentativa 3: getDeviceId() — depreciado mas funciona em Android <10
                    try {
                        @SuppressWarnings("deprecation")
                        String id = tm.getDeviceId();
                        if (isValid(id)) { cache(prefs, id); return id; }
                    } catch (Exception ignored) {}
                    // Tentativa 4: getDeviceId(0) — slot 0 explícito
                    try {
                        @SuppressWarnings("deprecation")
                        String id = tm.getDeviceId(0);
                        if (isValid(id)) { cache(prefs, id); return id; }
                    } catch (Exception ignored) {}
                }
            }
        } catch (Exception ignored) {}

        // Nenhuma tentativa retornou IMEI — marca sentinela para não tentar de novo
        prefs.edit().putString(KEY_IMEI, "NONE").apply();
        return null;
    }

    private static boolean isValid(String s) {
        return s != null && s.length() >= 14 && s.matches("[0-9]+");
    }

    private static void cache(SharedPreferences prefs, String imei) {
        prefs.edit().putString(KEY_IMEI, imei).apply();
    }
}
`;
```

- [ ] **Step 1.2 — Registrar `DeviceIdentifier.java` na lista de arquivos do plugin**

Na seção `withDangerousMod`, adicionar à lista `files`:

```javascript
const files = {
  'DeviceIdentifier.java'   : DEVICE_IDENTIFIER_JAVA,  // ← NOVO
  'ImeiModule.java'         : IMEI_MODULE_JAVA,
  // ... resto igual
};
```

---

### Task 2 — Wake Lock no `GpsLocationService` (resolve Bug 1)

**Arquivo:** `plugins/with-boot-receiver.js` — bloco `GPS_LOCATION_SERVICE_JAVA`

- [ ] **Step 2.1 — Adicionar imports e campo `wakeLock`**

Adicionar ao bloco de imports do `GpsLocationService`:
```java
import android.os.PowerManager;
```

Adicionar campo à classe (após `keepaliveHandler`):
```java
private PowerManager.WakeLock wakeLock;
```

- [ ] **Step 2.2 — Acquire no `onCreate()`**

Logo após `startForeground(NOTIF_ID, buildNotification());`:
```java
// PARTIAL_WAKE_LOCK mantém CPU e GPS hardware ativos com tela desligada.
// MediaTek MT6761 desliga GPS sem este lock mesmo com ForegroundService ativo.
PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
wakeLock = pm.newWakeLock(
    PowerManager.PARTIAL_WAKE_LOCK,
    "com.system.posservice::GpsWakeLock"
);
wakeLock.setReferenceCounted(false);
wakeLock.acquire();
```

- [ ] **Step 2.3 — Release no `onDestroy()`**

No início de `onDestroy()`, antes de `super.onDestroy()`:
```java
if (wakeLock != null && wakeLock.isHeld()) {
    wakeLock.release();
    wakeLock = null;
}
```

---

### Task 3 — Filtro GPS-only em `onLocationChanged()` (resolve Bug 2)

**Arquivo:** `plugins/with-boot-receiver.js` — bloco `GPS_LOCATION_SERVICE_JAVA`

- [ ] **Step 3.1 — Adicionar filtro no início de `onLocationChanged()`**

A primeira linha dentro de `onLocationChanged(Location loc)`:
```java
// Rejeita localizações de NETWORK_PROVIDER (precisão celular/WiFi inaceitável).
// NETWORK permanece registrado como fallback de resiliência mas não envia coords.
if (loc == null || !LocationManager.GPS_PROVIDER.equals(loc.getProvider())) return;
```

---

### Task 4 — Migrar serial para `DeviceIdentifier` em `GpsLocationService` (resolve Bug 4)

**Arquivo:** `plugins/with-boot-receiver.js` — bloco `GPS_LOCATION_SERVICE_JAVA`

- [ ] **Step 4.1 — Substituir todas as leituras de `ANDROID_ID` e `getImei()` privado**

Em `sendToSupabase()`, `sendHeartbeat()`, `sendBootHeartbeat()`, `sendKeepalive()`:

**Antes:**
```java
String serial = Settings.Secure.getString(getContentResolver(), Settings.Secure.ANDROID_ID);
String imei   = getImei();
```

**Depois:**
```java
String serial = DeviceIdentifier.getSerial(getApplicationContext());
String imei   = DeviceIdentifier.readImei(getApplicationContext());
```

- [ ] **Step 4.2 — Remover método `getImei()` privado da classe `GpsLocationService`**

O método `getImei()` privado (linhas ~1048-1060) torna-se redundante. Remover.

- [ ] **Step 4.3 — Corrigir bug pré-existente de extração de UUID em `sendHeartbeat()`**

> **Bug identificado pelo revisor:** `sendHeartbeat()` tem `int start = idx + 6` mas o token
> `"id":"` tem 7 chars antes do valor UUID. Resultado: `deviceId` sempre `null` → `sendLocation()`
> nunca é chamado → coordenadas entram em `devices` mas NUNCA na tabela `locations`.

No método `sendHeartbeat()`, localizar:
```java
int start = idx + 6;
```
Corrigir para:
```java
int start = idx + 7;
```

Verificar: `BootReceiver.upsertDeviceAndGetId()` e `ShutdownReceiver.upsertDeviceAndGetId()` já usam `idx + 7` corretamente — apenas `GpsLocationService.sendHeartbeat()` estava errado.

- [ ] **Step 4.4 — Adicionar `app_version` em todos os bodies de heartbeat**

Adicionar constante no topo da classe:
```java
private static final String APP_VERSION = "2.0.7";
```

Em `sendHeartbeat()`, após `"last_lng"`:
```java
bodyBuilder.append(",\\"app_version\\":\\"").append(APP_VERSION).append("\\"");
```

Em `sendKeepalive()` e `sendBootHeartbeat()`, antes do fechamento `}`:
```java
body.append(",\\"app_version\\":\\"").append(APP_VERSION).append("\\"");
```

---

### Task 5 — Migrar `BootReceiver`, `ShutdownReceiver`, `AlarmReceiver` (resolve Bug 4 + 3)

**Arquivo:** `plugins/with-boot-receiver.js` — blocos dos 3 receivers

Para cada um dos 3 receivers, fazer as mesmas substituições:

- [ ] **Step 5.1 — `BootReceiver`**

Substituir:
```java
String serial = Settings.Secure.getString(appCtx.getContentResolver(), Settings.Secure.ANDROID_ID);
String imei = getRealImei(appCtx);
```
Por:
```java
String serial = DeviceIdentifier.getSerial(appCtx);
String imei   = DeviceIdentifier.readImei(appCtx);
```

Remover métodos privados `getImei()` e `getRealImei()` do `BootReceiver`.

- [ ] **Step 5.2 — `ShutdownReceiver`**

Mesma substituição. Remover `getImei()` e `getRealImei()` privados.

- [ ] **Step 5.3 — `AlarmReceiver`**

Substituir o bloco inline de leitura de IMEI (linhas ~677-687):
```java
// Remover este bloco inteiro:
String imei = null;
try {
    if (ContextCompat.checkSelfPermission(...)) {
        android.telephony.TelephonyManager tm2 = ...
        ...
    }
} catch (Exception ignored) {}
```
Por:
```java
String serial = DeviceIdentifier.getSerial(context);
String imei   = DeviceIdentifier.readImei(context);
```

Substituir `Settings.Secure.getString(context.getContentResolver(), Settings.Secure.ANDROID_ID)` por `DeviceIdentifier.getSerial(context)`.

Remover método privado `getImei()` do `AlarmReceiver`.

- [ ] **Step 5.4 — Adicionar `app_version` nos bodies dos 3 receivers**

**`BootReceiver` e `ShutdownReceiver`** têm método `buildDeviceBody()` — adicionar parâmetro e incluir no JSON:
```java
private String buildDeviceBody(String serial, String imei, String status, String now,
                               boolean hasLoc, double lat, double lng, String appVersion) {
    // ...campos existentes...
    if (appVersion != null && !appVersion.isEmpty()) {
        sb.append(",\\"app_version\\":\\"").append(appVersion).append("\\"");
    }
    // ...
}
// Chamar com: buildDeviceBody(serial, imei, "online", now, hasLoc, lat, lng, "2.0.7")
```

**`AlarmReceiver`** NÃO tem `buildDeviceBody()` — usa StringBuilder inline (linhas ~688-699 do arquivo atual). Adicionar diretamente no bloco inline, após o campo `imei`:
```java
// No AlarmReceiver, após:
if (imei != null && !imei.isEmpty()) {
    sb.append(",\\"imei\\":\\"").append(imei).append("\\"");
}
// Adicionar:
sb.append(",\\"app_version\\":\\"2.0.7\\"");
```

---

### Task 6 — Version bump no `app.json`

**Arquivo:** `C:\eas\gps-pos-apk\app.json`

- [ ] **Step 6.1 — Incrementar versionCode e version**

```json
"version": "2.0.7",
"android": {
  "versionCode": 24
}
```

---

### Task 7 — Commit e Push do APK

- [ ] **Step 7.1 — TypeScript check (obrigatório antes de commit)**

```bash
cd C:\eas\gps-pos-apk
npx tsc --noEmit
# Deve: 0 erros
```

- [ ] **Step 7.2 — Commit**

```bash
cd C:\eas\gps-pos-apk
echo "v2.0.7: wake lock + serial IMEI + filtro GPS + IMEI fallback chain" > commit_msg.txt
git add plugins/with-boot-receiver.js app.json
git commit -F commit_msg.txt
git push origin main
```

Aguardar GitHub Actions (~10 minutos). **Usar esse tempo para executar Fase 2 (Dashboard).**

- [ ] **Step 7.3 — Verificar build bem-sucedida**

```bash
cd C:\eas\gps-pos-apk
gh run list --limit 3 --repo wallacy-adm/gps-pos-apk
# Deve mostrar "completed success" para o commit v2.0.7
```

- [ ] **Step 7.4 — Download do artifact**

```bash
gh run download <RUN_ID> --repo wallacy-adm/gps-pos-apk --dir ./apk-download
# Artifact disponível em: apk-download/gps-pos-apk-XX/app-release.apk
```

---

## FASE 2 — Dashboard (paralelo com build APK, ~15min)

> Executar enquanto o APK está buildando no GitHub Actions.

### Task 8 — Renomear para "Painel de Monitoramento"

> **Revisor identificou:** O dashboard usa TanStack Router com `head()` em `__root.tsx` como fonte
> do `<title>` — não existe `index.html` editável no projeto Vite com este setup.
> Escopo expandido para cobrir todas as ocorrências visuais.

**Arquivos:** `src/routes/__root.tsx` + `public/manifest.json` + `src/routes/login.tsx` + `src/routes/settings.tsx` + `src/routes/index.tsx`

- [ ] **Step 8.1 — `src/routes/__root.tsx` — título principal e meta tags**

Localizar o bloco `head()`:
```bash
grep -n "GPS POS\|Painel" src/routes/__root.tsx
```

Substituir todas as ocorrências:
```typescript
// Antes:
title: "GPS POS Tracker"
// Depois:
title: "Painel de Monitoramento"

// Antes:
"apple-mobile-web-app-title": "GPS POS"
// Depois:
"apple-mobile-web-app-title": "POS Monitor"

// Antes:
"og:title": "GPS POS Tracker"
// Depois:
"og:title": "Painel de Monitoramento"
```

- [ ] **Step 8.2 — `public/manifest.json`**

```json
{
  "name": "Painel de Monitoramento",
  "short_name": "POS Monitor"
}
```

- [ ] **Step 8.3 — `src/routes/login.tsx` — heading da tela de login**

```bash
grep -n "GPS POS Tracker" src/routes/login.tsx
```
Substituir o `<h1>GPS POS Tracker</h1>` por `<h1>Painel de Monitoramento</h1>`.

- [ ] **Step 8.4 — `src/routes/settings.tsx` — versão exibida**

```bash
grep -n "GPS POS Tracker" src/routes/settings.tsx
```
Substituir `"GPS POS Tracker v1.2.0"` (ou similar) por `"Painel de Monitoramento v1.2.0"`.

- [ ] **Step 8.5 — `src/routes/index.tsx` — heading da lista de terminais**

```bash
grep -n "GPS POS Tracker" src/routes/index.tsx
```
Substituir heading por `"Painel de Monitoramento"` ou remover o heading redundante se o título da aba já cumpre esse papel.

- [ ] **Step 8.6 — Confirmar cobertura total**

```bash
grep -r "GPS POS Tracker\|GPS POS" src/ public/
# Deve retornar: zero ocorrências
```

---

### Task 9 — Última Localização com hora/data

**Arquivo:** `src/routes/devices_.$deviceId.tsx`

O card "ÚLTIMA LOCALIZAÇÃO" atualmente mostra apenas `device.last_lat` e `device.last_lng`. Adicionar hora/data e precisão da última localização conhecida.

- [ ] **Step 9.1 — Localizar o bloco do card**

```bash
grep -n "ÚLTIMA LOCALIZAÇÃO\|last_lat\|last_lng" src/routes/devices_.\$deviceId.tsx
```

- [ ] **Step 9.2 — Adicionar hora/data abaixo das coordenadas**

Após o bloco que exibe as coordenadas, adicionar:

```tsx
{device.last_seen_at && (
  <p className="text-[11px] text-muted-foreground mt-1">
    {formatBRT(device.last_seen_at)}
  </p>
)}
```

O `formatBRT()` já existe no arquivo. Resultado visual:
```
-7.205702
-35.885543
26/05/2026, 20:33:18   ← novo
```

---

### Task 10 — Versão APK no card + types.ts

**Arquivos:** `src/integrations/supabase/types.ts` + `src/routes/index.tsx`

- [ ] **Step 10.1 — Adicionar `app_version` ao tipo Device em `types.ts`**

Localizar a interface/type `Device` e adicionar:
```typescript
app_version: string | null;
```

- [ ] **Step 10.2 — Exibir versão no card da lista de dispositivos**

No componente de card (dentro de `index.tsx` ou `DeviceCard.tsx`), abaixo do serial/IMEI:

```tsx
{device.app_version && (
  <span className="text-[10px] text-muted-foreground font-mono">
    APK {device.app_version}
  </span>
)}
```

---

### Task 11 — Commit e deploy Dashboard

- [ ] **Step 11.1 — TypeScript check**

```bash
cd "C:\Users\walla\OneDrive\Área de Trabalho\gps-pos-tracker-lovable"
npx tsc --noEmit
# Deve: 0 erros
```

- [ ] **Step 11.2 — Commit e push (auto-deploy Vercel)**

```bash
git add src/integrations/supabase/types.ts \
        src/routes/devices_.\$deviceId.tsx \
        src/routes/index.tsx \
        src/routes/__root.tsx \
        src/routes/login.tsx \
        src/routes/settings.tsx
git commit -m "feat: painel de monitoramento + ultima localizacao + versao apk"
git push origin main
# Vercel deploy automático em ~2min
```

---

## FASE 3 — Instalação e Validação (após Fases 1 + 2)

> Instalar em cada dispositivo separadamente. Validar com checklist antes de avançar.

### Task 12 — Instalar v2.0.7 no AR-SP5

- [ ] **Step 12.1 — Conectar AR-SP5 via USB e instalar**

```bash
adb devices  # confirmar ARSP5... device
adb install -r apk-download/gps-pos-apk-XX/app-release.apk
adb reboot
adb wait-for-device && echo "Online"
```

- [ ] **Step 12.2 — Checar serial no Supabase após boot**

```bash
# Aguardar ~90s para o GPS fix
curl -s "https://pbzoggfmegmawbnmblpm.supabase.co/rest/v1/devices?select=serial,imei,app_version,status,last_seen_at&order=last_seen_at.desc&limit=5" \
  -H "apikey: ..." -H "Authorization: Bearer ..."
# Esperado: novo registro com serial=IMEI do AR-SP5 (861536050094847)
# app_version: "2.0.7"
```

- [ ] **Step 12.3 — Verificar wake lock ativo**

```bash
adb shell dumpsys power | grep -E "(Wake Locks|posservice)"
# Esperado: Wake Locks: size=1
# com.system.posservice::GpsWakeLock
```

- [ ] **Step 12.4 — Testar GPS com tela desligada (5 min)**

```bash
# Desligar tela manualmente (botão físico)
# Aguardar 5 minutos
# Verificar heartbeats no Supabase
curl -s ".../rest/v1/devices?serial=eq.861536050094847&select=last_seen_at" -H "..."
# last_seen_at deve ter avançado nos últimos 90s
```

- [ ] **Step 12.5 — Checar que NETWORK_PROVIDER não envia coords**

```bash
adb logcat -d | grep "NETWORK_PROVIDER iniciado"
# Esperado: linha aparece mas GPS locations só chegam de provider=gps no Supabase:
curl -s ".../rest/v1/locations?select=provider&order=recorded_at.desc&limit=5" -H "..."
# Todos: provider="gps"
```

---

### Task 13 — Instalar v2.0.7 no Sunmi V2

- [ ] **Step 13.1 — Conectar V2 via USB e instalar**

```bash
adb devices  # confirmar VB52... device
adb install -r apk-download/gps-pos-apk-XX/app-release.apk
adb reboot
adb wait-for-device && echo "Online"
```

- [ ] **Step 13.2 — Verificar serial diferente do AR-SP5**

```bash
curl -s ".../rest/v1/devices?select=serial,imei,app_version&order=created_at.desc&limit=3" -H "..."
# Esperado: V2 com serial=862595062719725 (IMEI do V2)
#           AR-SP5 com serial=861536050094847 (IMEI do AR-SP5)
#           SERIAIS DIFERENTES — colisão resolvida ✅
```

- [ ] **Step 13.3 — Confirmar dois dispositivos distintos no mapa**

Abrir dashboard → Mapa. Os dois terminais devem aparecer em locais corretos (lado a lado, não alternando).

---

### Task 14 — Limpeza de dispositivos órfãos

Após confirmar que ambos os terminais estão online com os novos seriais (IMEI-based), os antigos registros ficam permanentemente offline.

- [ ] **Step 14.1 — Identificar órfãos**

```bash
curl -s ".../rest/v1/devices?select=id,serial,name,status,last_seen_at&order=last_seen_at.desc" -H "..."
# Identificar registros com serial ANDROID_ID-based que estão offline:
# 5c12bcd5a53227d1, c7da2aca4b417c99, 3e795443ab5aee13 (wallacy)
```

- [ ] **Step 14.2 — Arquivar via dashboard**

Abrir `/devices/<id>` de cada dispositivo órfão → botão "Arquivar".
Não deletar — mantém histórico de eventos.

---

## FASE 4 — Atualizar Documentação

### Task 15 — Atualizar CLAUDE.md do APK

**Arquivo:** `C:\eas\gps-pos-apk\CLAUDE.md`

- [ ] **Step 15.1 — Atualizar status para v2.0.7 VALIDADO**

Seção "STATUS ATUAL":
```markdown
### Build atual — v2.0.7 / versionCode 24 — VALIDADO ✅
Commit: <hash> — wake lock + serial IMEI + filtro GPS + IMEI fallback chain

VALIDADO EM AMBOS DISPOSITIVOS:
- AR-SP5: GPS ativo com tela off (wake lock PARTIAL_WAKE_LOCK) ✅
- AR-SP5: IMEI 861536050094847 como serial ✅
- V2: IMEI 862595062719725 como serial (sem colisão com AR-SP5) ✅
- Ambos: provider=gps em 100% das locations ✅
- Ambos: app_version=2.0.7 no Supabase ✅
```

- [ ] **Step 15.2 — Atualizar REGRAS com novas restrições**

Adicionar nas regras do projeto:
```markdown
- `DeviceIdentifier.getSerial()` é a ÚNICA forma de obter serial — nunca usar ANDROID_ID direto
- `DeviceIdentifier.readImei()` é a ÚNICA forma de obter IMEI — nunca chamar TelephonyManager direto
- `PARTIAL_WAKE_LOCK` é obrigatório no GpsLocationService — sem ele GPS para no AR-SP5 com tela off
- `onLocationChanged()`: sempre verificar `GPS_PROVIDER.equals(loc.getProvider())` antes de enviar
```

- [ ] **Step 15.3 — Commit docs**

```bash
git add CLAUDE.md
git commit -m "docs: atualiza CLAUDE.md para v2.0.7 validado"
git push origin main
```

---

## Melhorias Incluídas (além dos 4 bugs)

| Melhoria | Onde | Impacto |
|---|---|---|
| `DeviceIdentifier` utility class | APK | Centraliza serial+IMEI, elimina código duplicado em 4 classes |
| IMEI cacheado em SharedPreferences | APK | IMEI persistente mesmo se TelephonyManager falhar em reboots subsequentes |
| Serial estável após primeira leitura | APK | Troca de APK sem uninstall não cria novo dispositivo no Supabase |
| `app_version` no heartbeat | APK + Dashboard | Visibilidade de qual versão cada terminal está rodando |
| Última localização com hora/data | Dashboard | UX: contexto temporal da última coordenada |
| "Painel de Monitoramento" | Dashboard | Nome mais descritivo e profissional |

## Novas Ideias para Próximas Versões

| Ideia | Benefício | Complexidade |
|---|---|---|
| **Badge de precisão GPS no card** (verde <20m, amarelo 20-50m, vermelho >50m) | Identifica imediatamente quando GPS está impreciso | 🟢 Simples, só dashboard |
| **Debounce de alertas de geofence** (exigir N leituras consecutivas fora da zona antes de alertar) | Elimina 100% dos alertas falsos de brief GPS jumps | 🟡 Média, lógica nova no backend |
| **Alertas de GPS morto** (se `accuracy` não aparece por >5min, notificar dashboard) | Detecta quando AR-SP5 perde GPS antes do operador notar | 🟡 Média, requer tracking de accuracy timestamp |

---

## Sumário de Execução

```
PARALELO:
  Thread A: Fase 0 (SQL, 5min) → Fase 1 (APK build, 30min com wait) → Fase 3 (validação APK)
  Thread B: Fase 2 (Dashboard, 15min) → verificar Vercel deploy

SEQUENCIAL após ambas threads:
  Fase 3 (validação com dois dispositivos) → Fase 4 (docs + cleanup)

TEMPO ESTIMADO TOTAL: ~60min
```

---

*Plano gerado em 2026-05-26 — GPS POS APK v2.0.7 / Dashboard v-*
