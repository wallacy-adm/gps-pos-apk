-- Gatilho PROPOSTO pra v2.0.26: mesma base do real (schema_real.sql), mais o
-- atalho de 1 leitura muito precisa (<=15m) a mais de 2x o raio. Roda depois
-- de schema_real.sql (reaproveita as tabelas).
CREATE OR REPLACE FUNCTION public.check_geofence_on_location_update_v2()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  gf RECORD;
  fix RECORD;
  dist_m double precision;
BEGIN
  IF NEW.last_lat IS NULL OR NEW.last_lng IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO gf FROM geofences WHERE device_id = NEW.id AND active = true LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT accuracy, provider INTO fix FROM locations
  WHERE device_id = NEW.id
    AND abs(lat - NEW.last_lat) < 0.00005 AND abs(lng - NEW.last_lng) < 0.00005
    AND recorded_at > COALESCE(NEW.last_seen_at, now()) - interval '10 seconds'
  ORDER BY recorded_at DESC LIMIT 1;

  IF fix.provider IS DISTINCT FROM 'gps' THEN RETURN NEW; END IF;
  IF NOT FOUND THEN RETURN NEW; END IF;

  dist_m := 6371000 * acos(LEAST(1.0, GREATEST(-1.0,
    cos(radians(gf.lat))*cos(radians(NEW.last_lat))*cos(radians(NEW.last_lng)-radians(gf.lng))
    + sin(radians(gf.lat))*sin(radians(NEW.last_lat)))));

  IF dist_m > gf.radius_meters THEN
    NEW.geofence_breach_streak := NEW.geofence_breach_streak + 1;
    IF NOT NEW.outside_geofence AND (
         NEW.geofence_breach_streak >= 2
         OR (fix.accuracy <= 15 AND dist_m > gf.radius_meters * 2)
       ) THEN
      NEW.outside_geofence := true;
      INSERT INTO events (device_id, type, description, lat, lng)
      VALUES (NEW.id, 'left_geofence',
        'Saiu do ponto (' || round(dist_m::numeric) || 'm, acc=' || fix.accuracy || 'm, streak=' || NEW.geofence_breach_streak || ')',
        NEW.last_lat, NEW.last_lng);
    END IF;
  ELSE
    NEW.geofence_breach_streak := 0;
    IF NEW.outside_geofence THEN
      NEW.outside_geofence := false;
      INSERT INTO events (device_id, type, description, lat, lng)
      VALUES (NEW.id, 'entered_geofence', 'Voltou (' || round(dist_m::numeric) || 'm)', NEW.last_lat, NEW.last_lng);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_check_geofence ON devices;
CREATE TRIGGER trg_check_geofence BEFORE UPDATE OF last_lat, last_lng ON public.devices
  FOR EACH ROW EXECUTE FUNCTION check_geofence_on_location_update_v2();
