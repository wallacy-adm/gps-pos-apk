# CLAUDE.md — GPS POS APK
> Arquivo lido automaticamente pelo Claude Code ao abrir este projeto.
> Última atualização: 2026-05-21

---

## O QUE É ESTE PROJETO

APK Android que roda em silêncio nos terminais POS (Smartpos Arny AR-SP5) e envia localização GPS a cada 30 segundos para o Supabase. O app se disfarça como "POS Service" (pacote `com.system.posservice`).

**Este projeto NÃO tem relação com Carpe Diem Motel.**

- **APK**: `C:\eas\gps-pos-apk\` (este diretório)
- **Dashboard**: `C:\Users\walla\OneDrive\Área de Trabalho\gps-pos-tracker-lovable\` (app Lovable)
- **Dashboard URL**: https://gps-pos.lovable.app/
- **Supabase**: https://pbzoggfmegmawbnmblpm.supabase.co

---

## STATUS ATUAL — 2026-05-21 13:07

### ✅ Build FUNCIONOU — APK PRONTO
- **Build ID**: `3b09c460-605c-4836-bd59-647dc6dcbf4a`
- **Status**: finished ✅
- **APK Download**: https://expo.dev/artifacts/eas/8hQvE3hK6oN2u7zH82gTzu.apk
- **Finalizado**: 2026-05-21 13:14:40
- **Commit**: `8317894`

### Checar status do build
```powershell
cd "C:\eas\gps-pos-apk"
npx eas-cli build:list --platform android --limit 1 --non-interactive
```

---

## HISTÓRICO DE BUILDS (todos os erros e correções)

| Build ID | Status | Erro | Correção |
|----------|--------|------|----------|
| `4d5bcc59` | ❌ | Path Linux com 8.3 do Windows (READET~1) | Mover projeto para `C:\eas\gps-pos-apk\` |
| `a14929e5` | ❌ | JSX em arquivo `.ts` | Renomear `index.ts` → `index.tsx` |
| `4850d837` | ❌ | `using` keyword no supabase-js 2.106.1 (Hermes não suporta) | Downgrade supabase para 2.45.4 |
| `e373bb6d` | ❌ | Mesmo erro Hermes | Aguardando fix do metro.config.js |
| `1f4a62c9` | ❌ | Mesmo Hermes | Mesmo |
| `f3a6c9f0` | ❌ | `require('stream')` de `ws/lib/stream.js` | Instalou `readable-stream`, mas `extraNodeModules` não resolve nested |
| `bf59b235` | ❌ | `require('zlib')` de `ws/lib/permessage-deflate.js` | `extraNodeModules` não intercepta módulos aninhados |
| `468cac18` | ❌ | Mesmo `zlib` — shim anterior ignorado | Metro resolveu ws de `@supabase/realtime-js/node_modules/ws/` |
| `3b09c460` | ✅ | **SUCESSO** — APK gerado | `resolveRequest` + `shims/ws.js` |

---

## O PROBLEMA RAIZ (diagnóstico definitivo)

```
@supabase/realtime-js tem seu PRÓPRIO ws em:
  node_modules/@supabase/realtime-js/node_modules/ws/

ws/lib/websocket.js usa: stream, net, tls, http, https, crypto, url
ws/lib/permessage-deflate.js usa: zlib
ws/lib/stream.js usa: stream
ws/lib/receiver.js usa: stream
ws/lib/sender.js usa: stream, crypto

Nenhum desses módulos Node.js existe no Metro/React Native.
```

**Por que `extraNodeModules` não funcionou:**
- `extraNodeModules` só resolve módulos que NÃO estão em nenhum `node_modules`
- Não sobrescreve pacotes aninhados em `node_modules/@supabase/.../node_modules/ws`

**Por que `resolveRequest` funciona:**
- `resolveRequest` tem prioridade máxima no Metro
- Intercepta QUALQUER `require('ws')` de qualquer profundidade
- Ao redirecionar `require('ws')` → `shims/ws.js`, os arquivos `ws/lib/*.js` nunca são carregados

---

## CORREÇÕES APLICADAS NO BUILD 3b09c460

### 1. `metro.config.js` — resolveRequest intercept
```js
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'ws') {
    return {
      filePath: path.resolve(__dirname, 'shims', 'ws.js'),
      type: 'sourceFile',
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};
```

### 2. `shims/ws.js` — WebSocket nativo do RN
```js
const WS = typeof WebSocket !== 'undefined' ? WebSocket : global.WebSocket;
module.exports = WS;
module.exports.WebSocket = WS;
module.exports.default = WS;
```

### 3. `src/supabase-client.ts` — AsyncStorage em vez de localStorage
```ts
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUri: false,
  },
});
```

### Por que o shim funciona em runtime:
```js
// RealtimeClient.js linha 35:
const NATIVE_WEBSOCKET_AVAILABLE = typeof WebSocket !== 'undefined'; // true no RN

// linha 149: usa WebSocket global direto — não chega no require('ws')
if (NATIVE_WEBSOCKET_AVAILABLE) {
  this.conn = new WebSocket(this._endPointURL()); // ← este caminho é usado
  return;
}
// require('ws') na linha 159 NUNCA executa em runtime, mas Metro bundla estaticamente
// O shim resolve isso no build time
```

---

## ESTRUTURA DO APK

```
C:\eas\gps-pos-apk\
├── index.tsx              ← entry point (JSX, não .ts!)
├── app.json               ← config Expo (newArchEnabled: false)
├── eas.json               ← perfil preview=APK, GRADLE_OPTS 8GB
├── metro.config.js        ← resolveRequest ws→shim + transformIgnorePatterns
├── package.json           ← supabase@2.45.4, main="index.tsx"
├── .env                   ← EXPO_PUBLIC_SUPABASE_URL + ANON_KEY
├── shims/
│   └── ws.js              ← redireciona ws → WebSocket nativo RN
└── src/
    ├── background-task.ts ← TaskManager GPS_LOCATION_TASK (30s)
    ├── config.ts          ← variáveis de ambiente
    ├── device-id.ts       ← serial do POS via expo-application
    ├── heartbeat-service.ts ← upsert na tabela devices
    ├── location-service.ts  ← requestPermissions + helpers
    ├── offline-queue.ts     ← AsyncStorage para envio offline
    └── supabase-client.ts   ← createClient com AsyncStorage
```

---

## TABELAS SUPABASE

| Tabela | Uso no APK |
|--------|-----------|
| `devices` | heartbeat: upsert serial, status, last_seen_at, lat, lng |
| `locations` | insert a cada 30s: device_id, lat, lng, accuracy, provider, recorded_at |
| `events` | (não usado no APK, usado no dashboard) |
| `geofences` | (não usado no APK, usado no dashboard) |

---

## COMANDOS ESSENCIAIS

```powershell
# Iniciar build
cd "C:\eas\gps-pos-apk"
npx eas-cli build --platform android --profile preview --non-interactive

# Checar status
npx eas-cli build:list --platform android --limit 3 --non-interactive

# Ver detalhes de um build específico
npx eas-cli build:view <BUILD_ID> --non-interactive
```

---

## PRÓXIMOS PASSOS APÓS BUILD FUNCIONAR

1. **Baixar APK** — URL em Application Archive URL do build
2. **Instalar no Smartpos Arny AR-SP5** via ADB ou compartilhar arquivo
3. **Verificar no dashboard** — https://gps-pos.lovable.app/devices
4. **Nomear o device** na tela `/devices` do dashboard
5. **Testar tracking** — ver pontos aparecendo no mapa

---

## VARIÁVEIS DE AMBIENTE (.env)

```
EXPO_PUBLIC_SUPABASE_URL=https://pbzoggfmegmawbnmblpm.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

Arquivo `.env` NÃO está no .gitignore → é enviado ao EAS no build.

---

## DECISÕES TÉCNICAS IRREVERSÍVEIS

- **`newArchEnabled: false`** — Nova Arquitetura do RN 0.81 incompatível com expo-location background tasks
- **Supabase 2.45.4** — Versões mais novas (2.106+) usam `using` keyword que Hermes não suporta
- **EAS Cloud build** — Builds locais no Windows falham por problemas de template no CNG
- **Diretório `C:\eas\gps-pos-apk\`** — Caminho sem acentos; caminho original "Área de Trabalho" gerava path 8.3 do Windows que Linux interpretava errado
