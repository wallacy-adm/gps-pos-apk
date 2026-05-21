jest.mock('expo-application', () => ({ getAndroidId: () => 'TEST_ANDROID_ID_123' }));

import { getDeviceId } from '../src/device-id';

describe('getDeviceId', () => {
  it('retorna string não vazia', async () => {
    const id = await getDeviceId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('retorna o mesmo ID em chamadas repetidas', async () => {
    const id1 = await getDeviceId();
    const id2 = await getDeviceId();
    expect(id1).toBe(id2);
  });
});
