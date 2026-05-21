import AsyncStorage from '@react-native-async-storage/async-storage';

const QUEUE_KEY = '@gps_offline_queue';
const MAX_SIZE  = 1000;

export interface LocationPayload {
  lat: number;
  lng: number;
  accuracy?: number;
  provider?: string;
  recorded_at: string;
}

export class OfflineQueue {
  async enqueue(p: LocationPayload): Promise<void> {
    const current = await this.getAll();
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify([...current, p].slice(-MAX_SIZE)));
  }

  async getAll(): Promise<LocationPayload[]> {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  }

  async clear(): Promise<void> {
    await AsyncStorage.removeItem(QUEUE_KEY);
  }

  async size(): Promise<number> {
    return (await this.getAll()).length;
  }
}
