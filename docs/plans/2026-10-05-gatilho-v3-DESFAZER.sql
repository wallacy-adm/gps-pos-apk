-- DESFAZER o gatilho v3 (voltar ao gatilho antigo de produção). Rodar no banco do projeto a82cd32f (Lovable Cloud).
-- A função antiga check_geofence_on_location_update() NUNCA foi apagada; só o gatilho foi trocado.
-- As colunas/funções/tabela novas ficam no banco (inertes) e não atrapalham.
DROP TRIGGER IF EXISTS trg_eval_location_v3 ON public.locations;
DROP TRIGGER IF EXISTS trg_check_geofence ON public.devices;
CREATE TRIGGER trg_check_geofence BEFORE UPDATE OF last_lat, last_lng ON public.devices
  FOR EACH ROW EXECUTE FUNCTION check_geofence_on_location_update();
