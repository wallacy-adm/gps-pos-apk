// Credenciais hardcoded — obrigatório para EAS Build funcionar.
// EAS não lê .env local; sem isso SUPABASE_URL fica undefined no bundle.
export const SUPABASE_URL      = 'https://pbzoggfmegmawbnmblpm.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBiem9nZ2ZtZWdtYXdibm1ibHBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzMDYzOTksImV4cCI6MjA5NDg4MjM5OX0.OpRY-AH7vHsQYHzi39QpqiYL_uNxWOZFE_pYvOSo3Ic';
export const GPS_INTERVAL_MS   = 30_000; // 30 segundos
