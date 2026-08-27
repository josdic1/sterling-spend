ALTER TABLE mileage_entries
ADD COLUMN planned_tolls_amount NUMERIC(10,2)
CHECK (
  planned_tolls_amount IS NULL
  OR planned_tolls_amount >= 0
);
