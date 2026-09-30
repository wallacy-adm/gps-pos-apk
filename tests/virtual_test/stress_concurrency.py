"""
Teste A: tentativa de estresse de concorrencia com threads reais. IMPORTANTE
-- ver secao 13.1 da auditoria: nesta escala de tempo (milissegundos entre
escritas de fontes diferentes) o teste nao e representativo do app real
(fontes disparam com dezenas de segundos de intervalo, nao milissegundos), e
por isso os dois cenarios (com/sem fila) acabam convergindo. A prova que vale
e replay_real.py, com timestamps REAIS do incidente. Mantido aqui por
transparencia do que foi tentado, nao como prova.
"""
import threading, time, random, psycopg2, datetime as dt

DEV_LAT, DEV_LNG = -7.30000, -35.90000
FAR_LAT, FAR_LNG = -7.30450, -35.90000

def connect():
    c = psycopg2.connect(dbname="vt", user="postgres", host="/var/run/postgresql")
    c.autocommit = True
    return c

def setup():
    conn = connect(); cur = conn.cursor()
    cur.execute("TRUNCATE events, locations, geofences, devices CASCADE")
    cur.execute("INSERT INTO devices (serial,last_lat,last_lng,last_seen_at,status) VALUES ('STRESS1',%s,%s,now(),'online') RETURNING id",
                (DEV_LAT, DEV_LNG))
    dev_id = cur.fetchone()[0]
    cur.execute("INSERT INTO geofences (device_id,lat,lng,radius_meters,active) VALUES (%s,%s,%s,250,true)",
                (dev_id, DEV_LAT, DEV_LNG))
    conn.close(); return dev_id

def one_report(dev_id, lock):
    lat = FAR_LAT + random.uniform(-0.00002, 0.00002)
    lng = FAR_LNG + random.uniform(-0.00002, 0.00002)
    ts = dt.datetime.now(dt.timezone.utc).isoformat()
    if lock: lock.acquire()
    try:
        conn = connect(); cur = conn.cursor()
        cur.execute("UPDATE devices SET last_seen_at=%s, last_lat=%s, last_lng=%s WHERE id=%s", (ts, lat, lng, dev_id))
        time.sleep(random.uniform(0.01, 0.05))
        cur.execute("INSERT INTO locations (device_id,lat,lng,accuracy,provider,recorded_at) VALUES (%s,%s,%s,2.0,'gps',%s)",
                    (dev_id, lat, lng, ts))
        conn.close()
    finally:
        if lock: lock.release()

def run_once(use_lock, n_writers=3, n_rounds=15):
    dev_id = setup()
    lock = threading.Lock() if use_lock else None
    def worker():
        for _ in range(n_rounds):
            time.sleep(random.uniform(0, 0.02))
            one_report(dev_id, lock)
    threads = [threading.Thread(target=worker) for _ in range(n_writers)]
    for t in threads: t.start()
    for t in threads: t.join()
    conn = connect(); cur = conn.cursor()
    cur.execute("SELECT outside_geofence, geofence_breach_streak FROM devices WHERE id=%s", (dev_id,))
    r = cur.fetchone(); conn.close(); return r

if __name__ == "__main__":
    N_TRIALS = 20
    print(f"=== TESTE A: {N_TRIALS} tentativas, threads reais (ver ressalva no topo do arquivo) ===\n")
    for label, use_lock in [("SEM fila", False), ("COM fila", True)]:
        sucessos = 0
        for trial in range(N_TRIALS):
            random.seed(1000 + trial)
            outside, streak = run_once(use_lock)
            if outside: sucessos += 1
        print(f"  {label:9}: alertou em {sucessos}/{N_TRIALS} ({100*sucessos/N_TRIALS:.0f}%)")
