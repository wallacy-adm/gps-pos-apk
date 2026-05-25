import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { sendHeartbeat } from './heartbeat-service';
import { OfflineQueue, LocationPayload } from './offline-queue';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config';
import { locationProviderFromGpsEnabled } from './location-service';

export const GPS_TASK = 'GPS_LOCATION_TASK';
const queue = new OfflineQueue();

const HEADERS = {
  'apikey': SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
};

async function sendLocation(
  deviceId: string,
  loc: Location.LocationObject,
  gpsEnabled: boolean
): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/locations`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      device_id: deviceId,
      lat: loc.coords.latitude,
      lng: loc.coords.longitude,
      accuracy: loc.coords.accuracy,
      provider: locationProviderFromGpsEnabled(gpsEnabled),
      recorded_at: new Date(loc.timestamp).toISOString(),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`sendLocation failed: ${res.status} ${text}`);
  }
}

async function flushQueue(deviceId: string): Promise<void> {
  const items = await queue.getAll();
  if (!items.length) return;
  const records = items.map((p: LocationPayload) => ({ device_id: deviceId, ...p }));
  const res = await fetch(`${SUPABASE_URL}/rest/v1/locations`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(records),
  });
  if (res.ok) await queue.clear();
}

TaskManager.defineTask(GPS_TASK, async ({ data, error: taskErr }: any) => {
  if (taskErr) { console.error('[GPS Task] error:', taskErr); return; }
  const locs: Location.LocationObject[] = data?.locations ?? [];
  if (!locs.length) return;

  const loc = locs[locs.length - 1];
  const gpsEnabled = await Location.hasServicesEnabledAsync();

  try {
    const deviceId = await sendHeartbeat(loc.coords.latitude, loc.coords.longitude);
    if (!deviceId) {
      console.error('[GPS Task] heartbeat não retornou UUID — abortando ciclo');
      return;
    }
    await sendLocation(deviceId, loc, gpsEnabled);
    await flushQueue(deviceId);
  } catch (err: any) {
    console.warn('[GPS Task] falha de rede, enfileirando:', err?.message);
    await queue.enqueue({
      lat: loc.coords.latitude,
      lng: loc.coords.longitude,
      accuracy: loc.coords.accuracy ?? undefined,
      provider: locationProviderFromGpsEnabled(gpsEnabled),
      recorded_at: new Date(loc.timestamp).toISOString(),
    });
  }
});

export async function startLocationTracking(): Promise<void> {
  // NÃO checa hasStartedLocationUpdatesAsync() — retorna true mesmo quando
  // o ForegroundService está morto (registro da task persiste no TaskManager).
  // Resultado: startLocationUpdatesAsync() nunca era chamado → GPS nunca subia.
  // startLocationUpdatesAsync() é idempotente: se já rodando, apenas atualiza
  // as opções. Se parado (stale), reinicia o ForegroundService corretamente.
  await Location.startLocationUpdatesAsync(GPS_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: 30_000,
    distanceInterval: 0,
    showsBackgroundLocationIndicator: false,
    foregroundService: {
      notificationTitle: 'Serviços do Sistema',
      notificationBody: 'Sincronização ativa',
      notificationColor: '#1e293b',
    },
    pausesUpdatesAutomatically: false,
  });
}
