jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  requestBackgroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  hasServicesEnabledAsync: jest.fn().mockResolvedValue(true),
  Accuracy: { High: 5, Balanced: 3 },
}));

import { requestPermissions, locationProviderFromGpsEnabled } from '../src/location-service';

describe('location-service', () => {
  it('requestPermissions retorna true quando ambas as permissões são concedidas', async () => {
    expect(await requestPermissions()).toBe(true);
  });

  it('requestPermissions retorna false quando foreground é negado', async () => {
    const ExpoLocation = require('expo-location');
    ExpoLocation.requestForegroundPermissionsAsync.mockResolvedValueOnce({ status: 'denied' });
    expect(await requestPermissions()).toBe(false);
  });

  it('provider é gps quando GPS ligado', () => {
    expect(locationProviderFromGpsEnabled(true)).toBe('gps');
  });

  it('provider é network quando GPS desligado', () => {
    expect(locationProviderFromGpsEnabled(false)).toBe('network');
  });
});
