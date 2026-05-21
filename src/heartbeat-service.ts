import { supabase } from './supabase-client';
import { getDeviceId } from './device-id';

export async function sendHeartbeat(lat: number, lng: number): Promise<void> {
  const serial = await getDeviceId();
  const { error } = await supabase.from('devices').upsert(
    {
      serial,
      status: 'online',
      last_seen_at: new Date().toISOString(),
      last_lat: lat,
      last_lng: lng,
    },
    { onConflict: 'serial' }
  );
  if (error) console.error('[Heartbeat]', error.message);
}
