"""
Teste C: o Postgres, sozinho, protege contra "lost update" no streak quando
varias conexoes tentam UPDATE na mesma linha ao mesmo tempo? (pergunta
separada do bug de ORDEM ja provado em replay_real.py -- essa aqui e sobre
concorrencia bruta na mesma linha)
"""
import psycopg2, threading

def connect():
    c = psycopg2.connect(dbname="vt", user="postgres", host="/var/run/postgresql")
    c.autocommit = True
    return c

conn = connect(); cur = conn.cursor()
cur.execute("TRUNCATE events, locations, geofences, devices CASCADE")
cur.execute("INSERT INTO devices (serial,last_lat,last_lng,last_seen_at,status,geofence_breach_streak) "
            "VALUES ('LOCK1',-7.3,-35.9,now(),'online',0) RETURNING id")
dev_id = cur.fetchone()[0]
conn.close()

N = 50

def bump():
    c = connect(); k = c.cursor()
    k.execute("UPDATE devices SET geofence_breach_streak = geofence_breach_streak + 1 WHERE id=%s", (dev_id,))
    c.close()

threads = [threading.Thread(target=bump) for _ in range(N)]
for t in threads: t.start()
for t in threads: t.join()

conn = connect(); cur = conn.cursor()
cur.execute("SELECT geofence_breach_streak FROM devices WHERE id=%s", (dev_id,))
final = cur.fetchone()[0]
conn.close()
print(f"=== TESTE C: {N} UPDATEs concorrentes na MESMA linha ===")
print(f"  streak final: {final} (esperado: {N})")
assert final == N, f"FALHOU: perdeu {N - final} incrementos"
print("  PASSOU: Postgres nao perde incremento em concorrencia bruta na mesma linha.")
