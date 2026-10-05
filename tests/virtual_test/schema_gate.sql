DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$; DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Trava de escrita da produção (copiada verbatim de pg_get_functiondef em 04/10/2026)
CREATE TABLE IF NOT EXISTS system_control (key text PRIMARY KEY, value boolean NOT NULL);
INSERT INTO system_control VALUES ('fleet_writes_allowed', true) ON CONFLICT (key) DO UPDATE SET value = true;
CREATE OR REPLACE FUNCTION public.check_fleet_writes_allowed()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if not (select value from public.system_control where key = 'fleet_writes_allowed') then
    raise exception 'fleet_writes_disabled: escrita bloqueada ate a frota estar validada';
  end if;
  return new;
end;
$function$;
DROP TRIGGER IF EXISTS gate_devices_write ON devices;
DROP TRIGGER IF EXISTS gate_locations_write ON locations;
CREATE TRIGGER gate_devices_write BEFORE INSERT OR UPDATE ON public.devices FOR EACH ROW EXECUTE FUNCTION check_fleet_writes_allowed();
CREATE TRIGGER gate_locations_write BEFORE INSERT OR UPDATE ON public.locations FOR EACH ROW EXECUTE FUNCTION check_fleet_writes_allowed();
