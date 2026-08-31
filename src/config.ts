// Credenciais hardcoded — obrigatório para EAS Build funcionar.
// EAS não lê .env local; sem isso SUPABASE_URL fica undefined no bundle.
export const SUPABASE_URL      = 'https://kyxowmjriiqzjacwltja.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_exjFNbQhdCW6RDBBZKyqHg_Un3HiFhr';
export const GPS_INTERVAL_MS   = 30_000; // 30 segundos
