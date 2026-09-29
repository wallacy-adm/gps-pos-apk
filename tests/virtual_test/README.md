# Teste virtual — v2.0.26 (26/09/2026)

Validação da correção proposta (fila única no app + ajuste na regra de
confirmação de geofence + limiar de movimento + janela de horário) ANTES de
escrever qualquer código de produção. A pedido explícito do Wallacy: "blindar"
e testar tudo antes da versão final.

Método: nada de aproximação — schema e gatilho (`check_geofence_on_location_update`)
copiados **verbatim** do banco de produção (`pg_get_functiondef`/`pg_get_triggerdef`),
rodando num Postgres local, com **dado real** puxado do Supabase (não inventado).

## Como rodar de novo
```
createdb vt
psql -d vt -f schema_real.sql
pip install psycopg2-binary
python3 replay_real.py                 # geofence: ordem atual vs proposta
python3 test_volume_and_schedule.py    # volume de dado + janela de horário
```

## Resultado (26/09/2026) — ver seção 12 de `docs/plans/2026-09-25-auditoria-completa.md`
- **Geofence**: na ordem atual do app (heartbeat antes de location), o
  cruzamento que o gatilho faz falha **100% das vezes**, sempre — não é sorte,
  é garantido pela ordem das duas chamadas. Confirmado também contando a
  tabela `events` de produção: o gatilho atual nunca disparou 1 vez sequer
  desde que foi publicado. Invertendo a ordem (o que a fila única garante),
  o cruzamento funciona 100% das vezes nos 3 casos testados.
- Achado adicional: mesmo com a ordem corrigida, a regra "2 leituras
  confirmadas seguidas" ainda deixa passar o caso "Nome" (1 única leitura
  muito precisa antes do terminal ficar mudo). Regra ajustada (2 seguidas OU
  1 leitura ≤15m de precisão com distância > 2x o raio) testada contra os
  **11 incidentes reais** encontrados na frota inteira (busca em todo o
  histórico, não só nos casos já conhecidos) — pega os 11, sem exceção.
- Volume de dado: ~1.144MB/mês hoje (57x acima do plano de 20MB) contra
  ~0,3MB/mês com a correção.
- Janela de horário: a proposta diverge da atual exatamente nos 4 casos de
  borda esperados (depois das 19h em dia de semana, depois das 13h no
  domingo) — nenhum efeito colateral fora desses pontos.

## Pendência aberta, não resolvida aqui
2 dos 11 incidentes reais são da Bia Campos sales, de antes da confirmação
dela de que o terminal não sai de 3 metros fisicamente. Não achei nenhum
outro caso na base de GPS de alta precisão "mentindo" — a explicação mais
provável é o ponto de geofence dela estar calibrado errado, não erro de
leitura. Fica pra confirmar com acesso físico.
