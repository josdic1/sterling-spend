-- Active Event travel must exist independently of reimbursement status.
-- event_sessions is the existing backend record for the employee's active/ended
-- Event travel context, so store the automatically calculated travel snapshot here.

ALTER TABLE event_sessions
  ADD COLUMN planned_miles NUMERIC(8,2)
    CHECK (planned_miles IS NULL OR planned_miles >= 0),
  ADD COLUMN planned_tolls_amount NUMERIC(10,2)
    CHECK (planned_tolls_amount IS NULL OR planned_tolls_amount >= 0),
  ADD COLUMN mileage_rate_id UUID REFERENCES mileage_rates(id),
  ADD COLUMN planned_mileage_amount NUMERIC(10,2)
    CHECK (planned_mileage_amount IS NULL OR planned_mileage_amount >= 0),
  ADD COLUMN travel_calculated_at TIMESTAMPTZ;

-- A mileage reimbursement line may point back to the travel activation that
-- produced it. This replaces the false one-entry-per-event/day assumption.
ALTER TABLE mileage_entries
  ADD COLUMN event_session_id UUID REFERENCES event_sessions(id);

DROP INDEX IF EXISTS mileage_entries_one_per_event_day;

CREATE UNIQUE INDEX mileage_entries_one_per_event_session
ON mileage_entries (event_session_id)
WHERE event_session_id IS NOT NULL;
