CREATE UNIQUE INDEX IF NOT EXISTS
  mileage_entries_one_per_event_day
ON mileage_entries (
  reimbursement_id,
  event_id,
  trip_date
);
