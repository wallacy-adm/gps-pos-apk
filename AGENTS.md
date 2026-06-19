# AGENTS.md — GPS POS APK
> Arquivo de contexto para agentes de IA
> Última atualização: 2026-05-31

## RESUMO
APK Android invisível que roda como ForegroundService em terminais POS.
Envia localização GPS + heartbeat para Supabase a cada 30s.
Disfarçado como "Serviços do Sistema" (pacote: com.system.posservice).

## ESTADO CRÍTICO ATUAL
**v2.0.12/vCode29 TEM REGRESSÃO** — devices ficam offline ao trocar Wi-Fi ↔ dados móveis.
Causa: `cache expiry` em `scheduleHeartbeat()` (Change 4 da sessão 2026-05-31).
**Primeira tarefa: remover ou corrigir esse cache expiry.**

O trecho problemático em `plugins/with-boot-receiver.js`:
```java
// REMOVER ESTE BLOCO (introduzido em v2.0.12 — causa regressão):
if (lastKnownLocation != null) {
    long fixAge = System.currentTimeMillis() - lastKnownLocation.getTime();
    if (fixAge > 20 * 60_000L) {
        Log.w(TAG, "Fix expirado (" + (fixAge/60000) + "min) — expirando cache...");
        lastKnownLocation = null;
    }
}
```

## ONDE ESTÁ O CÓDIGO
- **TODO o código Java nativo está em:** `plugins/with-boot-receiver.js`
- É um Expo Config Plugin que injeta Java via template literal
- Não existe pasta `android/` local — gerada na cloud pelo GitHub Actions
- Para editar: str_replace no plugin JS

## VERSÕES
- v2.0.12/vCode29: ⚠️ REGRESSÃO ativa (offline durante troca de rede)
- v2.0.11/vCode28: ✅ Última versão estável
- APK estável em Downloads: `C:\Users\walla\Downloads\gps-pos-v2.0.12.apk`

## BUILD
Push para main → GitHub Actions builda automaticamente → artifact disponível via `gh run download`

## REGRAS CRÍTICAS
- NUNCA usar supabase-js (Hermes crash)
- newArchEnabled: false sempre
- on_conflict=serial em todo upsert devices
- versionCode incrementa a cada APK

## DEVICES EM CAMPO
- AR-SP5 (Smartpos Arny): v2.0.12 instalado — INSTÁVEL
- Sunmi V2: v2.0.11 — funcionando
- CIE2020 (192.168.0.11): sem localização — precisa IP geo fallback
