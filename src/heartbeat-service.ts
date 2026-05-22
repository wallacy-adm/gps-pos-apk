import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config';
import { getDeviceId } from './device-id';

const HEADERS = {
  'apikey': SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
  // upsert: se já existe (mesmo serial), atualiza; retorna o registro completo
  'Prefer': 'resolution=merge-duplicates,return=representation',
};

/**
 * Faz upsert do device no Supabase via REST (sem supabase-js).
 * Retorna o UUID interno do device, necessário para inserir locations.
 */
export async function sendHeartbeat(lat: number, lng: number): Promise<string | null> {
  const serial = await getDeviceId();

  const res = await fetch(`${SUPABASE_URL}/rest/v1/devices`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      serial,
      status: 'online',
      last_seen_at: new Date().toISOString(),
      last_lat: lat,
      last_lng: lng,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('[Heartbeat] erro:', res.status, text);
    return null;
  }

  // Supabase retorna array com o registro upsertado
  const rows = await res.json() as Array<{ id: string }>;
  return rows?.[0]?.id ?? null;
}
