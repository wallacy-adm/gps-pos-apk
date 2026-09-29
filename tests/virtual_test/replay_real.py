"""
Replay de dados REAIS (real_data.py) através do gatilho REAL do banco
(schema_real.sql, copiado verbatim), num Postgres local.

Requer: postgres local com banco 'vt' criado a partir de schema_real.sql, e
psycopg2-binary instalado. Ex.:
  createdb vt && psql -d vt -f schema_real.sql && pip install psycopg2-binary
  python3 replay_real.py

Modelos de ordem de escrita comparados:
  APP_ATUAL   = heartbeat (UPDATE devices) -> depois INSERT locations
                (exatamente o que sendToSupabase() faz hoje, confirmado lendo
                 o código-fonte de novo nesta sessão)
  LOCATION_1o = INSERT locations -> depois UPDATE devices (o que a fila única
                proposta pra v2.0.26 garante naturalmente)
"""
import psycopg2
from real_data import GRACIANE_INCIDENT, NOME_INCIDENT, BIA_SAMPLE

GEOFENCES = {
    "Graciane": ("354015110328093", -7.20579667, -35.885455, 250),
    "Nome":     ("862595062725748", -7.25630333, -35.89676833, 250),
    "Bia":      ("861536050094847", -7.22301667, -35.873175, 250),
}

LOOKUP_SQL = """
SELECT provider FROM locations
WHERE device_id = %s
  AND abs(lat - %s) < 0.00005 AND abs(lng - %s) < 0.00005
  AND recorded_at > %s::timestamptz - interval '10 seconds'
ORDER BY recorded_at DESC LIMIT 1
"""

UPSERT_SQL = """
INSERT INTO devices (serial,status,last_seen_at,last_lat,last_lng,imei,app_version)
VALUES (%s,'online',%s,%s,%s,%s,'2.0.25')
ON CONFLICT (serial) DO UPDATE SET status=EXCLUDED.status,
  last_seen_at=EXCLUDED.last_seen_at,last_lat=EXCLUDED.last_lat,
  last_lng=EXCLUDED.last_lng,imei=EXCLUDED.imei,app_version=EXCLUDED.app_version
RETURNING id
"""


def connect():
    return psycopg2.connect(dbname="vt", user="postgres", host="/var/run/postgresql")


def fresh(cur, who):
    serial, glat, glng, rad = GEOFENCES[who]
    cur.execute("TRUNCATE events, locations, geofences, devices CASCADE")
    cur.execute("INSERT INTO devices (serial,last_lat,last_lng,last_seen_at,status) VALUES (%s,%s,%s,now(),'online') RETURNING id",
                (serial, glat, glng))
    dev_id = cur.fetchone()[0]
    cur.execute("INSERT INTO geofences (device_id,lat,lng,radius_meters,active) VALUES (%s,%s,%s,%s,true)",
                (dev_id, glat, glng, rad))
    return serial, dev_id


def replay(who, readings, order):
    conn = connect(); conn.autocommit = True
    cur = conn.cursor()
    serial, dev_id = fresh(cur, who)
    lookups_ok = 0
    considered = 0
    for provider, acc, lat, lng, ts in readings:
        cur.execute(LOOKUP_SQL, (dev_id, lat, lng, ts))
        row = cur.fetchone()
        if order == "APP_ATUAL":
            cur.execute(UPSERT_SQL, (serial, ts, lat, lng, "000"))
            cur.execute("INSERT INTO locations (device_id,lat,lng,accuracy,provider,recorded_at) VALUES (%s,%s,%s,%s,%s,%s)",
                        (dev_id, lat, lng, acc, provider, ts))
        else:  # LOCATION_1o
            cur.execute("INSERT INTO locations (device_id,lat,lng,accuracy,provider,recorded_at) VALUES (%s,%s,%s,%s,%s,%s)",
                        (dev_id, lat, lng, acc, provider, ts))
            cur.execute(LOOKUP_SQL, (dev_id, lat, lng, ts))
            row = cur.fetchone()
            cur.execute(UPSERT_SQL, (serial, ts, lat, lng, "000"))
        considered += 1
        if row is not None:
            lookups_ok += 1
    cur.execute("SELECT type, description FROM events ORDER BY created_at")
    events = cur.fetchall()
    cur.execute("SELECT outside_geofence, geofence_breach_streak FROM devices WHERE id=%s", (dev_id,))
    outside, streak = cur.fetchone()
    conn.close()
    return dict(who=who, order=order, leituras=considered, lookup_achou_linha=lookups_ok,
                eventos=events, outside_geofence=outside, streak=streak)


def show(r):
    print(f"  [{r['order']:11}] {r['who']:9} leituras={r['leituras']:3}  "
          f"lookup_achou={r['lookup_achou_linha']:3}  eventos={len(r['eventos'])}  "
          f"outside={r['outside_geofence']}  streak_final={r['streak']}")
    for t, d in r["eventos"]:
        print(f"        -> {t}: {d}")


if __name__ == "__main__":
    casos = [("Graciane", GRACIANE_INCIDENT), ("Nome", NOME_INCIDENT), ("Bia", BIA_SAMPLE)]
    print("=== Gatilho REAL, dados REAIS ===")
    for order in ("APP_ATUAL", "LOCATION_1o"):
        for who, data in casos:
            show(replay(who, data, order))
        print()
