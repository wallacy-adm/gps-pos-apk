"""Reproduz o histórico real (prod_outside_data.py) pelo gatilho v3 e lista TODOS os eventos gerados.
Pontos travados e revisão de ponto desligada: aqui só se mede a regra de saída (os dados são um subconjunto)."""
import sys
import psycopg2
from prod_outside_data import DATA

def run(db="vt3", verbose=True):
    c = psycopg2.connect(dbname=db, user="postgres", host="/var/run/postgresql"); c.autocommit = True
    cu = c.cursor()
    cu.execute("TRUNCATE events, locations, geofences, devices CASCADE")
    out = {}
    for name, (glat, glng, rad, raw) in [(k, (v[0], v[1], 250, v[2])) for k, v in DATA.items()]:
        cu.execute("INSERT INTO devices (serial,name,point_check_at) VALUES (%s,%s,'2100-01-01') RETURNING id", ("S-" + name, name))
        d = cu.fetchone()[0]
        cu.execute("INSERT INTO geofences (device_id,lat,lng,radius_meters,active,locked,must_stay) VALUES (%s,%s,%s,%s,true,true,false)", (d, glat, glng, rad))
        for p in raw.split(";"):
            ts, la, ln, ac = p.split(",")
            cu.execute("UPDATE devices SET last_lat=%s,last_lng=%s,last_seen_at=%s::timestamptz WHERE id=%s", (float(la), float(ln), ts + "+00", d))
            cu.execute("INSERT INTO locations (device_id,lat,lng,accuracy,provider,recorded_at) VALUES (%s,%s,%s,%s,'gps',%s::timestamptz)", (d, float(la), float(ln), float(ac), ts + "+00"))
        cu.execute("SELECT type, to_char(created_at,'MM-DD HH24:MI:SS'), description FROM events WHERE device_id=%s ORDER BY created_at, type", (d,))
        out[name] = cu.fetchall()
    if verbose:
        tot = 0
        for n, ev in out.items():
            lefts = [e for e in ev if e[0] == "left_geofence"]
            tot += len(lefts)
            print("%-18s saídas=%d" % (n, len(lefts)))
            for e in ev:
                print("      ", e[1], e[0], "|", e[2])
        print("TOTAL de alertas 'saiu do ponto':", tot)
    return out

if __name__ == "__main__":
    run(sys.argv[1] if len(sys.argv) > 1 else "vt3")
