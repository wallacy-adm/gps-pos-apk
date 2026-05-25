# GPS Nativo Java — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir expo-location por um ForegroundService Java nativo (`GpsLocationService`) que usa `LocationManager.requestLocationUpdates()` diretamente, eliminando o bloqueio `LocationTaskConsumer: Foreground location task cannot be started while the app is in the background`.

**Architecture:** `BootReceiver` inicia `GpsLocationService` via `startForegroundService()` antes da `MainActivity`. O serviço usa `LocationManager` nativo (sem React Native), envia heartbeat + localização ao Supabase via `HttpURLConnection`, e retorna `START_STICKY`. `AlarmReceiver` faz watchdog a cada 5min via `setExactAndAllowWhileIdle` (resiste ao Doze). O lado JS fica apenas com permissões.

**Tech Stack:** Java (Android API 28), `LocationManager`, `HttpURLConnection`, `AlarmManager.setExactAndAllowWhileIdle`, Expo Config Plugin (`withDangerousMod`), React Native bare workflow.

---

## Arquivo-chave

Toda a lógica Java vive em **um único arquivo**:
- `plugins/with-boot-receiver.js` — contém todas as classes Java como strings + lógica do Expo plugin

Arquivos JS modificados/removidos:
- `index.tsx` — simplificar (remover GPS start)
- `src/background-task.ts` — **deletar**
- `app.json` — bump versionCode

---

## Task 1: Adicionar `GpsLocationService` em `with-boot-receiver.js`

**Files:**
- Modify: `plugins/with-boot-receiver.js`

- [ ] **Step 1.1: Inserir a constante `GPS_LOCATION_SERVICE_JAVA` logo após `ALARM_SCHEDULER_JAVA`**

Abrir `plugins/with-boot-receiver.js` e inserir após a linha que encerra `ALARM_SCHEDULER_JAVA` (antes do comentário `// Plugin principal`):

```javascript
// ─────────────────────────────────────────────────────────────────────────────
// GpsLocationService — ForegroundService nativo que usa LocationManager diretamente
// Bypassa expo-location e seu check de foreground (AppForegroundedSingleton).
// Iniciado pelo BootReceiver e pelo AlarmReceiver (watchdog).
// Envia heartbeat + localização ao Supabase a cada 30s via LocationListener.
// ─────────────────────────────────────────────────────────────────────────────
const GPS_LOCATION_SERVICE_JAVA = `package com.system.posservice;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.provider.Settings;
import android.util.Log;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

public class GpsLocationService extends Service {

    private static final String TAG          = "GpsLocationService";
    private static final String SUPABASE_URL = "${SUPABASE_URL}";
    private static final String ANON_KEY     = "${ANON_KEY}";
    private static final int    NOTIF_ID     = 99;
    private static final String CHANNEL_ID   = "gps_tracking";
    private static final long   MIN_TIME_MS  = 30_000L;
    private static final float  MIN_DIST_M   = 0f;

    private LocationManager  locationManager;
    private LocationListener locationListener;
    private boolean          listening = false;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        startForeground(NOTIF_ID, buildNotification());
        startListening();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Chamado no watchdog — garante que listener está ativo
        if (!listening) startListening();
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onDestroy() {
        super.onDestroy();
        stopListening();
        Log.w(TAG, "Servico destruido — START_STICKY ou AlarmReceiver vai reiniciar");
    }

    private void startListening() {
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        if (locationManager == null) return;

        locationListener = new LocationListener() {
            @Override
            public void onLocationChanged(Location loc) {
                // Thread separada: não bloqueia callback do GPS
                new Thread(() -> sendToSupabase(loc)).start();
            }
            @Override public void onStatusChanged(String p, int s, Bundle e) {}
            @Override public void onProviderEnabled(String p) {}
            @Override public void onProviderDisabled(String p) {}
        };

        try {
            boolean ok = false;
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER, MIN_TIME_MS, MIN_DIST_M, locationListener);
                ok = true;
                Log.i(TAG, "GPS_PROVIDER iniciado");
            }
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(
                    LocationManager.NETWORK_PROVIDER, MIN_TIME_MS, MIN_DIST_M, locationListener);
                ok = true;
                Log.i(TAG, "NETWORK_PROVIDER iniciado (fallback)");
            }
            listening = ok;
            if (!ok) {
                Log.e(TAG, "Nenhum provider disponivel — parando servico");
                stopSelf();
            }
        } catch (SecurityException e) {
            Log.e(TAG, "Permissao negada: " + e.getMessage());
            stopSelf();
        }
    }

    private void stopListening() {
        if (locationManager != null && locationListener != null) {
            try { locationManager.removeUpdates(locationListener); } catch (Exception ignored) {}
        }
        listening = false;
    }

    private void sendToSupabase(Location loc) {
        String serial   = Settings.Secure.getString(
            getContentResolver(), Settings.Secure.ANDROID_ID);
        String now      = isoNow(loc.getTime());
        double lat      = loc.getLatitude();
        double lng      = loc.getLongitude();
        Float  accuracy = loc.hasAccuracy() ? loc.getAccuracy() : null;

        // 1. Heartbeat — upsert device, recebe UUID
        String deviceId = sendHeartbeat(serial, lat, lng, now);
        if (deviceId == null) {
            Log.w(TAG, "Heartbeat falhou — localidade nao enviada");
            return;
        }

        // 2. Localidade — insere na tabela locations
        sendLocation(deviceId, lat, lng, accuracy, now);
    }

    private String sendHeartbeat(String serial, double lat, double lng, String now) {
        String body = "{"
            + "\\"serial\\":\\"" + serial + "\\"," 
            + "\\"status\\":\\"online\\","
            + "\\"last_seen_at\\":\\"" + now + "\\"," 
            + "\\"last_lat\\":" + String.format(Locale.US, "%.8f", lat) + ","
            + "\\"last_lng\\":" + String.format(Locale.US, "%.8f", lng)
            + "}";

        HttpURLConnection conn = null;
        try {
            URL url = new URL(SUPABASE_URL + "/rest/v1/devices?on_conflict=serial");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("apikey", ANON_KEY);
            conn.setRequestProperty("Authorization", "Bearer " + ANON_KEY);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Prefer", "resolution=merge-duplicates,return=representation");
            conn.setDoOutput(true);
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            conn.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream os = conn.getOutputStream()) { os.write(bytes); }

            int code = conn.getResponseCode();
            if (code == 200 || code == 201) {
                java.io.InputStream is = conn.getInputStream();
                byte[] buf = new byte[512];
                StringBuilder sb = new StringBuilder();
                int n;
                while ((n = is.read(buf)) != -1)
                    sb.append(new String(buf, 0, n, StandardCharsets.UTF_8));
                String resp = sb.toString();
                int idx = resp.indexOf("\\"id\\":\\"");
                if (idx >= 0) {
                    int start = idx + 6;
                    int end   = resp.indexOf("\\"", start);
                    if (end > start) return resp.substring(start, end);
                }
            }
            Log.w(TAG, "Heartbeat HTTP " + code);
        } catch (Exception e) {
            Log.w(TAG, "Heartbeat erro: " + e.getMessage());
        } finally {
            if (conn != null) conn.disconnect();
        }
        return null;
    }

    private void sendLocation(String deviceId, double lat, double lng, Float accuracy, String now) {
        StringBuilder body = new StringBuilder();
        body.append("{");
        body.append("\\"device_id\\":\\"").append(deviceId).append("\\",");
        body.append("\\"lat\\":").append(String.format(Locale.US, "%.8f", lat)).append(",");
        body.append("\\"lng\\":").append(String.format(Locale.US, "%.8f", lng)).append(",");
        if (accuracy != null) {
            body.append("\\"accuracy\\":").append(String.format(Locale.US, "%.2f", accuracy)).append(",");
        }
        body.append("\\"provider\\":\\"gps\\",");
        body.append("\\"recorded_at\\":\\"").append(now).append("\\"");
        body.append("}");

        HttpURLConnection conn = null;
        try {
            URL url = new URL(SUPABASE_URL + "/rest/v1/locations");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("apikey", ANON_KEY);
            conn.setRequestProperty("Authorization", "Bearer " + ANON_KEY);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Prefer", "return=minimal");
            conn.setDoOutput(true);
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            conn.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream os = conn.getOutputStream()) { os.write(bytes); }
            int code = conn.getResponseCode();
            Log.d(TAG, "Location HTTP " + code);
        } catch (Exception e) {
            Log.w(TAG, "Location erro: " + e.getMessage());
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private String isoNow(long millis) {
        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
        sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
        return sdf.format(new Date(millis));
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID, "Servicos do Sistema", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    private Notification buildNotification() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return new Notification.Builder(this, CHANNEL_ID)
                .setContentTitle("Servicos do Sistema")
                .setContentText("Sincronizacao ativa")
                .setSmallIcon(android.R.drawable.ic_popup_sync)
                .setOngoing(true)
                .build();
        }
        return new Notification.Builder(this)
            .setContentTitle("Servicos do Sistema")
            .setContentText("Sincronizacao ativa")
            .setSmallIcon(android.R.drawable.ic_popup_sync)
            .setOngoing(true)
            .build();
    }
}
`;
```

- [ ] **Step 1.2: Verificar que a constante foi inserida no lugar certo**

```bash
grep -n "GPS_LOCATION_SERVICE_JAVA\|GpsLocationService\|Plugin principal" plugins/with-boot-receiver.js
```

Saída esperada:
```
791:const GPS_LOCATION_SERVICE_JAVA = `package com.system.posservice;
...
NNN:// ─── Plugin principal ───
```
`GPS_LOCATION_SERVICE_JAVA` deve aparecer ANTES do comentário `Plugin principal`.

---

## Task 2: Modificar `BootReceiver` — iniciar GPS nativo primeiro

**Files:**
- Modify: `plugins/with-boot-receiver.js` (constante `BOOT_RECEIVER_JAVA`)

- [ ] **Step 2.1: Localizar e substituir o bloco que abre o app no BootReceiver**

Encontrar este bloco em `BOOT_RECEIVER_JAVA`:
```java
        // 1. ABRE O APP IMEDIATAMENTE — antes de qualquer HTTP
        // Motivo: HTTP tem timeout de 8s cada; BroadcastReceiver tem 10s de vida total.
        // Na versão anterior, HTTP vinha primeiro → receiver morria antes do startActivity.
        try {
            Intent launch = new Intent();
            launch.setClassName(context.getPackageName(),
                    context.getPackageName() + ".MainActivity");
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                          | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            context.startActivity(launch);
        } catch (Exception ignored) {}
```

Substituir por:
```java
        // 1a. GPS NATIVO — sobe em <200ms sem depender de MainActivity estar em foreground
        // GpsLocationService usa LocationManager diretamente, bypassa expo-location.
        try {
            Intent gps = new Intent();
            gps.setClassName(context.getPackageName(),
                    context.getPackageName() + ".GpsLocationService");
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                context.startForegroundService(gps);
            } else {
                context.startService(gps);
            }
        } catch (Exception ignored) {}

        // 1b. ABRE O APP para permissões (tela preta, fecha em ~2s)
        // Necessário no primeiro boot para diálogo de permissão.
        // Em boots subsequentes (permissões já concedidas) fecha automaticamente.
        try {
            Intent launch = new Intent();
            launch.setClassName(context.getPackageName(),
                    context.getPackageName() + ".MainActivity");
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                          | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            context.startActivity(launch);
        } catch (Exception ignored) {}
```

- [ ] **Step 2.2: Verificar diff da mudança**

```bash
cd C:\eas\gps-pos-apk
"C:\Program Files\Git\bin\git.exe" diff plugins/with-boot-receiver.js | head -50
```

Confirmar que `startForegroundService(gps)` aparece no diff ANTES do bloco `startActivity(launch)`.

---

## Task 3: Modificar `AlarmReceiver` — watchdog usa GpsLocationService

**Files:**
- Modify: `plugins/with-boot-receiver.js` (constante `ALARM_RECEIVER_JAVA`)

- [ ] **Step 3.1: Substituir o bloco que inicia GpsRestartService pelo GpsLocationService**

Encontrar em `ALARM_RECEIVER_JAVA`:
```java
        // Usa GpsRestartService para reiniciar o GPS (funciona com tela desligada).
        // startActivity direto é bloqueado pelo Android quando a tela está off.
        // ForegroundService tem permissão para abrir Activity em background.
        try {
            Intent restart = new Intent(context, GpsRestartService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(restart);
            } else {
                context.startService(restart);
            }
        } catch (Exception ignored) {}
    }
```

Substituir por:
```java
        // Reinicia GpsLocationService se morto pelo OEM.
        // startForegroundService é idempotente: se já rodando, chama onStartCommand (seguro).
        try {
            Intent gps = new Intent();
            gps.setClassName(context.getPackageName(),
                    context.getPackageName() + ".GpsLocationService");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(gps);
            } else {
                context.startService(gps);
            }
        } catch (Exception ignored) {}

        // Reagenda próximo tick (setExactAndAllowWhileIdle não é automático)
        AlarmScheduler.schedule(context);
    }
```

---

## Task 4: Modificar `AlarmScheduler` — usar setExactAndAllowWhileIdle

**Files:**
- Modify: `plugins/with-boot-receiver.js` (constante `ALARM_SCHEDULER_JAVA`)

- [ ] **Step 4.1: Substituir o conteúdo completo da constante `ALARM_SCHEDULER_JAVA`**

Substituir toda a constante `ALARM_SCHEDULER_JAVA` por:

```javascript
const ALARM_SCHEDULER_JAVA = `package com.system.posservice;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

public class AlarmScheduler {

    private static final long INTERVAL_MS = 5 * 60 * 1000L; // 5 minutos

    public static void schedule(Context context) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;

        Intent intent = new Intent(context, AlarmReceiver.class);
        intent.setAction(AlarmReceiver.ACTION_BACKUP_PING);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;

        PendingIntent pi = PendingIntent.getBroadcast(context, 0, intent, flags);
        am.cancel(pi);

        long triggerAt = System.currentTimeMillis() + INTERVAL_MS;

        // setExactAndAllowWhileIdle: dispara mesmo em Doze Mode (Android 6+)
        // setInexactRepeating pode ser deferido ate 15min no Doze — inadequado para watchdog
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
        } else {
            am.set(AlarmManager.RTC_WAKEUP, triggerAt, pi);
        }
    }
}
`;
```

---

## Task 5: Atualizar AndroidManifest no plugin (adicionar GpsLocationService, remover GpsRestartService)

**Files:**
- Modify: `plugins/with-boot-receiver.js` (função `withAndroidManifest`)

- [ ] **Step 5.1: Substituir o bloco do manifest que registra GpsRestartService**

Encontrar em `withAndroidManifest`:
```javascript
    const hasService = (name) =>
      app.service.some((s) => s.$?.['android:name'] === name);

    if (!hasService('.GpsRestartService')) {
      app.service.push({
        $: { 'android:name': '.GpsRestartService', 'android:exported': 'false' },
      });
    }
```

Substituir por:
```javascript
    const hasService = (name) =>
      app.service.some((s) => s.$?.['android:name'] === name);

    // GpsLocationService: ForegroundService nativo de GPS (substitui GpsRestartService)
    // foregroundServiceType="location" obrigatorio para Android 10+ (recomendado desde Android 9)
    if (!hasService('.GpsLocationService')) {
      app.service.push({
        $: {
          'android:name': '.GpsLocationService',
          'android:exported': 'false',
          'android:foregroundServiceType': 'location',
        },
      });
    }
```

---

## Task 6: Atualizar lista de arquivos Java gerados no plugin

**Files:**
- Modify: `plugins/with-boot-receiver.js` (função `withDangerousMod`)

- [ ] **Step 6.1: Atualizar o objeto `files` — adicionar GpsLocationService, remover GpsRestartService**

Encontrar em `withDangerousMod`:
```javascript
      const files = {
        'ImeiModule.java'       : IMEI_MODULE_JAVA,
        'ImeiPackage.java'      : IMEI_PACKAGE_JAVA,
        'BootReceiver.java'     : BOOT_RECEIVER_JAVA,
        'ShutdownReceiver.java' : SHUTDOWN_RECEIVER_JAVA,
        'AlarmReceiver.java'    : ALARM_RECEIVER_JAVA,
        'AlarmScheduler.java'   : ALARM_SCHEDULER_JAVA,
        'GpsRestartService.java': GPS_RESTART_SERVICE_JAVA,
      };
```

Substituir por:
```javascript
      const files = {
        'ImeiModule.java'          : IMEI_MODULE_JAVA,
        'ImeiPackage.java'         : IMEI_PACKAGE_JAVA,
        'BootReceiver.java'        : BOOT_RECEIVER_JAVA,
        'ShutdownReceiver.java'    : SHUTDOWN_RECEIVER_JAVA,
        'AlarmReceiver.java'       : ALARM_RECEIVER_JAVA,
        'AlarmScheduler.java'      : ALARM_SCHEDULER_JAVA,
        'GpsLocationService.java'  : GPS_LOCATION_SERVICE_JAVA,
        // GpsRestartService.java removido: substituído por GpsLocationService
      };
```

- [ ] **Step 6.2: Verificar que todas as mudanças em with-boot-receiver.js estão corretas**

```bash
grep -n "GpsLocationService\|GpsRestartService\|GPS_LOCATION_SERVICE\|GPS_RESTART" plugins/with-boot-receiver.js
```

Saída esperada:
- `GPS_LOCATION_SERVICE_JAVA` — aparece como definição da constante
- `GpsLocationService` — aparece em 4 lugares: constante, BootReceiver, AlarmReceiver, manifest, files
- `GpsRestartService` — NÃO deve aparecer mais (exceto possivelmente como comentário ou na constante `GPS_RESTART_SERVICE_JAVA` que pode ser mantida mas não usada)

- [ ] **Step 6.3: Commit parcial das mudanças no plugin**

```bash
cd C:\eas\gps-pos-apk
echo "feat: GpsLocationService - GPS nativo Java, bypassa expo-location foreground check" > commit_msg.txt
"C:\Program Files\Git\bin\git.exe" add plugins/with-boot-receiver.js
"C:\Program Files\Git\bin\git.exe" commit -F commit_msg.txt
del commit_msg.txt
```

---

## Task 7: Simplificar `index.tsx` — remover GPS start

**Files:**
- Modify: `index.tsx`

- [ ] **Step 7.1: Remover import de `startLocationTracking` e `background-task`**

Encontrar em `index.tsx`:
```typescript
import { startLocationTracking } from './src/background-task';
```

Deletar essa linha inteira.

- [ ] **Step 7.2: Remover o bloco GPS fire-and-forget e simplificar o fluxo**

Encontrar:
```typescript
      // 2. GPS — FIRE-AND-FORGET, não awaita
      // O native Android registra o ForegroundService em <500ms independente do
      // Promise resolver. Não precisamos esperar o Promise para fechar a Activity.
      startLocationTracking().catch(() => {});

      // 3. Pausa 2s — garante que startLocationUpdatesAsync() completou e o
      // ForegroundService está vivo antes da Activity fechar.
      // 2s é suficiente: quando o app está em foreground (janela visível),
      // startLocationUpdatesAsync() completa em < 500ms.
      await new Promise<void>(resolve => setTimeout(resolve, 2_000));
```

Substituir por:
```typescript
      // 2. GPS é gerenciado pelo GpsLocationService (Java nativo).
      // Não é necessário iniciar aqui. Pausa curta antes de fechar.
      await new Promise<void>(resolve => setTimeout(resolve, 500));
```

- [ ] **Step 7.3: Atualizar o comentário do `withTimeout` no topo do arquivo**

Encontrar:
```typescript
 * Usado APENAS em requestPermissions() e finishActivity(), NÃO em startLocationTracking.
```

Substituir por:
```typescript
 * Usado em requestPermissions() e finishActivity().
```

- [ ] **Step 7.4: Verificar que index.tsx está correto**

```bash
type index.tsx
```

O arquivo final deve ter exatamente este conteúdo:

```typescript
import { registerRootComponent } from 'expo';
import { useEffect } from 'react';
import { BackHandler, NativeModules, View } from 'react-native';
import { requestPermissions } from './src/location-service';

/**
 * Timeout helper — garante que um await trave no máximo `ms` milissegundos.
 * Usado em requestPermissions() e finishActivity().
 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), ms)
    ),
  ]);
}

/**
 * Activity de bootstrap — invisível ao usuário.
 *
 * Fluxo v2.0.0:
 *   1. requestPermissions()   — com timeout 5s
 *   2. Espera 500ms
 *   3. finishActivity()       — fecha; GpsLocationService já está rodando (Java nativo)
 *
 * O GPS é gerenciado pelo GpsLocationService (Java ForegroundService).
 * Não depende desta Activity estar em foreground.
 */
function App() {
  useEffect(() => {
    (async () => {
      // 1. Permissões — com timeout 5s
      try {
        await withTimeout(requestPermissions(), 5_000);
      } catch (_) {}

      // 2. GPS é gerenciado pelo GpsLocationService (Java nativo).
      // Não é necessário iniciar aqui. Pausa curta antes de fechar.
      await new Promise<void>(resolve => setTimeout(resolve, 500));

      // 3. Fecha a Activity — GpsLocationService continua rodando
      try {
        const finished = await withTimeout(
          NativeModules.ImeiModule?.finishActivity?.() ?? Promise.resolve(false),
          2_000
        );
        if (!finished) BackHandler.exitApp();
      } catch (_) {
        BackHandler.exitApp();
      }
    })();
  }, []);

  // Tela preta — fecha em ~1s (permissões já concedidas)
  return <View style={{ flex: 1, backgroundColor: '#000000' }} />;
}

registerRootComponent(App);
```

---

## Task 8: Remover `background-task.ts` e atualizar `app.json`

**Files:**
- Delete: `src/background-task.ts`
- Modify: `app.json`

- [ ] **Step 8.1: Deletar `src/background-task.ts`**

```bash
del "C:\eas\gps-pos-apk\src\background-task.ts"
```

Verificar que foi removido:
```bash
dir "C:\eas\gps-pos-apk\src\"
```

`background-task.ts` não deve aparecer na listagem.

- [ ] **Step 8.2: Verificar se algum arquivo ainda importa `background-task`**

```bash
"C:\Program Files\Git\bin\git.exe" grep -r "background-task" --include="*.ts" --include="*.tsx"
```

Saída esperada: **sem resultado** (zero linhas).

- [ ] **Step 8.3: Bump versionCode e version em `app.json`**

Editar `app.json`:
- `"version"` de `"1.9.0"` → `"2.0.0"`
- `"versionCode"` de `16` → `17`

Resultado esperado:
```json
{
  "expo": {
    "name": "Serviços do Sistema",
    "slug": "pos-service",
    "version": "2.0.0",
    "orientation": "portrait",
    "newArchEnabled": false,
    "android": {
      "package": "com.system.posservice",
      "versionCode": 17,
```

---

## Task 9: TypeScript check, commit e push

**Files:**
- Nenhum arquivo novo

- [ ] **Step 9.1: Verificar TypeScript (sem erros deve retornar vazio)**

```bash
cd C:\eas\gps-pos-apk
npx tsc --noEmit 2>&1
```

Saída esperada: **sem erros**. Se houver erros sobre `background-task`, verificar se foi removido corretamente de todos os imports.

- [ ] **Step 9.2: Commit final**

```bash
echo "feat: v2.0.0 - GPS nativo Java, remove expo-location GPS start" > commit_msg.txt
"C:\Program Files\Git\bin\git.exe" add index.tsx src/background-task.ts app.json
"C:\Program Files\Git\bin\git.exe" commit -F commit_msg.txt
del commit_msg.txt
```

Confirmar:
```bash
"C:\Program Files\Git\bin\git.exe" log --oneline -3
```

Saída esperada:
```
XXXXXXX feat: v2.0.0 - GPS nativo Java, remove expo-location GPS start
XXXXXXX feat: GpsLocationService - GPS nativo Java, bypassa expo-location foreground check
38c47fd docs: design spec GPS nativo Java v2.0.0
```

- [ ] **Step 9.3: Push para disparar GitHub Actions**

```bash
"C:\Program Files\Git\bin\git.exe" push origin main
```

- [ ] **Step 9.4: Confirmar que GitHub Actions iniciou o build**

```bash
gh run list --repo wallacy-adm/gps-pos-apk --limit 2
```

Saída esperada: uma linha com status `in_progress` ou `queued` para o commit v2.0.0.

---

## Task 10: Aguardar build, instalar via ADB e verificar

**Files:**
- Nenhum

- [ ] **Step 10.1: Aguardar build completar (~10 min) e baixar APK**

```bash
gh run watch --repo wallacy-adm/gps-pos-apk
```

Ou verificar periodicamente:
```bash
gh run list --repo wallacy-adm/gps-pos-apk --limit 1
```

Quando `completed success`:
```bash
$runId = (gh run list --repo wallacy-adm/gps-pos-apk --limit 1 --json databaseId --jq '.[0].databaseId')
gh run download $runId --repo wallacy-adm/gps-pos-apk --dir "C:\Users\walla\Downloads\apk-v200"
```

- [ ] **Step 10.2: Verificar tamanho do APK (deve ser 55-70MB)**

```bash
dir "C:\Users\walla\Downloads\apk-v200"
```

Se for > 100MB, o abiFilter não funcionou. Verificar o workflow `.github/workflows/build-apk.yml`.

- [ ] **Step 10.3: Instalar no POS via ADB**

```bash
adb devices
adb install -r "C:\Users\walla\Downloads\apk-v200\app-debug.apk"
```

Saída esperada:
```
Performing Streamed Install
Success
```

- [ ] **Step 10.4: Limpar logcat e reiniciar o POS**

```bash
adb logcat -c
```

Desligar o POS fisicamente (botão power → desligar). Aguardar 5 segundos. Ligar.

- [ ] **Step 10.5: Verificar GPS ativo via logcat**

```bash
adb logcat -d 2>nul | findstr "GpsLocationService LocationManager"
```

**Sucesso esperado:**
```
GpsLocationService: GPS_PROVIDER iniciado
GpsLocationService: NETWORK_PROVIDER iniciado (fallback)
```

**Falha seria:**
```
GpsLocationService: Permissao negada
```
(nesse caso verificar permissões no POS: Configurações → Apps → Serviços do Sistema → Permissões)

- [ ] **Step 10.6: Verificar ForegroundService ativo**

```bash
adb shell dumpsys activity services com.system.posservice
```

**Sucesso:** saída não vazia, mencionando `GpsLocationService`.

```bash
adb shell dumpsys location | findstr "posservice"
```

**Sucesso:** `com.system.posservice` aparece como cliente ativo nos providers.

- [ ] **Step 10.7: Verificar heartbeat no dashboard**

Abrir o dashboard e confirmar que o dispositivo aparece como **online** em menos de 60 segundos após o boot.

Também verificar no Supabase que `last_seen_at` está sendo atualizado a cada 30s.

- [ ] **Step 10.8: Teste de tela desligada (5 minutos)**

Com o POS ligado e GPS funcionando:
1. Desligar a tela (botão power rápido)
2. Aguardar 5 minutos
3. Verificar dashboard: dispositivo ainda online?

**Sucesso:** `last_seen_at` atualizado mesmo com tela desligada.

---

## Critérios de Aceitação

| Critério | Verificação |
|---|---|
| GPS ativo após boot sem MainActivity | `dumpsys location` mostra posservice |
| ForegroundService rodando | `dumpsys activity services` não vazio |
| Tela preta fecha em <2s | Observação visual |
| Heartbeat no dashboard <60s após boot | Dashboard online |
| GPS persiste com tela desligada 5min | Dashboard online após 5min |
| Sem `"Foreground location task cannot be started"` no logcat | `adb logcat -d \| findstr LocationTask` vazio |

---

## Rollback (se necessário)

Se v2.0.0 falhar, voltar ao v1.9.0:

```bash
adb install -r "C:\Users\walla\Downloads\app-debug-v190.apk"
```

O APK v1.9.0 está instalado na pasta `C:\Users\walla\Downloads\` (baixado anteriormente).
