// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// ─────────────────────────────────────────────────────────────────────────────
// PROBLEMA: @supabase/realtime-js usa o pacote `ws` (WebSocket para Node.js).
// `ws` importa módulos built-in do Node (stream, net, tls, http...) que não
// existem no Metro/React Native.
//
// SOLUÇÃO: redirecionar `ws` para um shim que usa o WebSocket nativo do RN.
// @supabase/realtime-js verifica `globalThis.WebSocket` antes de usar ws —
// o shim garante que o Metro não empacote os built-ins do Node.
// ─────────────────────────────────────────────────────────────────────────────

config.resolver = config.resolver || {};

// 1) Força Babel a transformar pacotes supabase (sintaxe moderna ES)
config.resolver.transformIgnorePatterns = [
  'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@supabase/.*|ws)',
];

// 2) Redireciona módulos problemáticos para versões compatíveis com RN
config.resolver.extraNodeModules = {
  // ws → WebSocket nativo do React Native (elimina todos os built-ins do Node)
  ws: path.resolve(__dirname, 'shims/ws.js'),
  // stream → polyfill browser-compatible (segurança extra)
  stream: require.resolve('readable-stream'),
};

module.exports = config;
