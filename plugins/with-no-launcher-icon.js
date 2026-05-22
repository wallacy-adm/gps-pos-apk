/**
 * Remove a categoria LAUNCHER da activity principal.
 * Resultado: o app não aparece na gaveta de apps nem na tela inicial.
 * O serviço continua iniciando via boot receiver.
 * O app ainda pode ser encontrado em Configurações > Aplicativos.
 */
const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withNoLauncherIcon(config) {
  return withAndroidManifest(config, (androidConfig) => {
    const manifest = androidConfig.modResults.manifest;
    const app = manifest.application?.[0];
    if (!app?.activity) return androidConfig;

    for (const activity of app.activity) {
      if (!activity['intent-filter']) continue;

      // Remove qualquer intent-filter que contenha a categoria LAUNCHER
      activity['intent-filter'] = activity['intent-filter'].filter((filter) => {
        const categories = (filter.category ?? []).map(
          (c) => c?.$?.['android:name'] ?? ''
        );
        return !categories.includes('android.intent.category.LAUNCHER');
      });
    }

    return androidConfig;
  });
};
