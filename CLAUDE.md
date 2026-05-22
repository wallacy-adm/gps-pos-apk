# CLAUDE.md — GPS POS APK
> Arquivo lido automaticamente pelo Claude Code ao abrir este projeto.
> Ultima atualizacao: 2026-05-22

---

## O QUE E ESTE PROJETO

APK Android que roda em silencio nos terminais POS (Smartpos Arny AR-SP5) e envia
localizacao GPS a cada 30 segundos para o Supabase. O app se disfarça como "POS Service"
(pacote `com.system.posservice`).

**Este projeto NAO tem relacao com Carpe Diem Motel.**

- **APK**: `C:\eas\gps-pos-apk\` (este diretorio)
- **Dashboard**: `C:\Users\walla\OneDrive\Area de Trabalho\gps-pos-tracker-lovable\`
- **Dashboard URL**: https://gps-pos.lovable.app/
- **Supabase**: https://pbzoggfmegmawbnmblpm.supabase.co

---

## STATUS ATUAL — 2026-05-22

### APK DEFINITIVO ENTREGUE
- **Build ID**: `cb956011-321b-4ec8-a00d-0917959c7b41`
- **Artifact URL**: https://expo.dev/artifacts/eas/r95NrV8hZofz1YSvbGs63a.apk
- **Arquivo local**: `C:\Users\walla\Downloads\gps-pos-tracker-DEFINITIVO.apk`
- **Tamanho**: 57,401,680 bytes — ZIP valido, EOCD presente
- **URL Supabase no bundle**: confirmado por grep
- **Todos os bugs corrigidos**: SIM
- **Aguardando**: confirmacao de registro no painel pelo usuario

---

## HISTORICO DE BUILDS

| Build ID | Status | Erro / Observacao |
|----------|--------|-------------------|
| `4d5bcc59` | ERRORED | Path Linux 8.3 (READET~1) |
| `a14929e5` | ERRORED | JSX em arquivo .ts |
| `4850d837` | ERRORED | `using` keyword supabase-js / Hermes |
| `e373bb6d` | ERRORED | Mesmo erro Hermes |
| `1f4a62c9` | ERRORED | Mesmo Hermes |
| `f3a6c9f0` | ERRORED | require('stream') de ws |
| `bf59b235` | ERRORED | require('zlib') de ws |
| `468cac18` | ERRORED | ws aninhado em @supabase/realtime-js |
| `3b09c460` | SUCCESS | resolveRequest+shims (mas URL undefined no bundle) |
| `cb956011` | SUCCESS | **DEFINITIVO — supabase-js removido + credentials hardcoded** |

---

## BUGS CORRIGIDOS (historico completo)

### Bug 1 — supabase-js incompativel com Hermes (CRITICO)
- supabase-js usa OTEL com keyword `using` que Hermes nao suporta
- **Fix definitivo**: remover supabase-js. Substituir por cliente REST nativo com fetch
- Commits: multiplos (eliminacao completa da biblioteca)

### Bug 2 — getOrCreateDeviceId nunca criava o device (deadlock)
- Funcao so fazia SELECT. Primeira execucao: device nao existe → null → task encerra → device nunca criado
- **Fix**: upsert ANTES do SELECT
- **Commit**: `9579f7f`

### Bug 3 — credenciais Supabase nao chegavam ao bundle
- `config.ts` usava `process.env.EXPO_PUBLIC_*`. O .env NAO estava no git → EAS nao recebia → URL = undefined
- **Fix**: hardcode em `src/config.ts` (anon key e seguro para isso)
- **Commit**: `83b4673`

### Bug 4 — APK corrompido (sem EOCD)
- Download via PowerShell retornou HTML em vez do APK → arquivo invalido → Android rejeita
- **Fix**: APK valido localizado no Desktop e copiado para Downloads

---

## ARQUITETURA ATUAL DO CODIGO

**supabase-js foi REMOVIDO.** O cliente e um wrapper REST nativo com fetch.

### Arquivos criticos

| Arquivo | Papel |
|---------|-------|
| `index.tsx` | Entry point (JSX, precisa ser .tsx) |
| `app.json` | Config Expo, permissions, newArchEnabled: false |
| `eas.json` | Perfil preview=APK |
| `src/config.ts` | Credenciais hardcoded + GPS_INTERVAL_MS=30000 |
| `src/background-task.ts` | GPS_LOCATION_TASK com getOrCreateDeviceId (upsert fix) |
| `src/heartbeat-service.ts` | sendHeartbeat via fetch nativo |

### Estrutura src/

```
src/
├── config.ts           ← SUPABASE_URL, SUPABASE_ANON_KEY (hardcoded)
├── background-task.ts  ← GPS_LOCATION_TASK, getOrCreateDeviceId (upsert)
├── heartbeat-service.ts ← sendHeartbeat via fetch
├── device-id.ts        ← serial via expo-application
└── location-service.ts ← requestPermissions + startLocationTracking
```

> REMOVIDOS (nao existem mais):
> - supabase-client.ts (era supabase-js)
> - offline-queue.ts
> - shims/ws.js
> - metro.config.js (resolveRequest nao e mais necessario)

---

## CREDENCIAIS (hardcoded em src/config.ts)

```typescript
export const SUPABASE_URL = 'https://pbzoggfmegmawbnmblpm.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
export const GPS_INTERVAL_MS = 30_000;
```

> Anon key e publica por design. Seguro hardcodar.
> NAO usar .env para EAS — o arquivo .env nao estava no git, logo nunca chegava ao bundle.

---

## SCHEMA SUPABASE (tabela devices)

```
id            uuid        PK (gerado pelo banco)
serial        text        UNIQUE — identificador do dispositivo
name          text        nome amigavel (opcional)
status        text        'online' | 'offline'
last_lat      float8
last_lng      float8
last_seen_at  timestamptz
created_at    timestamptz
```

---

## COMANDOS ESSENCIAIS

```bash
# Novo build (sempre de C:\eas\gps-pos-apk)
cd C:\eas\gps-pos-apk
npx eas-cli build --platform android --profile preview --non-interactive

# Checar builds (usar cmd, nao powershell — git e PATH funcionam no cmd)
cd C:\eas\gps-pos-apk
npx eas-cli build:list --platform android --limit 3 --non-interactive

# Git commit (usar cmd)
cd C:\eas\gps-pos-apk
git add -A
git commit -m "fix: descricao"
git push
```

---

## REGRAS DESTE PROJETO

- Build sempre de `C:\eas\gps-pos-apk\` (sem acento — path 8.3 quebra no EAS)
- Nunca usar `expo prebuild` local — usar EAS Build cloud
- Apos qualquer fix: git add -A && git commit ANTES do build
- Credenciais: hardcoded em config.ts (nao .env)
- newArchEnabled: false (expo-location background nao funciona com Nova Arch)
- Verificar APK antes de entregar: ZIP valido + EOCD + URL Supabase no bundle
