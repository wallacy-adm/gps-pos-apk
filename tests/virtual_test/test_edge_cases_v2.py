"""
B4/B5: atalho de 1 leitura precisa, testado no gatilho v2 de verdade
(schema_proposta.sql), com distancia real confirmada via SQL antes de montar
cada caso (evita erro de aproximacao de conversao metro->grau).
"""
import psycopg2, datetime as dt

HOME_LAT, HOME_LNG = -7.30000, -35.90000
RADIUS = 250

def connect():
    c = psycopg2.connect(dbname="vt", user="postgres", host="/var/run/postgresql")
    c.autocommit = True
    return c

def dist_sql(lat, lng):
    conn = connect(); cur = conn.cursor()
    cur.execute("""SELECT 6371000*acos(LEAST(1,GREATEST(-1,
        cos(radians(%s))*cos(radians(%s))*cos(radians(%s)-radians(%s))
        + sin(radians(%s))*sin(radians(%s)))))""",
        (HOME_LAT, lat, lng, HOME_LNG, HOME_LAT, lat))
    d = cur.fetchone()[0]; conn.close(); return d

def lat_at(target_m):
    lat = HOME_LAT + target_m / 111320.0
    for _ in range(5):
        d = dist_sql(lat, HOME_LNG)
        lat += (target_m - d) / 111320.0
    return lat

def setup():
    conn = connect(); cur = conn.cursor()
    cur.execute("TRUNCATE events, locations, geofences, devices CASCADE")
    cur.execute("INSERT INTO devices (serial,last_lat,last_lng,last_seen_at,status) VALUES ('EDGE3',%s,%s,now(),'online') RETURNING id",
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

BASE = dt.datetime(2026, 9, 26, 12, 0, 0, tzinfo=dt.timezone.utc)
print("=== TESTE B4/B5: atalho de 1 leitura (distancia real confirmada via SQL) ===\n")

lat_510 = lat_at(510); lat_490 = lat_at(490); lat_600 = lat_at(600)

dev = setup()
r1 = report(dev, lat_510, HOME_LNG, 15.0, 0, BASE)
assert r1 == (True, 1), f"FALHOU: {r1}"
print("B4a: ~510m, acc=15.0m -> disparou com 1 leitura so. PASSOU")

dev = setup()
r2 = report(dev, lat_490, HOME_LNG, 15.0, 0, BASE)
assert r2 == (False, 1), f"FALHOU: {r2}"
print("B4b: ~490m (nao passou 2x raio), acc=15.0m -> nao disparou sozinho. PASSOU")

dev = setup()
r3 = report(dev, lat_600, HOME_LNG, 15.1, 0, BASE)
assert r3 == (False, 1), f"FALHOU: {r3}"
print("B4c: ~600m, acc=15.1m (0.1 acima do limite) -> nao disparou sozinho. PASSOU")

dev = setup()
conn = connect(); cur = conn.cursor()
ts = BASE.isoformat()
cur.execute("INSERT INTO locations (device_id,lat,lng,accuracy,provider,recorded_at) VALUES (%s,%s,%s,%s,'network',%s)",
            (dev, lat_at(3000), HOME_LNG, 5.0, ts))
cur.execute("UPDATE devices SET last_seen_at=%s, last_lat=%s, last_lng=%s WHERE id=%s", (ts, lat_at(3000), HOME_LNG, dev))
cur.execute("SELECT outside_geofence, geofence_breach_streak FROM devices WHERE id=%s", (dev,))
r5 = cur.fetchone(); conn.close()
assert r5 == (False, 0), f"FALHOU: {r5}"
print("B5: leitura de REDE, 3km, 'precisao' 5m -> nunca ativa o atalho. PASSOU")

print("\nTODOS OS CASOS DO ATALHO PASSARAM, DISTANCIA REAL CONFIRMADA.")
