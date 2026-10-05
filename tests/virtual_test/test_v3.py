"""
Teste virtual do servidor v3 (schema_v3.sql) com dados reais de 03/10/2026 +
cenários adversos. Rodar:
  su postgres -c "createdb vt"  && psql -U postgres -d vt  -f schema_real.sql                  # gatilho ANTIGO (produção hoje)
  su postgres -c "createdb vt3" && psql -U postgres -d vt3 -f schema_real.sql -f schema_v3.sql  # gatilho NOVO
  python3 test_v3.py
Ordem de gravação = a do app real (heartbeat UPDATE devices, depois INSERT locations).
"""
import math, random, sys, time
import psycopg2
from real_data import GRACIANE_INCIDENT, NOME_INCIDENT, BIA_SAMPLE
from real_data_v3 import (VANESSA, VANESSA_POINT, EMILLY_MORNING, EMILLY_POINT, KAMILLA_SEGMENTS)

M_PER_DEG_LAT = 2 * math.pi * 6371000 / 360.0
RESULTS = []


def connect(db):
    c = psycopg2.connect(dbname=db, user="postgres", host="/var/run/postgresql")
    c.autocommit = True
    return c


def check(name, cond, detail=""):
    RESULTS.append((name, bool(cond), detail))
    print(("PASS " if cond else "FAIL ") + name + ("  -> " + detail if detail else ""))


class Env:
    def __init__(self, db):
        self.db = db
        self.conn = connect(db)
        self.cur = self.conn.cursor()

    def reset(self):
        self.cur.execute("TRUNCATE events, locations, geofences, devices CASCADE")
        try:
            self.cur.execute("TRUNCATE geofence_history")
        except Exception:
            pass

    def device(self, name="T", serial=None):
        serial = serial or ("S-" + name + "-" + str(random.randint(0, 10**9)))
        self.cur.execute("INSERT INTO devices (serial,name,status) VALUES (%s,%s,'online') RETURNING id", (serial, name))
        return self.cur.fetchone()[0]

    def point(self, dev, lat, lng, r=250, locked=False, must_stay=False):
        try:
            self.cur.execute("INSERT INTO geofences (device_id,lat,lng,radius_meters,active,locked,must_stay) VALUES (%s,%s,%s,%s,true,%s,%s)",
                             (dev, lat, lng, r, locked, must_stay))
        except psycopg2.errors.UndefinedColumn:
            self.cur.execute("INSERT INTO geofences (device_id,lat,lng,radius_meters,active) VALUES (%s,%s,%s,%s,true)",
                             (dev, lat, lng, r))

    def write(self, dev, r):
        prov, acc, lat, lng, ts = r
        self.cur.execute("UPDATE devices SET status='online', last_seen_at=%s::timestamptz, last_lat=%s, last_lng=%s WHERE id=%s",
                         (ts, lat, lng, dev))
        self.cur.execute("INSERT INTO locations (device_id,lat,lng,accuracy,provider,recorded_at) VALUES (%s,%s,%s,%s,%s,%s::timestamptz)",
                         (dev, lat, lng, acc, prov, ts))

    def feed(self, dev, readings, sort=True):
        rs = sorted(readings, key=lambda x: x[4]) if sort else readings
        for r in rs:
            self.write(dev, r)

    def events(self, dev):
        self.cur.execute("SELECT type, to_char(created_at AT TIME ZONE 'America/Fortaleza','DD/MM HH24:MI:SS'), description FROM events "
                         "WHERE device_id=%s AND type NOT IN ('boot') ORDER BY created_at, type", (dev,))
        return self.cur.fetchall()

    def types(self, dev):
        return [e[0] for e in self.events(dev)]

    def state(self, dev):
        self.cur.execute("SELECT outside_geofence, geofence_breach_streak FROM devices WHERE id=%s", (dev,))
        return self.cur.fetchone()

    def gf(self, dev):
        self.cur.execute("SELECT lat,lng,radius_meters,locked FROM geofences WHERE device_id=%s AND active", (dev,)) if self.db == "vt3" else \
            self.cur.execute("SELECT lat,lng,radius_meters,false FROM geofences WHERE device_id=%s AND active", (dev,))
        return self.cur.fetchone()


def dist_m(a, b, c, d):
    p = math.pi / 180
    h = math.sin((c - a) * p / 2) ** 2 + math.cos(a * p) * math.cos(c * p) * math.sin((d - b) * p / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


def north_of(lat, lng, meters):
    return (lat + meters / M_PER_DEG_LAT, lng)


def day_readings(day, lat, lng, start="07:30", end="17:30", step=90, acc=5.0, seed=0, tz="-03"):
    """leituras GPS de um dia de funcionamento, jitter de ~4 m, determinístico"""
    rnd = random.Random(seed)
    sh, sm = map(int, start.split(":")); eh, em = map(int, end.split(":"))
    t = sh * 3600 + sm * 60
    out = []
    while t <= eh * 3600 + em * 60:
        hh, mm, ss = t // 3600, (t % 3600) // 60, t % 60
        out.append(("gps", acc, lat + rnd.uniform(-4e-5, 4e-5), lng + rnd.uniform(-4e-5, 4e-5),
                    "%s %02d:%02d:%02d%s" % (day, hh, mm, ss, tz)))
        t += step
    return out


def segment_readings(center, t0, t1, acc, step=90, seed=1):
    import datetime as dt
    rnd = random.Random(seed)
    a = dt.datetime.fromisoformat(t0.replace("+00", "+00:00")); b = dt.datetime.fromisoformat(t1.replace("+00", "+00:00"))
    out = []
    while a <= b:
        out.append(("gps", acc, center[0] + rnd.uniform(-3e-5, 3e-5), center[1] + rnd.uniform(-3e-5, 3e-5), a.strftime("%Y-%m-%d %H:%M:%S+00")))
        a += dt.timedelta(seconds=step)
    return out


def main():
    old = Env("vt")
    new = Env("vt3")

    print("\n=== S1 Vanessa 01/10 (saída real de 2,3 km, ZERO evento em produção) ===")
    old.reset(); d = old.device("Vanessa"); old.point(d, *VANESSA_POINT); old.feed(d, VANESSA)
    check("S1a gatilho ANTIGO (produção hoje) perde a saída da Vanessa", old.types(d) == [], str(old.events(d)))
    new.reset(); d = new.device("Vanessa"); new.point(d, *VANESSA_POINT); new.feed(d, VANESSA)
    ev = new.events(d)
    check("S1b gatilho NOVO pega a saída e a volta (1 left + 1 entered)", [e[0] for e in ev] == ["left_geofence", "entered_geofence"], str(ev))
    check("S1c saída confirmada às 06:13 (4 min parada fora) e volta às 07:10 (2ª leitura dentro) de 01/10",
          len(ev) == 2 and ev[0][1].startswith("01/10 06:13") and ev[1][1].startswith("01/10 07:10"), str([e[1] for e in ev]))
    check("S1d estado final dentro do ponto", new.state(d)[0] is False, str(new.state(d)))

    print("\n=== S2 Emilly 03/10 manhã (caminhada de 412 m até a loja), ponto travado ===")
    new.reset(); d = new.device("Emilly"); new.point(d, *EMILLY_POINT, locked=True, must_stay=True); new.feed(d, EMILLY_MORNING)
    ev = new.events(d)
    check("S2a ponto estrito: pega a saída (3 leituras GPS fora em 3,7 min) e a chegada", [e[0] for e in ev] == ["left_geofence", "entered_geofence"], str(ev))
    check("S2b saída às 07:40:50, chegada confirmada às 07:43:51",
          len(ev) == 2 and ev[0][1].endswith("07:40:50") and ev[1][1].endswith("07:43:51"), str([e[1] for e in ev]))
    new.reset(); d3 = new.device("Emilly-nao-estrita"); new.point(d3, *EMILLY_POINT, locked=True, must_stay=False); new.feed(d3, EMILLY_MORNING)
    check("S2d mesmo caminho em ponto NÃO estrito não alerta (oscilação normal de GPS)", new.types(d3) == [], str(new.events(d3)))
    old.reset(); d2 = old.device("Emilly"); old.point(d2, *EMILLY_POINT); old.feed(d2, EMILLY_MORNING)
    check("S2c gatilho ANTIGO não pega nada da Emilly", old.types(d2) == [], str(old.events(d2)))

    print("\n=== S3 Kamilla 03/10 (terminal sem ponto, trajeto real) ===")
    new.reset(); d = new.device("Kamilla")
    rs = []
    for i, (c, t0, t1, acc) in enumerate(KAMILLA_SEGMENTS):
        rs += segment_readings(c, t0, t1, acc, seed=10 + i)
    new.feed(d, rs)
    ev = new.events(d)
    check("S3a gera 2 eventos 'moved_without_point' (447 m e 4.888 m)", [e[0] for e in ev] == ["moved_without_point", "moved_without_point"], str(ev))
    check("S3b ainda NÃO cria ponto (só 1 dia parcial)", new.gf(d) is None)
    # mais 2 dias de funcionamento completo no destino (seg 05/10 e ter 06/10)
    dest = KAMILLA_SEGMENTS[2][0]
    new.feed(d, day_readings("2026-10-05", dest[0], dest[1], seed=21) + day_readings("2026-10-06", dest[0], dest[1], seed=22))
    types = new.types(d)
    g = new.gf(d)
    check("S3c depois de 2 dias completos cria o ponto sozinho (1x)", types.count("point_created") == 1, str(types))
    check("S3d ponto criado a < 20 m do destino", g is not None and dist_m(g[0], g[1], dest[0], dest[1]) < 20,
          "" if g is None else "%.1f m" % dist_m(g[0], g[1], dest[0], dest[1]))
    check("S3e sem alerta falso depois do ponto criado", "left_geofence" not in types and types.count("moved_without_point") == 2, str(types))

    print("\n=== S4 Mudança de ponto (regra do Wallacy) ===")
    P = (-7.20580, -35.88546); Q = (-7.24379, -35.87910)
    # S4a: dia completo no lugar novo, sem voltar -> adota
    new.reset(); d = new.device("Graciane-like"); new.point(d, P[0], P[1], 250)
    new.feed(d, day_readings("2026-10-05", Q[0], Q[1], seed=31))
    t = new.types(d); g = new.gf(d)
    check("S4a alerta de saída, depois adota o novo ponto após o dia completo", t == ["left_geofence", "moved_point"], str(new.events(d)))
    check("S4b ponto novo ~ lugar novo (< 15 m) e alerta limpo", g is not None and dist_m(g[0], g[1], Q[0], Q[1]) < 15 and new.state(d)[0] is False,
          "" if g is None else "%.1f m, estado=%s" % (dist_m(g[0], g[1], Q[0], Q[1]), new.state(d)))
    new.cur.execute("SELECT count(*), min(reason) FROM geofence_history WHERE device_id=%s", (d,))
    check("S4c histórico gravado (mudou_de_ponto)", new.cur.fetchone() == (1, "mudou_de_ponto"))
    # S4d: só meio dia -> NÃO adota, alerta permanece
    new.reset(); d = new.device("meio-dia"); new.point(d, P[0], P[1], 250)
    new.feed(d, day_readings("2026-10-05", Q[0], Q[1], start="07:30", end="11:00", seed=32))
    check("S4d meio dia NÃO adota e o alerta permanece", new.types(d) == ["left_geofence"] and new.state(d)[0] is True, str(new.events(d)))
    # S4e: volta pro ponto antigo no meio da tarde -> NÃO adota
    new.reset(); d = new.device("volta"); new.point(d, P[0], P[1], 250)
    new.feed(d, day_readings("2026-10-05", Q[0], Q[1], start="07:30", end="14:30", seed=33) + day_readings("2026-10-05", P[0], P[1], start="15:00", end="18:00", seed=34))
    check("S4e voltou ao ponto antigo: não adota, termina dentro do ponto", new.types(d) == ["left_geofence", "entered_geofence"] and new.state(d)[0] is False, str(new.events(d)))
    # S4f: ponto travado (Emilly) -> nunca adota
    new.reset(); d = new.device("travado"); new.point(d, P[0], P[1], 250, locked=True)
    new.feed(d, day_readings("2026-10-05", Q[0], Q[1], seed=35) + day_readings("2026-10-06", Q[0], Q[1], seed=36))
    check("S4f ponto TRAVADO nunca é trocado, alerta permanece 2 dias", new.types(d) == ["left_geofence"] and new.state(d)[0] is True, str(new.events(d)))
    # S4g: domingo não conta como dia completo (fecha 13:00)
    new.reset(); d = new.device("domingo"); new.point(d, P[0], P[1], 250)
    new.feed(d, day_readings("2026-10-04", Q[0], Q[1], start="06:40", end="12:50", seed=37))
    check("S4g domingo sozinho não adota", new.types(d) == ["left_geofence"], str(new.events(d)))

    print("\n=== S5 Rede e GPS ruim nunca decidem ===")
    new.reset(); d = new.device("rede"); new.point(d, P[0], P[1], 250)
    bad = [("network", 20, Q[0], Q[1], "2026-10-05 08:%02d:00-03" % i) for i in range(0, 40)]
    bad += [("gps", 80, Q[0], Q[1], "2026-10-05 09:%02d:00-03" % i) for i in range(0, 40)]
    bad += [("gps", 31, Q[0], Q[1], "2026-10-05 10:%02d:00-03" % i) for i in range(0, 40)]
    new.feed(d, bad)
    check("S5 120 leituras (rede / GPS de 80 m / GPS de 31 m) a 4 km: zero evento", new.types(d) == [] and new.state(d) == (False, 0), str(new.events(d)))

    print("\n=== S6 Duplicatas, oscilação e GPS que 'passeia' (falsos alertas reais da Bia, Luana e Jessica) ===")
    c0 = (-7.2000, -35.9000)
    out300 = north_of(*c0, 300)
    def fresh(name="x"):
        new.reset(); dd = new.device(name); new.point(dd, c0[0], c0[1], 250); return dd
    d = fresh("dup"); new.feed(d, [("gps", 10, *out300, "2026-10-05 09:00:00-03"), ("gps", 10, *out300, "2026-10-05 09:00:05-03")])
    check("S6a mesma leitura reenviada em < 20 s não conta duas vezes", new.types(d) == [] and new.state(d)[1] == 1, str((new.events(d), new.state(d))))
    d = fresh("osc"); new.feed(d, [("gps", 10, *out300, "2026-10-05 09:00:00-03"), ("gps", 10, c0[0], c0[1], "2026-10-05 09:01:00-03"), ("gps", 10, *out300, "2026-10-05 09:02:00-03")])
    check("S6b oscilação fora-dentro-fora: sem alerta", new.types(d) == [], str(new.events(d)))
    d = fresh("2leit"); new.feed(d, [("gps", 10, *out300, "2026-10-05 09:00:00-03"), ("gps", 10, *out300, "2026-10-05 09:00:40-03")])
    check("S6c 2 leituras fora separadas por 40 s: ainda sem alerta", new.types(d) == [], str(new.events(d)))
    d = fresh("3leit"); new.feed(d, [("gps", 10, *out300, "2026-10-05 09:00:00-03"), ("gps", 10, *out300, "2026-10-05 09:01:30-03"), ("gps", 10, *out300, "2026-10-05 09:03:00-03")])
    check("S6d 3 leituras no mesmo lugar fora, em 3 min: alerta", new.types(d) == ["left_geofence"], str(new.events(d)))
    d = fresh("2leit30"); new.feed(d, [("gps", 10, *out300, "2026-10-05 09:00:00-03"), ("gps", 10, *out300, "2026-10-05 09:31:00-03")])
    check("S6e 2 leituras no mesmo lugar fora, 31 min separadas (terminal que reporta pouco): alerta", new.types(d) == ["left_geofence"], str(new.events(d)))
    d = fresh("passeio")
    wander = [("gps", 8, *north_of(c0[0], c0[1], 480), "2026-10-05 09:00:00-03"), ("gps", 9, c0[0] + 0.0022, c0[1] + 0.0021, "2026-10-05 09:03:00-03"),
              ("gps", 8, c0[0] - 0.0023, c0[1] + 0.0010, "2026-10-05 09:06:00-03"), ("gps", 8, *north_of(c0[0], c0[1], 330), "2026-10-05 09:08:00-03"),
              ("gps", 9, c0[0], c0[1], "2026-10-05 09:09:00-03"), ("gps", 9, c0[0], c0[1], "2026-10-05 09:10:00-03")]
    new.feed(d, wander)
    check("S6f GPS que 'passeia' (4 leituras fora, 8 min, espalhadas > 150 m) e volta: sem alerta", new.types(d) == [], str(new.events(d)))

    print("\n=== S7 Leitura única e movimento ===")
    def one(acc, meters):
        dd = fresh("fr"); la, ln = north_of(c0[0], c0[1], meters)
        new.feed(dd, [("gps", acc, la, ln, "2026-10-05 09:00:00-03")]); return new.types(dd)
    check("S7a 1 leitura GPS de 3 m de precisão a 501 m: alerta imediato", one(3, 501) == ["left_geofence"])
    check("S7b 1 leitura de 3,1 m a 501 m: sem alerta (precisa de confirmação)", one(3.1, 501) == [])
    check("S7c 1 leitura de 3 m a 499 m: sem alerta", one(3, 499) == [])
    check("S7d 1 leitura de 8 m a 1235 m (como a Bia): sem alerta", one(8, 1235) == [])
    check("S7e 1 leitura de 5 m a 251 m: sem alerta", one(5, 251) == [])
    def chain(span_s):
        dd = fresh("mov"); rs = []
        for i in range(4):
            la, ln = north_of(c0[0], c0[1], 700 + 200 * i)
            rs.append(("gps", 8, la, ln, "2026-10-05 09:%02d:%02d-03" % ((i * span_s // 3) // 60, (i * span_s // 3) % 60)))
        new.feed(dd, rs); return new.types(dd)
    check("S7f 4 leituras longe (> 500 m) e em movimento, em 3 min: alerta", chain(180) == ["left_geofence"])
    check("S7g as mesmas 4 leituras em 2 min: sem alerta", chain(120) == [])

    print("\n=== S8 Leituras fora de ordem (threads do app) ===")
    import datetime as _d
    def _ts(x): return _d.datetime.strptime(x[4][:19], "%Y-%m-%d %H:%M:%S")
    base = sorted(VANESSA, key=lambda x: x[4])
    ok_all = True; worst = ""
    for seed in range(60):
        rnd = random.Random(seed)
        arr = list(base)
        for i in range(len(arr) - 1, 0, -1):          # inversões REAIS: só leituras com até 150 s de diferença (threads do app)
            j = max(0, i - rnd.randint(0, 3))
            if abs((_ts(arr[i]) - _ts(arr[j])).total_seconds()) <= 150:
                arr[i], arr[j] = arr[j], arr[i]
        new.reset(); d = new.device("ooo"); new.point(d, *VANESSA_POINT); new.feed(d, arr, sort=False)
        t_ = new.types(d); st = new.state(d)
        if not (t_ == ["left_geofence", "entered_geofence"] and st[0] is False):
            ok_all = False; worst = "seed %d -> %s %s" % (seed, new.events(d), st); break
    check("S8a 60 embaralhamentos (até 150 s) da sequência real: sempre 1 saída + 1 volta, estado final dentro", ok_all, worst)

    # S8b: leitura ATRASADA (dias) chega depois de uma nova: fica no histórico, NÃO altera o estado ao vivo nem inventa alerta
    new.reset(); d = new.device("atraso"); new.point(d, *VANESSA_POINT)
    new.feed(d, [x for x in base if x[4] >= "2026-10-02"])
    for x in [x for x in base if "2026-10-01 06:09" <= x[4] <= "2026-10-01 06:14"]:
        new.write(d, x)
    check("S8b leitura atrasada em dias: guardada, sem alerta falso e estado ao vivo continua 'dentro'",
          new.types(d) == [] and new.state(d)[0] is False, str(new.events(d)))

    # S8c: relógio do terminal no futuro NÃO pode cegar o gatilho
    c2 = Env("vt3"); c2.reset(); d = c2.device("relogio"); c2.point(d, *VANESSA_POINT)
    c2.cur.execute("SET app.now_override = '2026-10-06 12:00:00+00'")
    c2.feed(d, [x for x in base if x[4] >= "2026-10-02"])
    c2.write(d, ("gps", 8.0, -7.23490, -35.89230, "2026-10-20 10:00:00-03"))
    for x in [("gps", 8.0, -7.22404, -35.87414, "2026-10-03 09:00:00-03"), ("gps", 8.0, -7.22406, -35.87416, "2026-10-03 09:02:00-03"),
              ("gps", 8.0, -7.22405, -35.87415, "2026-10-03 09:04:00-03")]:
        c2.write(d, x)
    check("S8c leitura com data no futuro não cega o gatilho: saída real depois dela é detectada",
          c2.types(d) == ["left_geofence"], str(c2.events(d)))
    c2.cur.execute("RESET app.now_override")

    print("\n=== S9 Incidentes reais antigos pelo gatilho novo (ordem do app) ===")
    G = {"Graciane": (-7.20579667, -35.885455), "Nome": (-7.25630333, -35.89676833), "Bia": (-7.22301667, -35.873175)}
    for nm, data in (("Graciane", GRACIANE_INCIDENT), ("Nome", NOME_INCIDENT), ("Bia", BIA_SAMPLE)):
        new.reset(); d = new.device(nm); new.point(d, G[nm][0], G[nm][1], 250)
        new.feed(d, data)
        t = new.types(d)
        if nm in ("Graciane", "Nome"):
            check("S9 %s: saída real detectada" % nm, "left_geofence" in t, str(new.events(d))[:160])
        else:
            print("INFO Bia (amostra real, terminal fixo a 3 m): eventos =", new.events(d))

    print("\n=== S10 Custo: escritas extras e tempo por leitura (medido numa transação só) ===")
    def perf(trigger_on):
        new.reset()
        ids = [new.device("perf%02d" % i) for i in range(28)]
        rnd = random.Random(5)
        pts = {}
        for dd in ids:
            pts[dd] = (-7.2 + rnd.random() * 0.05, -35.9 + rnd.random() * 0.05)
            new.point(dd, pts[dd][0], pts[dd][1], 250)
        new.cur.execute("ALTER TABLE locations %s TRIGGER trg_eval_location_v3" % ("ENABLE" if trigger_on else "DISABLE"))
        data = {dd: day_readings("2026-10-05", pts[dd][0], pts[dd][1], step=60, seed=i)[:600] for i, dd in enumerate(ids)}
        c = psycopg2.connect(dbname="vt3", user="postgres", host="/var/run/postgresql"); c.autocommit = False
        cu = c.cursor(); n = 0; t0 = time.time()
        for k in range(600):
            for dd in ids:
                if k < len(data[dd]):
                    r = data[dd][k]
                    cu.execute("INSERT INTO locations (device_id,lat,lng,accuracy,provider,recorded_at) VALUES (%s,%s,%s,%s,%s,%s::timestamptz)",
                               (dd, r[2], r[3], r[1], r[0], r[4])); n += 1
        dt = time.time() - t0
        cu.execute("SELECT n_tup_upd, n_tup_ins FROM pg_stat_xact_user_tables WHERE relname='devices'")
        upd = cu.fetchone()[0]
        cu.execute("SELECT count(*) FROM events WHERE type IN ('left_geofence','moved_point','entered_geofence')")
        ev = cu.fetchone()[0]
        c.commit(); c.close()
        new.cur.execute("ALTER TABLE locations ENABLE TRIGGER trg_eval_location_v3")
        return n, dt, upd, ev
    n, t_off, upd_off, _ = perf(False)
    n, t_on, upd_on, ev_spurious = perf(True)
    check("S10a %d leituras em 28 terminais parados no ponto: zero alerta falso" % n, ev_spurious == 0, "eventos=%d" % ev_spurious)
    print("INFO S10b custo do gatilho por leitura: %.2f ms (sem gatilho %.2f ms -> com gatilho %.2f ms)" % (1000 * (t_on - t_off) / n, 1000 * t_off / n, 1000 * t_on / n))
    check("S10c UPDATEs em devices causados pelo gatilho = só a revisão horária (<= 28 terminais x 10 h)", upd_on <= 28 * 11, "UPDATEs=%d para %d leituras (sem gatilho: %d)" % (upd_on, n, upd_off))

    print("\n=== S10d Trava de escrita da produção (fleet_writes_allowed) ===")
    new.reset(); d = new.device("trava"); new.point(d, *VANESSA_POINT)
    new.cur.execute("UPDATE system_control SET value=false WHERE key='fleet_writes_allowed'")
    blocked = False
    try:
        new.write(d, VANESSA[5])
    except Exception as e:
        blocked = "fleet_writes_disabled" in str(e)
    new.cur.execute("UPDATE system_control SET value=true WHERE key='fleet_writes_allowed'")
    new.cur.execute("SELECT count(*) FROM locations WHERE device_id=%s", (d,)); n0 = new.cur.fetchone()[0]
    check("S10d trava ligada: escrita bloqueada como hoje (nenhuma leitura entra)", blocked and n0 == 0, "bloqueou=%s leituras=%d" % (blocked, n0))
    new.feed(d, VANESSA)
    check("S10e trava liberada: fluxo normal com as travas reais (saída + volta)", new.types(d) == ["left_geofence", "entered_geofence"], str(new.types(d)))

    print("\n=== S11 Sabotagem: se o gatilho der erro, a leitura TEM que ser gravada ===")
    new.reset(); d = new.device("sabotagem"); new.point(d, *VANESSA_POINT)
    new.cur.execute("ALTER TABLE events ADD CONSTRAINT boom CHECK (false) NOT VALID")
    try:
        new.feed(d, VANESSA)
        new.cur.execute("SELECT count(*) FROM locations WHERE device_id=%s", (d,))
        cnt = new.cur.fetchone()[0]
        check("S11 events quebrado (erro dentro do gatilho): TODAS as %d leituras foram gravadas" % len(VANESSA), cnt == len(VANESSA), "gravadas=%d" % cnt)
    except Exception as e:
        check("S11 gatilho derrubou a gravação da leitura", False, repr(e)[:200])
    finally:
        new.cur.execute("ALTER TABLE events DROP CONSTRAINT IF EXISTS boom")

    print("\n=== S12 Concorrência no mesmo terminal (8 threads, 1 ponto, 1 saída) ===")
    import threading
    new.reset(); d = new.device("conc"); new.point(d, c0[0], c0[1], 250)
    errs = []
    import datetime as _dt
    ctr = {"n": 0}; ctr_lock = threading.Lock()
    base_t = _dt.datetime(2026, 10, 5, 9, 0, 0)
    def worker(k):
        try:
            cc = connect("vt3"); cu = cc.cursor()
            for j in range(12):
                la, ln = north_of(c0[0], c0[1], 400 + k)
                with ctr_lock:                       # carimbo de tempo sequencial, alocado na hora de gravar
                    ctr["n"] += 1
                    ts = (base_t + _dt.timedelta(seconds=60 * ctr["n"])).strftime("%Y-%m-%d %H:%M:%S-03")
                cu.execute("UPDATE devices SET last_lat=%s,last_lng=%s,last_seen_at=%s::timestamptz WHERE id=%s", (la, ln, ts, d))
                cu.execute("INSERT INTO locations (device_id,lat,lng,accuracy,provider,recorded_at) VALUES (%s,%s,%s,%s,'gps',%s::timestamptz)", (d, la, ln, 8, ts))
            cc.close()
        except Exception as e:
            errs.append(repr(e))
    th = [threading.Thread(target=worker, args=(k,)) for k in range(8)]
    [t.start() for t in th]; [t.join() for t in th]
    new.cur.execute("SELECT count(*) FROM locations WHERE device_id=%s", (d,)); cnt = new.cur.fetchone()[0]
    check("S12a sem erro/deadlock e todas as 96 leituras gravadas", not errs and cnt == 96, "erros=%s gravadas=%d" % (errs[:1], cnt))
    check("S12b exatamente 1 evento de saída (sem duplicar) e estado 'fora'", new.types(d) == ["left_geofence"] and new.state(d)[0] is True, str(new.types(d)))
    # criação de ponto concorrente: histórico pré-carregado (gatilho desligado) + 8 threads disparando a revisão ao mesmo tempo
    new.reset(); d = new.device("conc-ponto"); Qd = (-7.2262, -35.9213)
    new.cur.execute("ALTER TABLE locations DISABLE TRIGGER trg_eval_location_v3")
    new.feed(d, day_readings("2026-10-05", Qd[0], Qd[1], seed=41) + day_readings("2026-10-06", Qd[0], Qd[1], start="07:30", end="15:00", seed=42))
    new.cur.execute("ALTER TABLE locations ENABLE TRIGGER trg_eval_location_v3")
    errs.clear()
    def worker2(k):
        try:
            cc = connect("vt3"); cu = cc.cursor()
            for j in range(4):
                ts = "2026-10-06 17:%02d:%02d-03" % (10 + k, 5 + j * 10)
                cu.execute("INSERT INTO locations (device_id,lat,lng,accuracy,provider,recorded_at) VALUES (%s,%s,%s,5,'gps',%s::timestamptz)",
                           (d, Qd[0] + 1e-5 * k, Qd[1], ts))
            cc.close()
        except Exception as e:
            errs.append(repr(e))
    th = [threading.Thread(target=worker2, args=(k,)) for k in range(8)]
    [t.start() for t in th]; [t.join() for t in th]
    new.cur.execute("SELECT count(*) FROM geofences WHERE device_id=%s", (d,)); ng = new.cur.fetchone()[0]
    check("S12c 8 threads disparando a revisão juntas: exatamente 1 ponto criado, sem erro", ng == 1 and not errs, "pontos=%d erros=%s" % (ng, errs[:1]))

    bad = [r for r in RESULTS if not r[1]]
    print("\nRESUMO: %d testes, %d passaram, %d falharam" % (len(RESULTS), len(RESULTS) - len(bad), len(bad)))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
