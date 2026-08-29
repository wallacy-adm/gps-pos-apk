-- =====================================================================
-- INTERRUPTOR CENTRAL DE ESCRITA — GPS POS Tracker
-- Bloqueia TODA escrita em devices/locations, de qualquer versao de app,
-- ate ser explicitamente ligado. Nao depende de app_version (confirmado
-- inconsistente entre versoes/caminhos de codigo).
--
-- COMO USAR:
-- 1) Rodar o bloco "SETUP" uma vez, assim que o Supabase voltar a responder.
-- 2) Confirmar que esta BLOQUEANDO (teste no bloco "VERIFICACAO").
-- 3) So depois que TODOS os terminais criticos estiverem no v2.0.20 e
--    confirmados, rodar o bloco "LIGAR". Ate la, fica desligado.
-- =====================================================================

-- ===== SETUP (rodar uma vez, assim que o banco responder) =====
CREATE TABLE IF NOT EXISTS system_control (
  key   text PRIMARY KEY,
  value boolean NOT NULL
);

INSERT INTO system_control (key, value)
VALUES ('fleet_writes_allowed', false)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION check_fleet_writes_allowed()
RETURNS trigger AS $$
BEGIN
  IF NOT (SELECT value FROM system_control WHERE key = 'fleet_writes_allowed') THEN
    RAISE EXCEPTION 'fleet_writes_disabled: escrita bloqueada manualmente ate a frota estar validada';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS gate_devices_write ON devices;
CREATE TRIGGER gate_devices_write
  BEFORE INSERT OR UPDATE ON devices
  FOR EACH ROW EXECUTE FUNCTION check_fleet_writes_allowed();

DROP TRIGGER IF EXISTS gate_locations_write ON locations;
CREATE TRIGGER gate_locations_write
  BEFORE INSERT OR UPDATE ON locations
  FOR EACH ROW EXECUTE FUNCTION check_fleet_writes_allowed();

-- ===== VERIFICACAO (confirma que esta bloqueando de verdade) =====
-- Deve dar ERRO "fleet_writes_disabled" — se der erro, o gate funciona.
-- UPDATE devices SET updated_at = now() WHERE device_name = 'teste_nao_existe';

-- ===== LIGAR (so depois da frota validada) =====
-- UPDATE system_control SET value = true WHERE key = 'fleet_writes_allowed';

-- ===== DESLIGAR DE NOVO, se precisar =====
-- UPDATE system_control SET value = false WHERE key = 'fleet_writes_allowed';
