"""
B1-B3: oscilacao, fronteira do raio, precisao mediana isolada. Roda contra o
gatilho REAL (schema_real.sql) -- valida o comportamento base antes de somar
o atalho novo (ver test_edge_cases_v2.py).
"""
import psycopg2, datetime as dt

HOME_LAT, HOME_LNG = -7.30000, -35.90000
RADIUS = 250

def connect():
    c = psycopg2.connect(dbname="vt", user="postgres", host="/var/run/postgresql")
    c.autocommit = True
    return c

def setup():
    conn = connect(); cur = conn.cursor()
    cur.execute("TRUNCATE events, locations, geofences, devices CASCADE")
    cur.execute("INSERT INTO devices (serial,last_lat,last_lng,last_seen_at,status) VALUES ('EDGE1',%s,%s,now(),'online') RETURNING id",
                (HOME_LAT, HOME_LNG))
    dev_id = cur.fetchone()[0]
    cur.execute("INSERT INTO geofences (device_id,lat,lng,radius_meters,active) VALUES (%s,%s,%s,%s,true)",
                (dev_id, HOME_LAT, HOME_LNG, RADIUS))
    conn.close(); return dev_id

def report(dev_id, lat, lng, acc, offset_s, base):
    ts = (base + dt.timedelta(seconds=offset_s)).isoformat()
    conn = connect(); cur = conn.cursor()
    cur.execute("INSERT INTO locations (device_id,lat,lng,accuracy,provider,recorded_at) VALUES (%s,%s,%s,%s,'gps',%s)",
                (dev_id, lat, lng, acc, ts))
    cur.execute("UPDATE devices SET last_seen_at=%s, last_lat=%s, last_lng=%s WHERE id=%s", (ts, lat, lng, dev_id))
    cur.execute("SELECT outside_geofence, geofence_breach_streak FROM devices WHERE id=%s", (dev_id,))
    r = cur.fetchone(); conn.close(); return r

def lat_at(dist_m):
    return HOME_LAT + dist_m / 111320.0

BASE = dt.datetime(2026, 9, 26, 12, 0, 0, tzinfo=dt.timezone.utc)
print("=== TESTE B1-B3: casos de borda base (gatilho REAL) ===\n")

dev = setup()
seq = [(lat_at(300), 20), (lat_at(300), 20), (HOME_LAT, 20), (lat_at(300), 20)]
results = [report(dev, lat, HOME_LNG, acc, i * 30, BASE) for i, (lat, acc) in enumerate(seq)]
assert results[1] == (True, 2), f"B1 FALHOU: {results[1]}"
assert results[2] == (False, 0), f"B1 FALHOU: {results[2]}"
assert results[3] == (False, 1), f"B1 FALHOU: {results[3]}"
print("B1 -- oscilacao fora/dentro/fora: streak reseta sem vazar entre episodios. PASSOU")

dev = setup()
r1 = report(dev, lat_at(250.4), HOME_LNG, 15.0, 0, BASE)
r2 = report(dev, lat_at(249.5), HOME_LNG, 10.0, 30, BASE)
assert r2[1] == 0, f"B2 FALHOU: {r2}"
print("B2 -- fronteira exata do raio (250m): corte tratado certo. PASSOU")

dev = setup()
r = report(dev, lat_at(3000), HOME_LNG, 18.0, 0, BASE)
assert r == (False, 1), f"B3 FALHOU: {r}"
print("B3 -- 1 leitura a 3km, precisao 18m (regra base exige 2 confirmacoes): PASSOU")

print("\nTODOS OS CASOS BASE (B1-B3) PASSARAM.")
