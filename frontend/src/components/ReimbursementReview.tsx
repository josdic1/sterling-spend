import { useState } from "react";
import {
  Car,
  CheckCircle2,
  ReceiptText,
  X,
} from "lucide-react";
import { format } from "date-fns";
import {
  submitReimbursement,
  TEST_EMPLOYEE_ID,
  type CurrentReimbursement,
} from "../lib/api";
import "./ReimbursementReview.css";

type ReimbursementReviewProps = {
  reimbursement: CurrentReimbursement;
  onCancel: () => void;
  onSubmitted: () => void;
};

function formatMoney(value: string | number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value));
}

function formatMonth(year: number, month: number) {
  return format(
    new Date(year, month - 1, 1),
    "MMMM yyyy",
  );
}

export default function ReimbursementReview({
  reimbursement,
  onCancel,
  onSubmitted,
}: ReimbursementReviewProps) {
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");

  const canSubmit = reimbursement.status === "open";

  async function handleSubmit() {
    try {
      setSubmitting(true);
      setError("");

      await submitReimbursement(
        reimbursement.id,
        TEST_EMPLOYEE_ID,
      );

      onSubmitted();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not submit reimbursement.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="reimbursement-review">
      <header className="reimbursement-review-header">
        <div>
          <span>REIMBURSEMENT</span>
          <h1>
            {formatMonth(
              reimbursement.year,
              reimbursement.month,
            )}
          </h1>
        </div>

        <button
          type="button"
          className="reimbursement-review-close"
          onClick={onCancel}
          aria-label="Close"
        >
          <X size={21} />
        </button>
      </header>

      <section className="reimbursement-review-total">
        <span>CLAIMED TOTAL</span>
        <strong>
          {formatMoney(
            reimbursement.totals.claimed_total,
          )}
        </strong>

        <div
          className={`status-pill ${reimbursement.status}`}
        >
          {reimbursement.status}
        </div>
      </section>

      <section className="reimbursement-review-counts">
        <div>
          <ReceiptText size={21} />

          <span>
            <strong>
              {reimbursement.expenses.length}
            </strong>
            Expenses
          </span>
        </div>

        <div>
          <Car size={21} />

          <span>
            <strong>
              {reimbursement.mileage.length}
            </strong>
            Mileage entries
          </span>
        </div>
      </section>

      <section className="reimbursement-review-list">
        <h2>Expenses</h2>

        {reimbursement.expenses.length === 0 ? (
          <p className="reimbursement-review-empty">
            No expenses this month.
          </p>
        ) : (
          reimbursement.expenses.map((expense) => (
            <article
              className="reimbursement-review-row"
              key={expense.id}
            >
              <div>
                <strong>
                  {expense.vendor || "Expense"}
                </strong>

                <span>
                  {expense.category_name}
                  {expense.event_name
                    ? ` · ${expense.event_name}`
                    : ""}
                </span>
              </div>

              <strong>
                {formatMoney(expense.claimed_amount)}
              </strong>
            </article>
          ))
        )}
      </section>

      <section className="reimbursement-review-list">
        <h2>Mileage</h2>

        {reimbursement.mileage.length === 0 ? (
          <p className="reimbursement-review-empty">
            No mileage this month.
          </p>
        ) : (
          reimbursement.mileage.map((entry) => {
            const amount =
              Number(entry.claimed_miles) *
              Number(entry.rate_per_mile);

            return (
              <article
                className="reimbursement-review-row"
                key={entry.id}
              >
                <div>
                  <strong>
                    {entry.claimed_miles} miles
                  </strong>

                  <span>{entry.event_name}</span>
                </div>

                <strong>
                  {formatMoney(amount)}
                </strong>
              </article>
            );
          })
        )}
      </section>

      {error && (
        <p className="reimbursement-review-error">
          {error}
        </p>
      )}

      {canSubmit ? (
        confirming ? (
          <section className="reimbursement-submit-confirm">
            <CheckCircle2 size={25} />

            <div>
              <strong>Ready to submit?</strong>
              <span>
                After submitting, you can no longer add
                receipts, mileage, or tolls to this month.
              </span>
            </div>

            <div className="reimbursement-confirm-actions">
              <button
                type="button"
                className="reimbursement-confirm-cancel"
                disabled={submitting}
                onClick={() => setConfirming(false)}
              >
                Not yet
              </button>

              <button
                type="button"
                className="reimbursement-confirm-submit"
                disabled={submitting}
                onClick={() => {
                  void handleSubmit();
                }}
              >
                {submitting
                  ? "Submitting…"
                  : "Submit"}
              </button>
            </div>
          </section>
        ) : (
          <button
            type="button"
            className="reimbursement-submit"
            onClick={() => setConfirming(true)}
          >
            Submit reimbursement
          </button>
        )
      ) : (
        <div className="reimbursement-locked">
          <CheckCircle2 size={20} />
          This reimbursement has been submitted.
        </div>
      )}
    </main>
  );
}
