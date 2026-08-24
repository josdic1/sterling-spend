CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role AS ENUM (
  'user',
  'admin'
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role user_role NOT NULL DEFAULT 'user',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_number TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  event_date DATE NOT NULL,
  event_type TEXT,
  venue_name TEXT,
  venue_address TEXT,
  client_name TEXT,
  start_time TIME,
  end_time TIME,
  status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TYPE reimbursement_status AS ENUM (
  'open',
  'submitted',
  'reviewed',
  'paid'
);

CREATE TABLE reimbursements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  status reimbursement_status NOT NULL DEFAULT 'open',
  submitted_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  check_number TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (user_id, year, month)
);

CREATE TABLE expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reimbursement_id UUID NOT NULL REFERENCES reimbursements(id),
  event_id UUID REFERENCES events(id),
  category_id UUID NOT NULL REFERENCES expense_categories(id),
  expense_date DATE NOT NULL,
  vendor TEXT,
  description TEXT,
  claimed_amount NUMERIC(10,2) NOT NULL,
  approved_amount NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE mileage_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_per_mile NUMERIC(6,3) NOT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TYPE mileage_source AS ENUM (
  'automatic',
  'manual'
);

CREATE TABLE mileage_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reimbursement_id UUID NOT NULL REFERENCES reimbursements(id),
  event_id UUID NOT NULL REFERENCES events(id),
  trip_date DATE NOT NULL,
  source mileage_source NOT NULL,
  claimed_miles NUMERIC(8,2) NOT NULL,
  approved_miles NUMERIC(8,2) NOT NULL,
  mileage_rate_id UUID NOT NULL REFERENCES mileage_rates(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by_user_id UUID NOT NULL REFERENCES users(id),
  file_name TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE expense_attachments (
  expense_id UUID NOT NULL REFERENCES expenses(id),
  attachment_id UUID NOT NULL REFERENCES attachments(id),

  PRIMARY KEY (expense_id, attachment_id)
);

CREATE TYPE reimbursement_attachment_purpose AS ENUM (
  'ezpass_statement',
  'check_stub',
  'other'
);

CREATE TABLE reimbursement_attachments (
  reimbursement_id UUID NOT NULL REFERENCES reimbursements(id),
  attachment_id UUID NOT NULL REFERENCES attachments(id),
  purpose reimbursement_attachment_purpose NOT NULL,

  PRIMARY KEY (reimbursement_id, attachment_id)
);

CREATE TABLE event_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  event_id UUID NOT NULL REFERENCES events(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  action TEXT NOT NULL,
  field_name TEXT,
  old_value TEXT,
  new_value TEXT,
  changed_by_user_id UUID NOT NULL REFERENCES users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE event_assignments (
  event_id UUID NOT NULL REFERENCES events(id),
  user_id UUID NOT NULL REFERENCES users(id),

  PRIMARY KEY (event_id, user_id)
);
