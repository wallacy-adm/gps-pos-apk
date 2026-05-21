// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// ─────────────────────────────────────────────────────────────────────────────
// PROBLEMA RAIZ:
// @supabase/realtime-js tem seu PRÓPRIO ws em:
//   node_modules/@supabase/realtime-js/node_modules/ws/
//
// `extraNodeModules` só funciona para módulos não encontrados em node_modules.
// Não sobrescreve pacotes aninhados — por isso o shim anterior foi ignorado.
//
// SOLUÇÃO: `resolveRequest` tem prioridade máxima e intercepta QUALQUER
// require('ws'), independente de onde o código está sendo executado.
// ─────────────────────────────────────────────────────────────────────────────

config.resolver = config.resolver || {};

// 1) Força Babel a transformar pacotes supabase (sintaxe ES moderna)
config.resolver.transformIgnorePatterns = [
  'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@supabase/.*|ws)',
];

// 2) resolveRequest: intercepta TODOS os require('ws') — inclusive de
//    node_modules aninhados como @supabase/realtime-js/node_modules/ws
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'ws') {
    // Redireciona ws → WebSocket nativo do React Native
    // Evita que ws/lib/permessage-deflate.js, ws/lib/stream.js, etc.
    // sejam carregados com seus require de built-ins do Node.
    return {
      filePath: path.resolve(__dirname, 'shims', 'ws.js'),
      type: 'sourceFile',
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

// 3) extraNodeModules: rede de segurança para outros built-ins do Node
config.resolver.extraNodeModules = {
  stream: require.resolve('readable-stream'),
};

module.exports = config;
