const mockUpsert = jest.fn().mockResolvedValue({ error: null });
jest.mock('../src/supabase-client', () => ({
  supabase: { from: () => ({ upsert: mockUpsert }) },
}));
jest.mock('../src/device-id', () => ({
  getDeviceId: jest.fn().mockResolvedValue('SERIAL_TEST_001'),
}));

import { sendHeartbeat } from '../src/heartbeat-service';

describe('sendHeartbeat', () => {
  it('faz upsert com serial, status online, lat e lng corretos', async () => {
    await sendHeartbeat(-7.12, -35.89);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        serial: 'SERIAL_TEST_001',
        status: 'online',
        last_lat: -7.12,
        last_lng: -35.89,
      }),
      { onConflict: 'serial' }
    );
  });
});
