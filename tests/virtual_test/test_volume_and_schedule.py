"""
Teste 2 (volume de dado) e Teste 3 (janela de horário, casos de borda).
Lógica pura, não precisa de banco — só rodar: python3 test_volume_and_schedule.py
"""
import datetime as dt

BYTES_UTEIS_HEARTBEAT = 230
BYTES_UTEIS_LOCATION = 140
TLS_OVERHEAD_SEM_REUSO = 10_000
TLS_OVERHEAD_COM_REUSO = 200

HORAS_ATIVAS_DIA = 13
INTERVALO_ATUAL_S = 25

reports_dia_atual = (HORAS_ATIVAS_DIA * 3600) / INTERVALO_ATUAL_S
bytes_dia_atual = reports_dia_atual * (BYTES_UTEIS_HEARTBEAT + BYTES_UTEIS_LOCATION + 2 * TLS_OVERHEAD_SEM_REUSO)
mb_mes_atual = bytes_dia_atual * 30 / 1_000_000

reports_dia_novo = HORAS_ATIVAS_DIA
bytes_dia_novo = reports_dia_novo * (BYTES_UTEIS_HEARTBEAT + BYTES_UTEIS_LOCATION + 2 * TLS_OVERHEAD_COM_REUSO)
mb_mes_novo = bytes_dia_novo * 30 / 1_000_000

print("=== TESTE 2: volume de dado ===")
print(f"  Hoje  (MIN_DIST=0, sem reuso conexao): ~{mb_mes_atual:.0f} MB/mes  (plano = 20MB/mes)")
print(f"  Novo  (so ao mover + reuso conexao)  : ~{mb_mes_novo:.2f} MB/mes  (terminal parado)")
assert mb_mes_atual > 100
assert mb_mes_novo < 20
print(f"  PASSOU: reducao de {mb_mes_atual/mb_mes_novo:.0f}x, cabe dentro do plano de 20MB\n")

def is_active_ATUAL(d: dt.datetime) -> bool:
    m = d.hour * 60 + d.minute
    return 6 * 60 + 30 <= m < 20 * 60


def is_active_PROPOSTA(d: dt.datetime) -> bool:
    m = d.hour * 60 + d.minute
    if d.weekday() == 6:
        return 6 * 60 + 30 <= m < 13 * 60
    return 6 * 60 + 30 <= m < 19 * 60


casos = [
    ("seg 18:59", dt.datetime(2026, 9, 28, 18, 59)),
    ("seg 19:01", dt.datetime(2026, 9, 28, 19, 1)),
    ("seg 19:59", dt.datetime(2026, 9, 28, 19, 59)),
    ("dom 12:59", dt.datetime(2026, 9, 27, 12, 59)),
    ("dom 13:01", dt.datetime(2026, 9, 27, 13, 1)),
    ("dom 18:00", dt.datetime(2026, 9, 27, 18, 0)),
    ("qua 06:29", dt.datetime(2026, 9, 30, 6, 29)),
    ("qua 06:31", dt.datetime(2026, 9, 30, 6, 31)),
]
print("=== TESTE 3: janela de horario, casos de borda ===")
divergencias_esperadas = {"seg 19:01", "seg 19:59", "dom 13:01", "dom 18:00"}
achadas = set()
for nome, d in casos:
    a, p = is_active_ATUAL(d), is_active_PROPOSTA(d)
    marca = "  <-- DIVERGE (bug atual)" if a != p else ""
    if a != p:
        achadas.add(nome)
    print(f"  {nome:10} atual={a!s:5} proposta={p!s:5}{marca}")
assert achadas == divergencias_esperadas
print(f"  PASSOU: proposta diverge do atual exatamente nos {len(achadas)} casos de borda esperados (19h/domingo)")
