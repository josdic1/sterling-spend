-- A submitted/reviewed/paid reimbursement is historical and must stay closed.
-- New employee activity must still be capturable afterward.
-- Keep at most one OPEN working reimbursement for a user/period, while allowing
-- multiple closed historical submissions in the same period.

ALTER TABLE reimbursements
DROP CONSTRAINT IF EXISTS reimbursements_user_id_year_month_key;

CREATE UNIQUE INDEX IF NOT EXISTS reimbursements_one_open_per_user_period_idx
ON reimbursements (user_id, year, month)
WHERE status = 'open';

CREATE INDEX IF NOT EXISTS reimbursements_user_period_created_idx
ON reimbursements (user_id, year, month, created_at DESC);
