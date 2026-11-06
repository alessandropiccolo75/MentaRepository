create table roles (
  id text primary key,
  label text not null,
  description text not null,
  sort_order integer not null
);

insert into roles (id, label, description, sort_order) values
  ('administrator', 'Amministratore', 'Gestisce utenti, ruoli, tutti i task e la configurazione.', 1),
  ('manager', 'Manager', 'Crea e assegna i task del proprio gruppo e ne segue l''avanzamento.', 2),
  ('user', 'Utente', 'Lavora sui task assegnati, aggiorna lo stato e commenta.', 3);

create table task_statuses (
  id text primary key,
  label text not null,
  sort_order integer not null,
  is_terminal boolean not null default false
);

insert into task_statuses (id, label, sort_order, is_terminal) values
  ('draft', 'Bozza', 10, false),
  ('new', 'Nuovo', 20, false),
  ('assigned', 'Assegnato', 30, false),
  ('accepted', 'Preso in carico', 40, false),
  ('wip', 'In lavorazione', 50, false),
  ('blocked', 'Bloccato', 60, false),
  ('completed', 'Completato', 70, true),
  ('closed', 'Chiuso', 80, true),
  ('cancelled', 'Annullato', 90, true);

create table groups (
  id uuid primary key default gen_random_uuid(),
  stage text not null check (stage in ('production', 'preview')),
  slug text not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (stage, slug),
  check (char_length(name) between 2 and 60),
  check (char_length(slug) between 2 and 40)
);

create table users (
  id uuid primary key default gen_random_uuid(),
  stage text not null check (stage in ('production', 'preview')),
  identity_sub text not null,
  email text not null default '',
  identity_name text not null default '',
  display_name text,
  role_id text not null references roles (id),
  group_id uuid not null references groups (id),
  disabled boolean not null default false,
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz,
  unique (stage, identity_sub),
  check (char_length(email) <= 200),
  check (char_length(identity_name) <= 120),
  check (display_name is null or char_length(display_name) between 1 and 80)
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  stage text not null check (stage in ('production', 'preview')),
  title text not null,
  description text not null default '',
  author_id uuid not null references users (id),
  status_id text not null references task_statuses (id),
  priority text not null check (priority in ('low', 'normal', 'high', 'critical')),
  progress integer not null default 0 check (progress between 0 and 100),
  planned_start date,
  deadline date,
  completed_at timestamptz,
  closed_at timestamptz,
  group_id uuid not null references groups (id),
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(title) between 1 and 200),
  check (char_length(description) <= 8000),
  check (planned_start is null or deadline is null or deadline >= planned_start)
);

create table task_assignments (
  id uuid primary key default gen_random_uuid(),
  stage text not null check (stage in ('production', 'preview')),
  task_id uuid not null references tasks (id) on delete cascade,
  user_id uuid not null references users (id),
  assigned_by uuid references users (id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (task_id, user_id)
);

create table comments (
  id uuid primary key default gen_random_uuid(),
  stage text not null check (stage in ('production', 'preview')),
  task_id uuid not null references tasks (id) on delete cascade,
  author_id uuid not null references users (id),
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(body) between 1 and 4000)
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  stage text not null check (stage in ('production', 'preview')),
  user_id uuid not null references users (id) on delete cascade,
  task_id uuid references tasks (id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  dedupe_key text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (stage, dedupe_key),
  check (char_length(title) between 1 and 180),
  check (char_length(body) between 1 and 600),
  check (char_length(kind) between 1 and 40)
);

create table task_history (
  id uuid primary key default gen_random_uuid(),
  stage text not null check (stage in ('production', 'preview')),
  task_id uuid not null references tasks (id) on delete cascade,
  actor_id uuid references users (id) on delete set null,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (char_length(action) between 1 and 40)
);

create table email_messages (
  id uuid primary key default gen_random_uuid(),
  stage text not null check (stage in ('production', 'preview')),
  notification_id uuid references notifications (id) on delete set null,
  to_address text not null,
  subject text not null,
  body text not null,
  status text not null check (status in ('queued', 'sent', 'skipped', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  check (char_length(to_address) <= 200),
  check (char_length(subject) between 1 and 180),
  check (char_length(body) <= 8000),
  check (error is null or char_length(error) <= 200)
);

create table app_settings (
  stage text not null check (stage in ('production', 'preview')),
  key text not null,
  value text not null,
  updated_at timestamptz not null default now(),
  primary key (stage, key),
  check (char_length(key) between 1 and 40),
  check (char_length(value) <= 200)
);

create index users_stage_group_idx on users (stage, group_id);
create index users_stage_role_idx on users (stage, role_id);
create index tasks_stage_status_idx on tasks (stage, status_id);
create index tasks_stage_group_idx on tasks (stage, group_id);
create index tasks_stage_deadline_idx on tasks (stage, deadline);
create index tasks_stage_updated_idx on tasks (stage, updated_at desc);
create index tasks_author_idx on tasks (author_id);
create index task_assignments_user_idx on task_assignments (user_id, task_id);
create index comments_task_idx on comments (task_id, created_at);
create index notifications_user_idx on notifications (user_id, created_at desc);
create index task_history_task_idx on task_history (task_id, created_at desc);
create index email_messages_stage_idx on email_messages (stage, created_at desc);
