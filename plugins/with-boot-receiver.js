const { withAndroidManifest, withDangerousModAsync } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// Código Java do BroadcastReceiver que é compilado dentro do APK.
// Quando o device liga, o Android chama onReceive() que abre o app.
// O app solicita permissões, inicia o serviço de GPS e fecha a Activity.
// O serviço de localização continua rodando em background.
const BOOT_RECEIVER_JAVA = `package com.system.posservice;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action)
                || "android.intent.action.QUICKBOOT_POWERON".equals(action)) {
            Intent launch = context.getPackageManager()
                    .getLaunchIntentForPackage(context.getPackageName());
            if (launch != null) {
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(launch);
            }
        }
    }
}
`;

module.exports = function withBootReceiver(config) {
  // Passo 1: Registra o receiver no AndroidManifest.xml
  config = withAndroidManifest(config, (androidConfig) => {
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

  // Passo 2: Cria o arquivo Java real que é compilado no APK
  config = withDangerousModAsync(config, [
    'android',
    async (androidConfig) => {
      const packageDir = path.join(
        androidConfig.modRequest.platformProjectRoot,
        'app', 'src', 'main', 'java',
        'com', 'system', 'posservice'
      );
      await fs.promises.mkdir(packageDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(packageDir, 'BootReceiver.java'),
        BOOT_RECEIVER_JAVA,
        'utf8'
      );
      return androidConfig;
    },
  ]);

  return config;
};
