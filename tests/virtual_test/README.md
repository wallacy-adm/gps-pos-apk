# Teste virtual — v2.0.26 (26/09/2026)

Validação da correção proposta (fila única no app + ajuste na regra de
confirmação de geofence + limiar de movimento + janela de horário) ANTES de
escrever qualquer código de produção. A pedido explícito do Wallacy: "blindar"
e testar tudo, sem desculpas depois, antes da versão final.

Método: nada de aproximação — schema e gatilho (`check_geofence_on_location_update`)
copiados **verbatim** do banco de produção, rodando num Postgres local, com
**dado real** puxado do Supabase.

## Como rodar de novo
```
createdb vt
psql -d vt -f schema_real.sql
pip install psycopg2-binary
python3 replay_real.py                 # geofence: ordem atual vs proposta
python3 test_volume_and_schedule.py    # volume de dado + janela de horário
psql -d vt -f schema_proposta.sql      # carrega o gatilho v2 (atalho de 1 leitura)
python3 test_edge_cases.py             # B1-B3: casos de borda, gatilho real
python3 test_edge_cases_v2.py          # B4-B5: atalho de 1 leitura, gatilho v2
python3 test_row_lock.py               # C: Postgres protege contra lost update
python3 stress_concurrency.py          # A: ver ressalva no topo do arquivo
```

## Resultado (26/09/2026) — ver seções 12 e 13 de `docs/plans/2026-09-25-auditoria-completa.md`
- **Geofence**: na ordem atual do app, o cruzamento que o gatilho faz falha
  **100% das vezes**, sempre — confirmado também contando a tabela `events`
  de produção: o gatilho atual nunca disparou desde que foi publicado.
  Invertendo a ordem (o que a fila única garante), funciona 100% das vezes.
- Regra ajustada (2 leituras seguidas OU 1 leitura ≤15m de precisão com
  distância > 2x o raio) testada contra os **11 incidentes reais** da frota
  inteira — pega os 11, sem exceção. Testada também com casos de borda
  adversos (fronteiras exatas, oscilação, rede) no gatilho de verdade.
- Volume de dado: ~1.144MB/mês hoje (57x acima do plano) contra ~0,3MB/mês
  com a correção.
- Janela de horário: diverge da atual exatamente nos 4 casos de borda
  esperados, nenhum efeito colateral fora deles.
- Postgres sozinho não perde incremento em concorrência bruta na mesma linha
  (camada de segurança extra, não substitui a fila).

## Erros de metodologia encontrados e corrigidos nesta rodada (registrados, não escondidos)
- Teste de concorrência com threads reais: 1ª tentativa usava coordenada
  fixa demais (mascarava o bug); 2ª tentativa ficou rápida demais pra ser
  representativa do app real. Ressalva completa no topo de `stress_concurrency.py`.
- Testes de fronteira do atalho de 1 leitura: 1ª tentativa usava margem
  (0.4m) menor que o erro da própria conversão metro→grau usada pra montar
  o teste. Corrigido consultando a distância real via SQL antes de montar
  cada caso.

## Pendência aberta, não resolvida aqui
2 dos 11 incidentes reais são da Bia Campos sales, de antes da confirmação
dela de que o terminal não sai de 3 metros fisicamente. Não achei nenhum
outro caso na base de GPS de alta precisão "mentindo" — a explicação mais
provável é o ponto de geofence dela estar calibrado errado, não erro de
leitura. Fica pra confirmar com acesso físico.
