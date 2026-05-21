// Mock manual do AsyncStorage
const store: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem:    jest.fn((k: string) => Promise.resolve(store[k] ?? null)),
  setItem:    jest.fn((k: string, v: string) => { store[k] = v; return Promise.resolve(); }),
  removeItem: jest.fn((k: string) => { delete store[k]; return Promise.resolve(); }),
  clear:      jest.fn(() => { Object.keys(store).forEach(k => delete store[k]); return Promise.resolve(); }),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { OfflineQueue } from '../src/offline-queue';

describe('OfflineQueue', () => {
  beforeEach(() => (AsyncStorage as any).clear());

  it('enfileira e recupera um item', async () => {
    const q = new OfflineQueue();
    await q.enqueue({ lat: -7.12, lng: -35.89, recorded_at: new Date().toISOString() });
    expect(await q.getAll()).toHaveLength(1);
  });

  it('não ultrapassa 1000 itens', async () => {
    const q = new OfflineQueue();
    for (let i = 0; i < 1005; i++) {
      await q.enqueue({ lat: i, lng: i, recorded_at: new Date().toISOString() });
    }
    expect((await q.getAll()).length).toBeLessThanOrEqual(1000);
  });

  it('limpa tudo após clear()', async () => {
    const q = new OfflineQueue();
    await q.enqueue({ lat: 1, lng: 1, recorded_at: new Date().toISOString() });
    await q.clear();
    expect(await q.getAll()).toHaveLength(0);
  });
});
