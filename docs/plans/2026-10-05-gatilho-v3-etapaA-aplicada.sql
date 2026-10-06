ALTER TABLE devices   ADD COLUMN IF NOT EXISTS anchor_lat      double precision;
ALTER TABLE devices   ADD COLUMN IF NOT EXISTS anchor_lng      double precision;
ALTER TABLE devices   ADD COLUMN IF NOT EXISTS point_check_at  timestamptz;
ALTER TABLE devices   ADD COLUMN IF NOT EXISTS run_n      integer NOT NULL DEFAULT 0;
ALTER TABLE devices   ADD COLUMN IF NOT EXISTS run_lat    double precision;
ALTER TABLE devices   ADD COLUMN IF NOT EXISTS run_lng    double precision;
ALTER TABLE devices   ADD COLUMN IF NOT EXISTS run_start  timestamptz;
ALTER TABLE devices   ADD COLUMN IF NOT EXISTS far_n      integer NOT NULL DEFAULT 0;
ALTER TABLE devices   ADD COLUMN IF NOT EXISTS far_start  timestamptz;
ALTER TABLE devices   ADD COLUMN IF NOT EXISTS any_n      integer NOT NULL DEFAULT 0;
ALTER TABLE devices   ADD COLUMN IF NOT EXISTS any_start  timestamptz;
ALTER TABLE devices   ADD COLUMN IF NOT EXISTS in_n       integer NOT NULL DEFAULT 0;
ALTER TABLE geofences ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false;
ALTER TABLE geofences ADD COLUMN IF NOT EXISTS must_stay boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS geofence_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid REFERENCES devices(id),
  old_lat double precision, old_lng double precision,
  new_lat double precision, new_lng double precision,
  radius_meters integer,
  reason text NOT NULL,
  evidence text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE geofence_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read geofence_history" ON geofence_history;
CREATE POLICY "read geofence_history" ON geofence_history FOR SELECT TO anon, authenticated USING (true);
CREATE OR REPLACE FUNCTION public.geo_dist_m(la1 double precision, lo1 double precision, la2 double precision, lo2 double precision)
RETURNS double precision LANGUAGE sql IMMUTABLE AS $$
  SELECT 2*6371000*asin(sqrt(LEAST(1.0,
    power(sin(radians(la2-la1)/2),2) + cos(radians(la1))*cos(radians(la2))*power(sin(radians(lo2-lo1)/2),2))))
$$;
CREATE OR REPLACE FUNCTION public.in_service_hours(ts timestamptz)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN extract(dow FROM (ts AT TIME ZONE 'America/Fortaleza')) = 0
    THEN (ts AT TIME ZONE 'America/Fortaleza')::time BETWEEN '06:30' AND '13:00'
    ELSE (ts AT TIME ZONE 'America/Fortaleza')::time BETWEEN '06:30' AND '19:00' END
$$;
CREATE OR REPLACE FUNCTION public.find_cluster(dev uuid, from_ts timestamptz, to_ts timestamptz)
RETURNS TABLE(clat double precision, clng double precision, n bigint) LANGUAGE sql STABLE AS $$
  WITH r AS (
    SELECT lat, lng FROM locations
    WHERE device_id = dev AND recorded_at >= from_ts AND recorded_at < to_ts
      AND provider = 'gps' AND accuracy <= 30 AND in_service_hours(recorded_at)),
  cell AS (SELECT round(lat::numeric,3) a, round(lng::numeric,3) b, count(*) c FROM r GROUP BY 1,2 ORDER BY c DESC LIMIT 1),
  seed AS (SELECT avg(r.lat) slat, avg(r.lng) slng FROM r, cell
           WHERE round(r.lat::numeric,3) = cell.a AND round(r.lng::numeric,3) = cell.b)
  SELECT avg(r.lat), avg(r.lng), count(*) FROM r, seed
  WHERE geo_dist_m(seed.slat, seed.slng, r.lat, r.lng) <= 150
$$;
CREATE OR REPLACE FUNCTION public.review_point(dev uuid, as_of timestamptz)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  d devices%ROWTYPE;
  gf geofences%ROWTYPE;
  today date := (as_of AT TIME ZONE 'America/Fortaleza')::date;
  cl RECORD;
  day_i date;
  st RECORD;
  good_days int := 0;
  last_good date;
  cur RECORD;
  old_still int;
BEGIN
  SELECT * INTO d FROM devices WHERE id = dev;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO gf FROM geofences WHERE device_id = dev AND active LIMIT 1;
  IF FOUND AND (gf.locked OR NOT d.outside_geofence) THEN RETURN; END IF;
  SELECT * INTO cl FROM find_cluster(dev, ((today-3)::timestamp AT TIME ZONE 'America/Fortaleza'), as_of);
  IF cl.clat IS NULL THEN RETURN; END IF;
  FOR day_i IN SELECT generate_series(today-3, today, interval '1 day')::date LOOP
    SELECT count(*) FILTER (WHERE x.dist <= 150) AS n_in,
           count(*) AS n_all,
           coalesce(bool_or(x.lt < time '11:00' AND x.dist <= 150), false) AS morning,
           coalesce(bool_or(x.lt >= time '16:00' AND x.dist <= 150), false) AS afternoon
      INTO st
      FROM (SELECT geo_dist_m(cl.clat, cl.clng, l.lat, l.lng) AS dist,
                   (l.recorded_at AT TIME ZONE 'America/Fortaleza')::time AS lt
            FROM locations l
            WHERE l.device_id = dev AND l.provider = 'gps' AND l.accuracy <= 30
              AND l.recorded_at <= as_of AND in_service_hours(l.recorded_at)
              AND (l.recorded_at AT TIME ZONE 'America/Fortaleza')::date = day_i) x;
    IF st.n_all > 0 AND st.n_in >= 20 AND st.n_in >= 0.85 * st.n_all AND st.morning AND st.afternoon THEN
      good_days := good_days + 1;
      last_good := day_i;
    END IF;
  END LOOP;
  IF gf.id IS NULL THEN
    IF good_days >= 2 THEN
      INSERT INTO geofences (device_id, name, lat, lng, radius_meters, active, locked)
        VALUES (dev, d.name, cl.clat, cl.clng, 250, true, false);
      INSERT INTO geofence_history (device_id, new_lat, new_lng, radius_meters, reason, evidence)
        VALUES (dev, cl.clat, cl.clng, 250, 'ponto_criado_automatico', good_days || ' dias completos, ' || cl.n || ' leituras GPS');
      INSERT INTO events (device_id, type, description, lat, lng, created_at)
        VALUES (dev, 'point_created',
          'Ponto de venda definido automaticamente após ' || good_days || ' dias de funcionamento (' || cl.n || ' leituras GPS)',
          cl.clat, cl.clng, as_of);
      UPDATE devices SET anchor_lat = NULL, anchor_lng = NULL, geofence_breach_streak = 0 WHERE id = dev;
    END IF;
    RETURN;
  END IF;
  IF good_days >= 1 AND geo_dist_m(gf.lat, gf.lng, cl.clat, cl.clng) > gf.radius_meters THEN
    SELECT count(*) INTO old_still FROM locations l
      WHERE l.device_id = dev AND l.provider = 'gps' AND l.accuracy <= 30
        AND l.recorded_at >= ((last_good - (good_days - 1))::timestamp AT TIME ZONE 'America/Fortaleza')
        AND l.recorded_at <= as_of
        AND geo_dist_m(gf.lat, gf.lng, l.lat, l.lng) <= gf.radius_meters;
    SELECT l.lat, l.lng INTO cur FROM locations l
      WHERE l.device_id = dev AND l.provider = 'gps' AND l.accuracy <= 30 AND l.recorded_at <= as_of
      ORDER BY l.recorded_at DESC LIMIT 1;
    IF old_still = 0 AND cur.lat IS NOT NULL
       AND geo_dist_m(cl.clat, cl.clng, cur.lat, cur.lng) <= gf.radius_meters THEN
      INSERT INTO geofence_history (device_id, old_lat, old_lng, new_lat, new_lng, radius_meters, reason, evidence)
        VALUES (dev, gf.lat, gf.lng, cl.clat, cl.clng, gf.radius_meters, 'mudou_de_ponto',
                good_days || ' dia(s) completo(s) no novo lugar, ' || cl.n || ' leituras GPS, 0 leituras no ponto antigo');
      INSERT INTO events (device_id, type, description, lat, lng, created_at)
        VALUES (dev, 'moved_point',
          'Mudou de ponto: de (' || round(gf.lat::numeric,5) || ', ' || round(gf.lng::numeric,5) || ') para ('
          || round(cl.clat::numeric,5) || ', ' || round(cl.clng::numeric,5) || ') após '
          || good_days || ' dia(s) de funcionamento completo', cl.clat, cl.clng, as_of);
      UPDATE geofences SET lat = cl.clat, lng = cl.clng, detected_at = as_of WHERE id = gf.id;
      UPDATE devices SET outside_geofence = false, geofence_breach_streak = 0 WHERE id = dev;
    END IF;
  END IF;
END;
$$;
CREATE OR REPLACE FUNCTION public.svc_now()
RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('app.now_override', true), '')::timestamptz, now())
$$;
CREATE OR REPLACE FUNCTION public.eval_location_core(nw locations)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  d devices%ROWTYPE;
  gf geofences%ROWTYPE;
  has_point boolean;
  clat double precision; clng double precision; crad integer; strict_mode boolean := false;
  dist double precision;
  prev_at timestamptz;
  is_dup boolean := false;
  n_run int; n_far int; n_any int; n_in int;
  r_lat double precision; r_lng double precision; r_start timestamptz;
  f_start timestamptz; a_start timestamptz;
  confirm boolean; new_out boolean;
BEGIN
  IF nw.provider IS DISTINCT FROM 'gps' OR nw.accuracy IS NULL OR nw.accuracy > 30 THEN RETURN; END IF;
  IF nw.recorded_at > svc_now() + interval '10 minutes' THEN RETURN; END IF;
  SELECT * INTO d FROM devices WHERE id = nw.device_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM locations WHERE device_id = nw.device_id AND recorded_at > nw.recorded_at
             AND recorded_at <= svc_now() + interval '10 minutes'
             AND provider = 'gps' AND accuracy <= 30) THEN RETURN; END IF;
  SELECT recorded_at INTO prev_at FROM locations
    WHERE device_id = nw.device_id AND recorded_at < nw.recorded_at AND provider = 'gps' AND accuracy <= 30
    ORDER BY recorded_at DESC LIMIT 1;
  IF prev_at IS NOT NULL AND nw.recorded_at - prev_at < interval '20 seconds' THEN is_dup := true; END IF;
  SELECT * INTO gf FROM geofences WHERE device_id = nw.device_id AND active LIMIT 1;
  has_point := FOUND;
  IF has_point THEN
    clat := gf.lat; clng := gf.lng; crad := gf.radius_meters; strict_mode := gf.must_stay;
  ELSE
    IF d.anchor_lat IS NULL THEN
      UPDATE devices SET anchor_lat = nw.lat, anchor_lng = nw.lng WHERE id = d.id;
      PERFORM review_throttled(d, nw.recorded_at);
      RETURN;
    END IF;
    clat := d.anchor_lat; clng := d.anchor_lng; crad := 250;
  END IF;
  dist := geo_dist_m(clat, clng, nw.lat, nw.lng);
  n_run := d.run_n; r_lat := d.run_lat; r_lng := d.run_lng; r_start := d.run_start;
  n_far := d.far_n; f_start := d.far_start; n_any := d.any_n; a_start := d.any_start; n_in := d.in_n;
  new_out := d.outside_geofence;
  IF dist > crad THEN
    n_in := 0;
    IF NOT is_dup THEN
      IF n_run = 0 OR r_lat IS NULL OR geo_dist_m(r_lat, r_lng, nw.lat, nw.lng) > 150 THEN
        n_run := 1; r_lat := nw.lat; r_lng := nw.lng; r_start := nw.recorded_at;
      ELSE
        r_lat := (r_lat * n_run + nw.lat) / (n_run + 1); r_lng := (r_lng * n_run + nw.lng) / (n_run + 1); n_run := n_run + 1;
      END IF;
      IF dist > crad * 2 THEN
        n_far := n_far + 1; f_start := coalesce(f_start, nw.recorded_at);
      ELSE
        n_far := 0; f_start := NULL;
      END IF;
      n_any := n_any + 1; a_start := coalesce(a_start, nw.recorded_at);
    END IF;
    confirm := NOT d.outside_geofence AND NOT is_dup AND (
         (n_run >= 3 AND nw.recorded_at - r_start >= interval '3 minutes')
      OR (n_run >= 2 AND nw.recorded_at - r_start >= interval '30 minutes')
      OR (n_far >= 4 AND nw.recorded_at - f_start >= interval '3 minutes')
      OR (strict_mode AND n_any >= 3 AND nw.recorded_at - a_start >= interval '3 minutes')
      OR (nw.accuracy <= 3 AND dist > crad * 2));
    IF confirm THEN
      IF has_point THEN
        new_out := true;
        INSERT INTO events (device_id, type, description, lat, lng, created_at)
        VALUES (nw.device_id, 'left_geofence',
          'Saiu do ponto (' || round(dist::numeric) || 'm, GPS ' || round(nw.accuracy::numeric) || 'm de precisão)',
          nw.lat, nw.lng, nw.recorded_at);
      ELSE
        INSERT INTO events (device_id, type, description, lat, lng, created_at)
        VALUES (nw.device_id, 'moved_without_point',
          'Terminal sem ponto cadastrado se deslocou ' || round(dist::numeric) || 'm (GPS ' || round(nw.accuracy::numeric) || 'm de precisão)',
          nw.lat, nw.lng, nw.recorded_at);
        UPDATE devices SET anchor_lat = nw.lat, anchor_lng = nw.lng WHERE id = d.id;
        n_run := 0; r_lat := NULL; r_lng := NULL; r_start := NULL; n_far := 0; f_start := NULL; n_any := 0; a_start := NULL;
      END IF;
    END IF;
  ELSE
    n_run := 0; r_lat := NULL; r_lng := NULL; r_start := NULL; n_far := 0; f_start := NULL; n_any := 0; a_start := NULL;
    IF d.outside_geofence AND has_point THEN
      IF NOT is_dup THEN n_in := n_in + 1; END IF;
      IF n_in >= 2 THEN
        new_out := false; n_in := 0;
        INSERT INTO events (device_id, type, description, lat, lng, created_at)
        VALUES (nw.device_id, 'entered_geofence', 'Voltou pro ponto (' || round(dist::numeric) || 'm)', nw.lat, nw.lng, nw.recorded_at);
      END IF;
    ELSE
      n_in := 0;
    END IF;
  END IF;
  IF (n_run, n_far, n_any, n_in, new_out) IS DISTINCT FROM (d.run_n, d.far_n, d.any_n, d.in_n, d.outside_geofence)
     OR r_lat IS DISTINCT FROM d.run_lat OR r_lng IS DISTINCT FROM d.run_lng OR f_start IS DISTINCT FROM d.far_start OR a_start IS DISTINCT FROM d.any_start
     OR r_start IS DISTINCT FROM d.run_start THEN
    UPDATE devices SET run_n = n_run, run_lat = r_lat, run_lng = r_lng, run_start = r_start,
                       far_n = n_far, far_start = f_start, any_n = n_any, any_start = a_start,
                       in_n = n_in, outside_geofence = new_out, geofence_breach_streak = n_run
    WHERE id = d.id;
  END IF;
  PERFORM review_throttled(d, nw.recorded_at);
END;
$$;
CREATE OR REPLACE FUNCTION public.review_throttled(d devices, at_ts timestamptz)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF d.point_check_at IS NULL OR d.point_check_at < at_ts - interval '1 hour' THEN
    UPDATE devices SET point_check_at = at_ts WHERE id = d.id;
    PERFORM review_point(d.id, at_ts);
  END IF;
END;
$$;
CREATE OR REPLACE FUNCTION public.eval_location_v3()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    PERFORM set_config('lock_timeout', '3s', true);
    PERFORM eval_location_core(NEW);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'eval_location_v3 falhou (leitura gravada mesmo assim): % %', SQLSTATE, SQLERRM;
  END;
  RETURN NEW;
END;
$$;
