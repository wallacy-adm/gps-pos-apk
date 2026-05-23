# GPS POS Tracker — Documentação Completa do Projeto

> Última atualização: 22/05/2026  
> Modelo usado no desenvolvimento: Claude Sonnet 4.6 (Cowork)

---

## 1. Visão Geral

Sistema de rastreamento GPS para terminais POS (Smartpos Arny AR-SP5, Android 9).
Composto por duas partes independentes que se comunicam via Supabase:

| Parte | Repositório / Localização | Função |
|---|---|---|
| **APK Android** | `C:\eas\gps-pos-apk` | Roda no POS, envia localização |
| **Dashboard Web** | `C:\Users\walla\OneDrive\Área de Trabalho\gps-pos-tracker-lovable` | Painel admin para monitoramento |

---

## 2. Arquitetura Geral

```
┌─────────────────────────┐          ┌───────────────────────┐
│     POS (Android 9)     │          │   Supabase (nuvem)    │
│                         │          │                       │
│  BootReceiver           │  POST    │  devices (tabela)     │
│  → abre app             │ ──────► │  locations (tabela)   │
│  → inicia ForegroundSvc │          │  events (tabela)      │
│  → fecha Activity       │          └───────────┬───────────┘
│                         │                      │ Realtime
│  GPS Task (30s)         │  POST                │
│  → heartbeat            │ ──────►              ▼
│  → location             │          ┌───────────────────────┐
│                         │          │   Dashboard Web       │
│  ShutdownReceiver       │  POST    │   (React + Lovable)   │
│  → status=offline       │ ──────►  │   Vercel deploy       │
│                         │          └───────────────────────┘
│  AlarmReceiver (3h)     │  POST
│  → backup ping          │ ──────►
└─────────────────────────┘
```

---

## 3. Supabase

- **URL:** `https://pbzoggfmegmawbnmblpm.supabase.co`
- **Anon Key:** hardcoded em `src/config.ts` e nos arquivos Java
- **Projeto ID (EAS):** `fad3e092-19a1-4762-8914-99b6d206aa03`

### Tabelas

**devices**
| Campo | Tipo | Descrição |
|---|---|---|
| `id` | uuid (PK) | UUID interno gerado pelo Supabase |
| `serial` | text (UNIQUE) | AndroidId do dispositivo (Settings.Secure.ANDROID_ID) |
| `name` | text (nullable) | Nome amigável editável pelo admin |
| `status` | text | `online` ou `offline` |
| `last_seen_at` | timestamptz | Último heartbeat recebido |
| `last_lat` | float | Latitude do último heartbeat |
| `last_lng` | float | Longitude do último heartbeat |

**locations**
| Campo | Tipo | Descrição |
|---|---|---|
| `id` | uuid (PK) | |
| `device_id` | uuid (FK → devices.id) | |
| `lat` | float | |
| `lng` | float | |
| `accuracy` | float | Precisão em metros |
| `provider` | text | `gps` ou `network` |
| `recorded_at` | timestamptz | Quando o GPS capturou |

**events** (opcional, histórico de status)

### Padrão de upsert (crítico)

Todas as chamadas ao Supabase usam `fetch()` nativo — **nunca supabase-js**.
O upsert de devices exige dois parâmetros obrigatórios:

```
POST /rest/v1/devices?on_conflict=serial
Headers:
  Prefer: resolution=merge-duplicates,return=representation
```

Sem `?on_conflict=serial` na URL, o segundo heartbeat retorna `409 Conflict`.

---

## 4. APK Android

### 4.1 Identificação do Dispositivo

```typescript
// src/device-id.ts
// Prioridade: AndroidId → AsyncStorage → UUID gerado
import * as Application from 'expo-application';
Application.getAndroidId() // = Settings.Secure.ANDROID_ID
```

O mesmo AndroidId é usado no Java nativo (ShutdownReceiver, AlarmReceiver):
```java
Settings.Secure.getString(context.getContentResolver(), Settings.Secure.ANDROID_ID)
```

Ambos retornam o mesmo valor — garante que o device correto é atualizado no Supabase.

### 4.2 Estrutura de Arquivos

```
C:\eas\gps-pos-apk\
├── app.json                    ← Config Expo + permissões Android
├── eas.json                    ← Config de build (profile: preview)
├── package.json
├── App.tsx                     ← Entry point: pede permissões, inicia serviço, fecha
├── plugins/
│   ├── with-boot-receiver.js   ← Plugin Expo: cria 4 classes Java + registra no Manifest
│   └── with-no-launcher-icon.js← Plugin Expo: remove app da gaveta de apps
└── src/
    ├── config.ts               ← SUPABASE_URL, ANON_KEY, GPS_INTERVAL_MS
    ├── device-id.ts            ← getDeviceId() → AndroidId com fallback
    ├── heartbeat-service.ts    ← sendHeartbeat(lat, lng) → upsert device online
    ├── background-task.ts      ← GPS_TASK: recebe coords, envia, gerencia fila offline
    ├── location-service.ts     ← requestPermissions(), locationProviderFromGpsEnabled()
    └── offline-queue.ts        ← OfflineQueue: AsyncStorage, max 1000 itens
```

### 4.3 app.json (configuração atual)

```json
{
  "expo": {
    "name": "Serviços do Sistema",
    "slug": "pos-service",
    "version": "1.0.0",
    "newArchEnabled": false,
    "android": {
      "package": "com.system.posservice",
      "versionCode": 4,
      "permissions": [
        "ACCESS_FINE_LOCATION",
        "ACCESS_COARSE_LOCATION",
        "ACCESS_BACKGROUND_LOCATION",
        "FOREGROUND_SERVICE",
        "FOREGROUND_SERVICE_LOCATION",
        "RECEIVE_BOOT_COMPLETED",
        "REQUEST_IGNORE_BATTERY_OPTIMIZATIONS",
        "INTERNET",
        "ACCESS_NETWORK_STATE"
      ]
    },
    "plugins": [
      ["expo-location", {"locationAlwaysAndWhenInUsePermission": "Necessário para sincronização do sistema."}],
      "./plugins/with-boot-receiver.js",
      "./plugins/with-no-launcher-icon.js"
    ],
    "extra": { "eas": { "projectId": "fad3e092-19a1-4762-8914-99b6d206aa03" } },
    "owner": "wallacy1"
  }
}
```


---

## 5. Fluxo Completo do Ciclo de Vida

### LIGA o dispositivo

```
Android termina boot
  └→ BootReceiver.onReceive() [ACTION_BOOT_COMPLETED]
       ├→ AlarmScheduler.schedule()    ← agenda alarme de 3h no AlarmManager
       └→ startActivity(MainActivity)  ← abre o app

MainActivity (App.tsx)
  └→ requestPermissions() — pede localização "sempre"
       └→ startLocationUpdatesAsync()  ← inicia ForegroundService com GPS
            └→ BackHandler.exitApp()   ← fecha a Activity (serviço continua)

ForegroundService rodando (invisível)
  └→ a cada 30 segundos:
       └→ GPS_TASK recebe coordenada
            ├→ sendHeartbeat(lat, lng) → POST /rest/v1/devices?on_conflict=serial
            │     status=online, last_seen_at=agora
            ├→ sendLocation(deviceId, loc) → POST /rest/v1/locations
            └→ flushQueue(deviceId) ← envia registros offline acumulados
```

### DESLIGA o dispositivo

```
Usuário desliga (ou reinicia)
  └→ ShutdownReceiver.onReceive() [ACTION_SHUTDOWN / ACTION_REBOOT]
       ├→ lê AndroidId → mesmo serial que o JS usa
       └→ HTTP POST síncrono → /rest/v1/devices?on_conflict=serial
             serial=..., status="offline", last_seen_at=agora
             (timeout 7s — janela de execução ~10s antes do Android matar tudo)

Dashboard detecta imediatamente → badge Offline
```

### BACKUP de 3 horas (caso Doze Mode limite o serviço)

```
AlarmManager dispara a cada 3h
  └→ AlarmReceiver.onReceive() [com.system.posservice.BACKUP_PING]
       └→ HTTP POST síncrono → /rest/v1/devices?on_conflict=serial
             serial=..., status="online", last_seen_at=agora
```

### Modo offline (sem internet)

```
GPS_TASK → sendHeartbeat falha (sem rede)
  └→ queue.enqueue(payload) → AsyncStorage (max 1000 itens)

Quando internet retornar:
  └→ próximo ciclo de 30s → flushQueue() → envia todos os itens acumulados
```

---

## 6. Classes Java Nativas (geradas pelo plugin)

O plugin `with-boot-receiver.js` cria os 4 arquivos Java durante o EAS Build,
colocando-os em `android/app/src/main/java/com/system/posservice/`.

### BootReceiver.java
- **Intent:** `BOOT_COMPLETED`, `QUICKBOOT_POWERON`
- **Ação:** Chama `AlarmScheduler.schedule()` + abre `MainActivity`

### ShutdownReceiver.java
- **Intent:** `ACTION_SHUTDOWN`, `QUICKBOOT_POWEROFF`, `ACTION_REBOOT`
- **Ação:** POST síncrono via `HttpURLConnection` → `status=offline`
- **Serial:** lido via `Settings.Secure.ANDROID_ID` (sem permissão especial)
- **Timeout:** 7s connect + 7s read

### AlarmReceiver.java
- **Intent:** `com.system.posservice.BACKUP_PING` (custom action)
- **Ação:** POST síncrono → `status=online`
- **Frequência:** a cada 3 horas (definida pelo AlarmScheduler)

### AlarmScheduler.java
- **Usado por:** BootReceiver na inicialização
- **Método:** `AlarmManager.setInexactRepeating()` — respeita Doze Mode
- **Intervalo:** `3 * 60 * 60 * 1000L` = 3 horas
- **Flags:** `PendingIntent.FLAG_IMMUTABLE` (Android 23+) + `FLAG_UPDATE_CURRENT`

---

## 7. Plugin Expo — with-boot-receiver.js

Localização: `plugins/with-boot-receiver.js`

Faz duas coisas no momento do `eas build`:

**Passo 1 — AndroidManifest.xml** (via `withAndroidManifest`):
- Registra `.BootReceiver` com intent-filters de boot
- Registra `.ShutdownReceiver` com intent-filters de shutdown/reboot
- Registra `.AlarmReceiver` com action customizada
- Adiciona permissão `RECEIVE_BOOT_COMPLETED`

**Passo 2 — Arquivos Java** (via `withDangerousMod`):
- Cria pasta `com/system/posservice/` se não existir
- Escreve `BootReceiver.java`, `ShutdownReceiver.java`, `AlarmReceiver.java`, `AlarmScheduler.java`

**Plugin with-no-launcher-icon.js:**
- Remove `android.intent.category.LAUNCHER` da MainActivity
- App fica invisível na gaveta de apps e tela inicial
- Ainda aparece em Configurações → Aplicativos

---

## 8. Dashboard Web

### Repositório
- **Local:** `C:\Users\walla\OneDrive\Área de Trabalho\gps-pos-tracker-lovable`
- **GitHub:** `wallacy-adm/gps-pos-tracker`
- **Deploy:** Vercel (auto-deploy em push na main)

### Páginas

| Rota | Arquivo | Função |
|---|---|---|
| `/` | `src/routes/index.tsx` | Home com resumo geral |
| `/devices` | `src/routes/devices.tsx` | Lista de todos os POS |
| `/devices/:id` | `src/routes/devices_.$deviceId.tsx` | Detalhe de um POS |
| `/events` | `src/routes/events.tsx` | Histórico de eventos |

### Lógica de Online/Offline

```typescript
// threshold: 90 segundos (3x o intervalo de 30s)
const isOnline = (device: Device) => {
  if (!device.last_seen_at) return false;
  const diff = Date.now() - new Date(device.last_seen_at).getTime();
  return diff < 90_000;
};

// Re-render forçado a cada 30s para recalcular sem depender de evento
useEffect(() => {
  const t = setInterval(() => setTick(n => n + 1), 30_000);
  return () => clearInterval(t);
}, []);
```

### Timezone

Todos os `toLocaleString()` usam:
```typescript
{ timeZone: 'America/Sao_Paulo', ... }
```

### Edição de nome do dispositivo

```typescript
// devices_.$deviceId.tsx
await supabase
  .from("devices")
  .update({ name: editName.trim() || null })
  .eq("id", device.id);
```
- Ícone de lápis → input inline → botões Check/X
- Nome aparece no lugar do serial na listagem

### Realtime (Supabase)

```typescript
supabase
  .channel('device-changes')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'devices', filter: `id=eq.${id}` }, handler)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'events', filter: `device_id=eq.${id}` }, handler)
  .subscribe();
```

---

## 9. Erros Resolvidos e Soluções

### Erro 1 — Crash no boot: "Hermes + OTEL incompatível"
**Causa:** `supabase-js` importa módulos Node.js (`node:async_hooks`, `ws`) que não existem no Hermes (motor JS do React Native).
**Solução:** Eliminar completamente o `supabase-js`. Usar apenas `fetch()` nativo do React Native. Todas as chamadas à API Supabase são `fetch()` direto com headers manuais.

### Erro 2 — 409 Conflict no segundo heartbeat
**Causa:** POST sem `?on_conflict=serial` na URL. O PostgREST não sabia qual coluna usar como chave de conflito.
**Solução:** Adicionar `?on_conflict=serial` na URL + header `Prefer: resolution=merge-duplicates`.

### Erro 3 — `withDangerousModAsync is not a function`
**Causa:** A versão instalada do `@expo/config-plugins` exporta `withDangerousMod` (síncrono), não `withDangerousModAsync`.
**Solução:** Usar `withDangerousMod` com callback `async` interno — funciona porque o resultado é awaited pelo Expo.

### Erro 4 — EAS CLI exit code 4294967295
**Causa:** Versão antiga do `eas-cli` travava antes de submeter o build.
**Solução:** `npm install -g eas-cli` → atualizou para 19.0.8.

### Erro 5 — Git commit falhando com caracteres especiais
**Causa:** CMD interpreta `?on_conflict=serial` como operadores shell.
**Solução:** Usar arquivos `.bat` para todos os commits com mensagens que contenham caracteres especiais.

### Erro 6 — PowerShell "git não reconhecido"
**Causa:** Git não está no PATH do PowerShell por padrão.
**Solução:** Usar caminho completo `"C:\Program Files\Git\cmd\git.exe"` em scripts `.bat` executados via CMD.

### Erro 7 — Dashboard mostrando horário errado (UTC em vez de BRT)
**Causa:** `toLocaleString()` sem `timeZone` usa UTC do servidor Vercel (que roda em UTC).
**Solução:** Todos os `toLocaleString()` agora incluem `{ timeZone: 'America/Sao_Paulo' }`.

### Erro 8 — Device ficava Online 5 minutos após desligar
**Causa:** Threshold de `isOnline` era 5 minutos (300s). Sem `setInterval`, React não recalculava entre eventos Supabase.
**Solução:** Threshold reduzido para 90s + `setInterval(30_000)` para forçar re-render periódico.

---

## 10. Histórico de Commits (APK)

| Hash | Descrição |
|---|---|
| `ec1cbe6` | feat: ShutdownReceiver + AlarmReceiver 3h backup + versionCode 4 |
| `5adb298` | fix: withDangerousMod corrigido para versão do config-plugins instalada |
| `c1b83af` | fix: boot receiver com Java class real e versionCode 3 |
| `d739bdc` | feat: app oculto sem ícone, fecha sozinho, nome disfarçado |
| `d8c793f` | feat: adiciona UI de status para diagnóstico no POS |
| `8e8a0da` | fix: heartbeat upsert precisa de on_conflict=serial na URL |
| `3ad71a7` | fix: remove supabase-js, usa fetch nativo, credenciais hardcoded |

---

## 11. Configuração de Instalação (única vez)

1. Transferir o APK para o POS (USB ou download direto)
2. Instalar: Configurações → Segurança → "Fontes desconhecidas" → instalar
3. Abrir o app **uma vez** pela busca em Configurações → Aplicativos
4. Aceitar permissão de localização → selecionar **"Sempre permitir"**
5. Quando aparecer pop-up de bateria → clicar **"Não otimizar"**
6. O app fecha sozinho
7. **Nunca mais precisar tocar** — tudo é automático daqui em diante

---

## 12. Próximo Build (1 de junho de 2026)

**Causa do bloqueio:** Plano Free do EAS esgotou os builds mensais de Android.
**Reinício:** 1 de junho de 2026.

**Comando para buildar:**
```bash
cd C:\eas\gps-pos-apk
eas build --platform android --profile preview --non-interactive
```

**Após o build:**
1. Baixar o APK gerado no link fornecido pelo EAS
2. Transferir para o POS e instalar sobre a versão anterior
3. O `versionCode: 4` garante que o Android aceita a atualização

**Versão atual no código:** `versionCode: 4`

---

## 13. Dispositivo Testado

| Campo | Valor |
|---|---|
| Modelo | Smartpos Arny AR-SP5 |
| Android | 9 (API 28) |
| Status no dashboard | Online (confirmado) |
| Heartbeats | Funcionando |
| Boot automático | Código pronto, aguarda build de junho |
| Shutdown offline | Código pronto, aguarda build de junho |
| Alarme 3h | Código pronto, aguarda build de junho |

---

## 14. Pendências

- [ ] **Build junho/2026** — rodar `eas build` assim que o plano resetar
- [ ] **Testar ShutdownReceiver** — desligar o POS e confirmar que o dashboard muda para Offline imediatamente
- [ ] **Testar BootReceiver** — religar e confirmar que o app sobe sozinho sem interação
- [ ] **Testar AlarmReceiver** — aguardar 3h parado e confirmar que o ping é enviado
- [ ] **Configurar remote Git** no repo APK (`git remote add origin <url>`) para backup no GitHub
- [ ] **Monitorar Doze Mode** — em uso real, verificar se o serviço de 30s fica estável durante a noite

---

*Documentação gerada automaticamente em 22/05/2026 — Claude Sonnet 4.6*
