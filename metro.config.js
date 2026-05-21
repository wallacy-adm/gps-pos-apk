// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Força transformação de pacotes com sintaxe moderna (supabase, etc.)
const defaultTransformIgnorePatterns = config.resolver?.transformIgnorePatterns?.[0] ||
  'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)';

config.resolver = config.resolver || {};
config.resolver.transformIgnorePatterns = [
  // Exclui supabase e ws do ignore → força transformação Babel deles
  'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@supabase/.*|ws)',
];

module.exports = config;
