import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config';
import { getDeviceId, getImeiOnly } from './device-id';

const HEADERS = {
  'apikey': SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
  // upsert: se já existe (mesmo serial), atualiza; retorna o registro completo
  'Prefer': 'resolution=merge-duplicates,return=representation',
};

/**
 * Faz upsert do device no Supabase via REST (sem supabase-js).
 * ?on_conflict=serial é obrigatório: informa ao PostgREST qual coluna
 * usar como chave de conflito (serial é UNIQUE mas não é PK).
 * Sem isso, o segundo heartbeat retorna 409 Conflict.
 *
 * Retorna o UUID interno do device, necessário para inserir locations.
 */
export async function sendHeartbeat(lat: number, lng: number): Promise<string | null> {
  const serial = await getDeviceId();
  const imei   = await getImeiOnly();   // null se READ_PHONE_STATE negado

  const payload: Record<string, unknown> = {
    serial,
    status: 'online',
    last_seen_at: new Date().toISOString(),
    last_lat: lat,
    last_lng: lng,
  };
  if (imei) payload.imei = imei;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/devices?on_conflict=serial`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    // Fallback: se imei causou erro (coluna pode não existir ainda no DB), tenta sem
    if (payload.imei) {
      delete payload.imei;
      const res2 = await fetch(`${SUPABASE_URL}/rest/v1/devices?on_conflict=serial`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify(payload),
      });
      if (res2.ok) {
        const rows2 = await res2.json() as Array<{ id: string }>;
        return rows2?.[0]?.id ?? null;
      }
      console.error('[Heartbeat] erro (fallback):', res2.status, await res2.text());
      return null;
    }
    console.error('[Heartbeat] erro:', res.status, text);
    return null;
  }

  // Supabase retorna array com o registro upsertado
  const rows = await res.json() as Array<{ id: string }>;
  return rows?.[0]?.id ?? null;
}
