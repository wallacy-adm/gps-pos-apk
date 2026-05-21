import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config';

/**
 * Cliente Supabase configurado para React Native.
 *
 * - storage: AsyncStorage (substitui localStorage que não existe em RN)
 * - detectSessionInUri: false (não usa URLs de autenticação OAuth)
 * - autoRefreshToken: true (renova token automaticamente em background)
 *
 * O APK só envia dados (INSERT/UPSERT) — não usa realtime subscriptions.
 * O ws shim em metro.config.js garante que o bundler não quebre com
 * módulos Node.js built-in que o pacote ws tenta importar.
 */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUri: false,
  },
});
