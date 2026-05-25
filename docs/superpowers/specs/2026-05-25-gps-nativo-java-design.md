# Design: GPS Nativo Java Completo
**Data:** 2026-05-25  
**Versão alvo:** v2.0.0 / versionCode 17  
**Status:** Aprovado pelo usuário

---

## Problema confirmado via ADB + dumpsys

O expo-location tem um check em `LocationModule.kt` que lança `ForegroundServiceStartNotAllowedException`
quando `AppForegroundedSingleton.isForegrounded == false`. Esse singleton só se torna `true` quando
a `MainActivity` entra em foreground via `OnActivityEntersForeground`.

No boot do AR-SP5, a MainActivity é parada pelo ActivityManager em ~554ms (antes do JS carregar):
```
14:40:08.081 → MainActivity START
14:40:08.635 → Activity pause timeout → paused (background)
14:40:08.785 → LocationTaskConsumer: "app in background" → GPS BLOQUEADO
14:40:10.967 → React Native carrega — tarde demais
```

Nota: `ForegroundServiceStartNotAllowedException` é exceção nativa do Android 12+ (API 31).
No AR-SP5 (Android 9 / API 28) o check do expo é desnecessário, mas ainda bloqueia via JS.

**dumpsys location confirma:** `com.system.posservice` ausente de todos os location providers.
**ActivityManager services:** nenhum ForegroundService ativo.

---

## Decisão Arquitetural

Substituir expo-location + TaskManager por um **ForegroundService Java nativo** que:
- Não depende do React Native estar em foreground
- Usa `LocationManager.requestLocationUpdates()` diretamente
- Envia dados ao Supabase via `HttpURLConnection` (sem JS)
- Sobrevive independentemente do processo RN

---

## Componentes

### 1. `GpsLocationService` (NOVO — Java ForegroundService)

**Responsabilidades:**
- Estender `Service`, retornar `START_STICKY` (auto-restart se Android matar)
- Chamar `startForeground()` com notificação em `onCreate()` (obrigatório Android 8+)
- Registrar `LocationListener` em `LocationManager.GPS_PROVIDER` (intervalo 30s, distância 0m)
- Fallback automático para `NETWORK_PROVIDER` se GPS desativado
- Em `onLocationChanged()`: disparar thread → `HttpURLConnection` → Supabase

**Endpoints Supabase chamados (igual ao JS atual):**
1. `POST /rest/v1/devices?on_conflict=serial` + `Prefer: resolution=merge-duplicates` → heartbeat
2. `POST /rest/v1/locations` → coordenada

**Serial do device:** `Settings.Secure.ANDROID_ID` — unifica com o JS (elimina dois registros).

**Notificação:** canal `gps_channel`, importância LOW (sem som/vibração), ongoing=true.

**Manifest:**
```xml
<service
  android:name=".GpsLocationService"
  android:enabled="true"
  android:exported="false"
  android:foregroundServiceType="location" />
```

---

### 2. `BootReceiver` (MODIFICADO)

**Fluxo novo:**
```java
onReceive(BOOT_COMPLETED) {
  // 1. GPS nativo — sem depender de MainActivity
  startForegroundService(new Intent(context, GpsLocationService.class))
  
  // 2. Agenda watchdog
  AlarmScheduler.schedule(context)
  
  // 3. Abre MainActivity APENAS para permissões (se necessário)
  startActivity(new Intent(context, MainActivity.class).addFlags(FLAG_ACTIVITY_NEW_TASK))
  
  // 4. Envia heartbeat boot (goAsync, timeout 4s) — mantém igual
}
```

**O GPS sobe antes da MainActivity.** A Activity é opcional e serve só para o diálogo de permissão no primeiro boot. Se já concedidas, pode ser omitida ou aberta silenciosamente.

---

### 3. `AlarmReceiver` (MODIFICADO — watchdog)

**Fluxo novo:**
```java
onReceive(BACKUP_PING) {
  if (!isServiceRunning(GpsLocationService.class)) {
    startForegroundService(new Intent(context, GpsLocationService.class))
  }
  AlarmScheduler.schedule(context)  // reagenda próximo tick
}
```

Remove: lógica de abrir MainActivity, GpsRestartService (não mais necessário).

---

### 4. `AlarmScheduler` (MODIFICADO)

**Troca `setInexactRepeating` por `setExactAndAllowWhileIdle`:**
```java
alarmManager.setExactAndAllowWhileIdle(
  AlarmManager.RTC_WAKEUP,
  System.currentTimeMillis() + 5 * 60 * 1000L,
  pendingIntent
)
```

`setExactAndAllowWhileIdle`: dispara mesmo em Doze Mode. `setInexactRepeating` pode ser deferido por até 15min no Doze.

**Cada tick reagenda o próximo** (padrão chain) porque `setExactAndAllowWhileIdle` não é automático.

---

### 5. `GpsRestartService` (REMOVIDO)

Não é mais necessário. Era um intermediário para o AlarmReceiver abrir a MainActivity (necessário porque startActivity a partir de AlarmReceiver com tela off era bloqueado pelo Android). Com GPS nativo, o AlarmReceiver chama `startForegroundService` diretamente — isso é sempre permitido.

---

### 6. `index.tsx` (SIMPLIFICADO)

```typescript
// Fluxo novo:
// 1. requestPermissions() com timeout 5s
// 2. 500ms pause
// 3. finishActivity()
// Sem startLocationTracking() — GPS é gerenciado pelo Java
```

Remove: `startLocationTracking()`, `withTimeout` wrapper do GPS.

---

### 7. `background-task.ts` (REMOVIDO)

GPS principal agora é Java. Arquivo removido. Import em `index.tsx` removido.

---

### 8. `heartbeat-service.ts` (REMOVIDO)

Heartbeat agora é feito pelo `GpsLocationService.java`. Arquivo removido.

---

## Arquivos Afetados

| Arquivo | Ação |
|---|---|
| `plugins/with-boot-receiver.js` | **Principal** — todas as classes Java aqui |
| `index.tsx` | Simplificar (remover GPS start) |
| `src/background-task.ts` | Remover |
| `src/heartbeat-service.ts` | Remover |
| `app.json` | versionCode 17, version 2.0.0 |

---

## Fluxo Completo v2.0.0

```
BOOT:
  BootReceiver → startForegroundService(GpsLocationService)  ← GPS online em <200ms
  GpsLocationService.onCreate() → LocationManager.requestLocationUpdates(GPS, 30s, 0m)
  BootReceiver → AlarmScheduler.schedule() → watchdog 5min
  BootReceiver → startActivity(MainActivity) → permissões → finishActivity() em ~1s

A CADA 30s:
  LocationListener.onLocationChanged() → Thread → HttpURLConnection
  → POST /devices (heartbeat) → POST /locations (coordenada)

A CADA 5min (watchdog):
  AlarmReceiver.onReceive() → isServiceRunning(GpsLocationService)?
    SIM → apenas reagenda
    NÃO → startForegroundService(GpsLocationService) + reagenda

DESLIGAMENTO:
  ShutdownReceiver → POST status=offline (timeout 4s) — igual ao atual

TELA DESLIGADA:
  GpsLocationService continua (ForegroundService, START_STICKY)
  Se OEM matar → Android reinicia em poucos segundos (START_STICKY)
  Se não reiniciar → AlarmReceiver reinicia em max 5min
```

---

## Serial Unificado

Problema atual: dois registros no Supabase — IMEI (Java) e AndroidID (JS).

Solução: Java usa `Settings.Secure.ANDROID_ID` (igual ao JS).
`ImeiModule` ainda disponível para exibição no dashboard, mas NÃO como serial primário.

---

## Permissões (sem mudança em app.json)

Já declaradas:
- `ACCESS_FINE_LOCATION` ✅
- `ACCESS_BACKGROUND_LOCATION` ✅
- `FOREGROUND_SERVICE` ✅
- `FOREGROUND_SERVICE_LOCATION` ✅
- `RECEIVE_BOOT_COMPLETED` ✅
- `WAKE_LOCK` ✅

---

## Critérios de Sucesso

1. `dumpsys location` mostra `com.system.posservice` ativo após boot (sem MainActivity visível)
2. `dumpsys activity services` mostra `GpsLocationService` rodando
3. Dashboard exibe device online em <60s após ligar o POS
4. Tela preta fecha em <3s (permissões já concedidas)
5. Device permanece online com tela desligada por >10min
6. Após desligar/ligar: GPS volta online sem intervenção manual
