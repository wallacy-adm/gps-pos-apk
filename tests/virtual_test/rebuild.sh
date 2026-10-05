#!/bin/bash
# recria os bancos de teste: vt = produção hoje (gatilho antigo), vt3 = gatilho novo
cd "$(dirname "$0")"
for db in vt vt3; do su postgres -c "dropdb --if-exists $db" 2>/dev/null; su postgres -c "createdb $db"; done
chmod -R a+rX .
psql -q -U postgres -h /var/run/postgresql -d vt  -f schema_real.sql -f schema_gate.sql 2>&1 | grep -v NOTICE
psql -q -U postgres -h /var/run/postgresql -d vt3 -v ON_ERROR_STOP=1 -f schema_real.sql -f schema_gate.sql -f schema_v3.sql 2>&1 | grep -v NOTICE
psql -q -U postgres -h /var/run/postgresql -d postgres -c "ALTER DATABASE vt3 SET app.now_override = '2030-01-01 00:00:00+00'" -c "ALTER DATABASE vt SET app.now_override = '2030-01-01 00:00:00+00'"
echo "bancos recriados"
