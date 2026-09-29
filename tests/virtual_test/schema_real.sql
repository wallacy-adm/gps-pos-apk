-- Esquema espelhando o banco real (kyxowmjriiqzjacwltja) + gatilho copiado
-- VERBATIM de pg_get_functiondef/pg_get_triggerdef em 26/09/2026.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  serial text NOT NULL UNIQUE,
  status text,
  last_seen_at timestamptz,
  last_lat double precision,
  last_lng double precision,
  imei text,
  app_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  name text,
  outside_geofence boolean NOT NULL DEFAULT false,
  geofence_breach_streak integer NOT NULL DEFAULT 0
);

CREATE TABLE locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid REFERENCES devices(id),
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  accuracy double precision,
  provider text,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE geofences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid REFERENCES devices(id),
  name text,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  radius_meters integer NOT NULL DEFAULT 200,
  detected_at timestamptz NOT NULL DEFAULT now(),
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid REFERENCES devices(id),
  type text NOT NULL,
  description text,
  lat double precision,
  lng double precision,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ===== FUNÇÃO COPIADA VERBATIM DO BANCO REAL (pg_get_functiondef, 26/09) =====
CREATE OR REPLACE FUNCTION public.check_geofence_on_location_update()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  gf RECORD;
  fix RECORD;
  dist_m double precision;
BEGIN
  IF NEW.last_lat IS NULL OR NEW.last_lng IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO gf FROM geofences WHERE device_id = NEW.id AND active = true LIMIT 1;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT accuracy, provider INTO fix FROM locations
  WHERE device_id = NEW.id
    AND abs(lat - NEW.last_lat) < 0.00005
    AND abs(lng - NEW.last_lng) < 0.00005
    AND recorded_at > COALESCE(NEW.last_seen_at, now()) - interval '10 seconds'
  ORDER BY recorded_at DESC LIMIT 1;

  IF NOT FOUND OR fix.provider IS DISTINCT FROM 'gps' THEN
    RETURN NEW;
  END IF;

  dist_m := 6371000 * acos(
    LEAST(1.0, GREATEST(-1.0,
      cos(radians(gf.lat)) * cos(radians(NEW.last_lat)) * cos(radians(NEW.last_lng) - radians(gf.lng))
      + sin(radians(gf.lat)) * sin(radians(NEW.last_lat))
    ))
  );

  IF dist_m > gf.radius_meters THEN
    NEW.geofence_breach_streak := NEW.geofence_breach_streak + 1;
    IF NEW.geofence_breach_streak >= 2 AND NEW.outside_geofence = false THEN
      NEW.outside_geofence := true;
      INSERT INTO events (device_id, type, description, lat, lng)
      VALUES (NEW.id, 'left_geofence',
        'Saiu do ponto de instalação (' || round(dist_m::numeric) || 'm de distância, GPS confirmado 2x)',
        NEW.last_lat, NEW.last_lng);
    END IF;
  ELSE
    NEW.geofence_breach_streak := 0;
    IF NEW.outside_geofence = true THEN
      NEW.outside_geofence := false;
      INSERT INTO events (device_id, type, description, lat, lng)
      VALUES (NEW.id, 'entered_geofence',
        'Voltou pro ponto de instalação (' || round(dist_m::numeric) || 'm de distância)',
        NEW.last_lat, NEW.last_lng);
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ===== TRIGGER COPIADO VERBATIM (pg_get_triggerdef) =====
CREATE TRIGGER trg_check_geofence BEFORE UPDATE OF last_lat, last_lng ON public.devices FOR EACH ROW EXECUTE FUNCTION check_geofence_on_location_update();
