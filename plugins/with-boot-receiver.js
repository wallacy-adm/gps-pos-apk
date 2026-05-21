const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withBootReceiver(config) {
  return withAndroidManifest(config, async (androidConfig) => {
    const manifest = androidConfig.modResults.manifest;
    const app = manifest.application?.[0];
    if (!app) return androidConfig;

    if (!app.receiver) app.receiver = [];

    const hasReceiver = app.receiver.some(
      (r) => r.$?.['android:name'] === '.BootReceiver'
    );

    if (!hasReceiver) {
      app.receiver.push({
        $: {
          'android:name': '.BootReceiver',
          'android:enabled': 'true',
          'android:exported': 'true',
        },
        'intent-filter': [
          {
            action: [
              { $: { 'android:name': 'android.intent.action.BOOT_COMPLETED' } },
              { $: { 'android:name': 'android.intent.action.QUICKBOOT_POWERON' } },
            ],
          },
        ],
      });
    }

    const perms = manifest['uses-permission'] ?? [];
    const hasBoot = perms.some(
      (p) => p.$?.['android:name'] === 'android.permission.RECEIVE_BOOT_COMPLETED'
    );
    if (!hasBoot) {
      perms.push({ $: { 'android:name': 'android.permission.RECEIVE_BOOT_COMPLETED' } });
    }
    manifest['uses-permission'] = perms;

    return androidConfig;
  });
};
