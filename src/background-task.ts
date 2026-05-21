import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { sendHeartbeat } from './heartbeat-service';
import { OfflineQueue, LocationPayload } from './offline-queue';
import { supabase } from './supabase-client';
import { getDeviceId } from './device-id';
import { locationProviderFromGpsEnabled } from './location-service';

export const GPS_TASK = 'GPS_LOCATION_TASK';
const queue = new OfflineQueue();

/**
 * Busca o ID interno (UUID) do device pelo serial.
 * IMPORTANTE: chame sendHeartbeat() ANTES desta função para garantir
 * que o device existe no banco (upsert cria se não existir).
 */
async function getDeviceUUID(): Promise<string | null> {
  const serial = await getDeviceId();
  const { data, error } = await supabase
    .from('devices')
    .select('id')
    .eq('serial', serial)
    .single();
  if (error) {
    console.error('[GPS Task] getDeviceUUID error:', error.message);
    return null;
  }
  return data?.id ?? null;
}

async function sendLocation(
  deviceId: string,
  loc: Location.LocationObject,
  gpsEnabled: boolean
): Promise<void> {
  const { error } = await supabase.from('locations').insert({
    device_id: deviceId,
    lat: loc.coords.latitude,
    lng: loc.coords.longitude,
    accuracy: loc.coords.accuracy,
    provider: locationProviderFromGpsEnabled(gpsEnabled),
    recorded_at: new Date(loc.timestamp).toISOString(),
  });
  if (error) throw error;
}

async function flushQueue(deviceId: string): Promise<void> {
  const items = await queue.getAll();
  if (!items.length) return;
  const records = items.map((p: LocationPayload) => ({ device_id: deviceId, ...p }));
  const { error } = await supabase.from('locations').insert(records);
  if (!error) await queue.clear();
}

TaskManager.defineTask(GPS_TASK, async ({ data, error: taskErr }: any) => {
  if (taskErr) { console.error('[GPS Task] error:', taskErr); return; }
  const locs: Location.LocationObject[] = data?.locations ?? [];
  if (!locs.length) return;

  const loc = locs[locs.length - 1];
  const gpsEnabled = await Location.hasServicesEnabledAsync();

  try {
    // 1. Heartbeat PRIMEIRO — upsert garante que o device existe no banco
    //    (cria na primeira vez, atualiza nas demais)
    await sendHeartbeat(loc.coords.latitude, loc.coords.longitude);

    // 2. Busca o UUID interno após garantir que o device existe
    const deviceId = await getDeviceUUID();
    if (!deviceId) {
      console.error('[GPS Task] device UUID não encontrado após heartbeat');
      return;
    }

    // 3. Envia localização atual
    await sendLocation(deviceId, loc, gpsEnabled);

    // 4. Descarrega fila offline (localizações acumuladas sem internet)
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
  const running = await Location.hasStartedLocationUpdatesAsync(GPS_TASK).catch(() => false);
  if (running) return;

  await Location.startLocationUpdatesAsync(GPS_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: 30_000,
    distanceInterval: 0,
    showsBackgroundLocationIndicator: false,
    foregroundService: {
      notificationTitle: 'POS Service',
      notificationBody: 'Sincronizando dados',
      notificationColor: '#1e293b',
    },
    pausesUpdatesAutomatically: false,
  });
}
