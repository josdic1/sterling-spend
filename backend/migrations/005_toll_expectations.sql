CREATE TYPE toll_expectation_status AS ENUM (
  'pending_evidence',
  'verified'
);

CREATE TABLE toll_expectations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  reimbursement_id UUID NOT NULL
    REFERENCES reimbursements(id),

  mileage_entry_id UUID NOT NULL
    REFERENCES mileage_entries(id),

  event_id UUID NOT NULL
    REFERENCES events(id),

  trip_date DATE NOT NULL,

  outbound_estimated_amount NUMERIC(10,2),
  return_estimated_amount NUMERIC(10,2),
  round_trip_estimated_amount NUMERIC(10,2),

  currency_code TEXT,

  status toll_expectation_status NOT NULL
    DEFAULT 'pending_evidence',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (mileage_entry_id)
);
