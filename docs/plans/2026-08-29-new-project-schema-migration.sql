-- =====================================================================
-- MIGRATION — schema completo para o projeto Lovable NOVO (conta isolada)
-- Reconstruido com 100% de confianca a partir do codigo-fonte real
-- (plugins/with-boot-receiver.js), nao de achismo.
-- Aplicar via chat do Lovable do projeto novo (nao via supabase.com).
-- =====================================================================

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  serial text not null unique,
  status text,
  last_seen_at timestamptz,
  last_lat double precision,
  last_lng double precision,
  imei text,
  app_version text,
  created_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  device_id uuid references public.devices(id) on delete cascade,
  type text not null,
  description text,
  lat double precision,
  lng double precision,
  created_at timestamptz not null default now()
);

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  device_id uuid references public.devices(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  accuracy double precision,
  provider text,
  recorded_at timestamptz not null default now()
);

-- ===== Interruptor central de escrita (mesmo mecanismo do projeto antigo,
-- ver 2026-08-19-fleet-write-gate.sql) — comeca BLOQUEADO por padrao =====
create table if not exists system_control (
  key   text primary key,
  value boolean not null
);

insert into system_control (key, value)
values ('fleet_writes_allowed', false)
on conflict (key) do nothing;

create or replace function check_fleet_writes_allowed()
returns trigger as $$
begin
  if not (select value from system_control where key = 'fleet_writes_allowed') then
    raise exception 'fleet_writes_disabled: escrita bloqueada manualmente ate a frota estar validada';
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists gate_devices_write on devices;
create trigger gate_devices_write
  before insert or update on devices
  for each row execute function check_fleet_writes_allowed();

drop trigger if exists gate_locations_write on locations;
create trigger gate_locations_write
  before insert or update on locations
  for each row execute function check_fleet_writes_allowed();

-- IMPORTANTE: pedir para o agente Lovable garantir que a role anon/public
-- tenha INSERT/UPDATE nas 3 tabelas (desabilitar RLS ou policy permissiva) —
-- o app usa a publishable key direto via REST, sem login de usuario.
-- A seguranca real e este gate, nao RLS.
