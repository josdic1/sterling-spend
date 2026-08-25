import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Car,
  CheckCircle2,
  ReceiptText,
} from "lucide-react";
import { format } from "date-fns";
import {
  getAdminReimbursementDetail,
  reviewReimbursement,
  TEST_ADMIN_ID,
  updateApprovedExpenseAmount,
  updateApprovedMileage,
  type AdminReimbursementDetail as AdminReimbursementDetailData,
} from "../lib/api";
import "./AdminReimbursementDetail.css";

type AdminReimbursementDetailProps = {
  reimbursementId: string;
  onBack: () => void;
  onReviewed: () => void;
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

export default function AdminReimbursementDetail({
  reimbursementId,
  onBack,
  onReviewed,
}: AdminReimbursementDetailProps) {
  const [detail, setDetail] =
    useState<AdminReimbursementDetailData | null>(null);

  const [expenseValues, setExpenseValues] = useState<
    Record<string, string>
  >({});

  const [mileageValues, setMileageValues] = useState<
    Record<string, string>
  >({});

  const [savingId, setSavingId] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadDetail = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const result =
        await getAdminReimbursementDetail(
          reimbursementId,
          TEST_ADMIN_ID,
        );

      setDetail(result);

      setExpenseValues(
        Object.fromEntries(
          result.expenses.map((expense) => [
            expense.id,
            expense.approved_amount,
          ]),
        ),
      );

      setMileageValues(
        Object.fromEntries(
          result.mileage.map((entry) => [
            entry.id,
            entry.approved_miles,
          ]),
        ),
      );
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not load reimbursement.",
      );
    } finally {
      setLoading(false);
    }
  }, [reimbursementId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  async function saveExpense(
    expenseId: string,
  ) {
    const value = expenseValues[expenseId];

    if (value === undefined || value === "") {
      return;
    }

    try {
      setSavingId(expenseId);
      setError("");

      await updateApprovedExpenseAmount(
        expenseId,
        value,
        TEST_ADMIN_ID,
      );

      await loadDetail();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not update expense.",
      );
    } finally {
      setSavingId("");
    }
  }

  async function saveMileage(
    mileageId: string,
  ) {
    const value = mileageValues[mileageId];

    if (value === undefined || value === "") {
      return;
    }

    try {
      setSavingId(mileageId);
      setError("");

      await updateApprovedMileage(
        mileageId,
        value,
        TEST_ADMIN_ID,
      );

      await loadDetail();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not update mileage.",
      );
    } finally {
      setSavingId("");
    }
  }

  async function handleReview() {
    if (!detail) {
      return;
    }

    try {
      setReviewing(true);
      setError("");

      await reviewReimbursement(
        detail.id,
        TEST_ADMIN_ID,
      );

      await loadDetail();
      onReviewed();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not mark reimbursement reviewed.",
      );
    } finally {
      setReviewing(false);
    }
  }

  if (loading && !detail) {
    return (
      <main className="admin-detail">
        <div className="admin-detail-message">
          Loading reimbursement…
        </div>
      </main>
    );
  }

  if (!detail) {
    return (
      <main className="admin-detail">
        <div className="admin-detail-message">
          {error || "Reimbursement not found."}
        </div>
      </main>
    );
  }

  const editable = detail.status !== "paid";

  return (
    <main className="admin-detail">
      <header className="admin-detail-header">
        <button
          type="button"
          className="admin-detail-back"
          onClick={onBack}
        >
          <ArrowLeft size={18} />
          Queue
        </button>

        <div className="admin-detail-title">
          <span>CONTROLLER REVIEW</span>
          <h1>{detail.employee_name}</h1>
          <p>
            {formatMonth(detail.year, detail.month)}
            {" · "}
            {detail.employee_email}
          </p>
        </div>

        <span
          className={`status-pill ${detail.status}`}
        >
          {detail.status}
        </span>
      </header>

      <section className="admin-detail-summary">
        <div>
          <span>Claimed</span>
          <strong>
            {formatMoney(detail.totals.claimed_total)}
          </strong>
        </div>

        <div>
          <span>Approved</span>
          <strong>
            {formatMoney(detail.totals.approved_total)}
          </strong>
        </div>

        <div>
          <span>Expenses</span>
          <strong>{detail.expenses.length}</strong>
        </div>

        <div>
          <span>Mileage</span>
          <strong>{detail.mileage.length}</strong>
        </div>
      </section>

      {error && (
        <p className="admin-detail-error">
          {error}
        </p>
      )}

      <section className="admin-detail-section">
        <div className="admin-detail-section-heading">
          <ReceiptText size={20} />

          <div>
            <h2>Expenses</h2>
            <span>
              Adjust only when the submitted amount
              needs correction.
            </span>
          </div>
        </div>

        <div className="admin-detail-list">
          {detail.expenses.map((expense) => {
            const changed =
              expenseValues[expense.id] !==
              expense.approved_amount;

            return (
              <article
                className="admin-detail-row"
                key={expense.id}
              >
                <div className="admin-detail-row-copy">
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

                <div className="admin-detail-claimed">
                  <span>Claimed</span>
                  <strong>
                    {formatMoney(expense.claimed_amount)}
                  </strong>
                </div>

                <label className="admin-detail-approved">
                  <span>Approved</span>

                  <div>
                    <span>$</span>

                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      disabled={!editable}
                      value={
                        expenseValues[expense.id] ?? ""
                      }
                      onChange={(event) =>
                        setExpenseValues((current) => ({
                          ...current,
                          [expense.id]:
                            event.target.value,
                        }))
                      }
                    />
                  </div>
                </label>

                <button
                  type="button"
                  className="admin-detail-save"
                  disabled={
                    !editable ||
                    !changed ||
                    savingId !== ""
                  }
                  onClick={() => {
                    void saveExpense(expense.id);
                  }}
                >
                  {savingId === expense.id
                    ? "Saving…"
                    : "Save"}
                </button>
              </article>
            );
          })}
        </div>
      </section>

      <section className="admin-detail-section">
        <div className="admin-detail-section-heading">
          <Car size={20} />

          <div>
            <h2>Mileage</h2>
            <span>
              Approved reimbursement uses the mileage
              rate stored with each trip.
            </span>
          </div>
        </div>

        <div className="admin-detail-list">
          {detail.mileage.map((entry) => {
            const changed =
              mileageValues[entry.id] !==
              entry.approved_miles;

            const claimedAmount =
              Number(entry.claimed_miles) *
              Number(entry.rate_per_mile);

            const approvedAmount =
              Number(
                mileageValues[entry.id] ??
                  entry.approved_miles,
              ) * Number(entry.rate_per_mile);

            return (
              <article
                className="admin-detail-row"
                key={entry.id}
              >
                <div className="admin-detail-row-copy">
                  <strong>
                    {entry.event_name}
                  </strong>

                  <span>
                    {entry.event_number}
                    {" · "}
                    {entry.rate_per_mile}/mi
                  </span>
                </div>

                <div className="admin-detail-claimed">
                  <span>Claimed</span>
                  <strong>
                    {entry.claimed_miles} mi
                  </strong>
                  <small>
                    {formatMoney(claimedAmount)}
                  </small>
                </div>

                <label className="admin-detail-approved">
                  <span>Approved miles</span>

                  <div>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.1"
                      disabled={!editable}
                      value={
                        mileageValues[entry.id] ?? ""
                      }
                      onChange={(event) =>
                        setMileageValues((current) => ({
                          ...current,
                          [entry.id]:
                            event.target.value,
                        }))
                      }
                    />

                    <span>mi</span>
                  </div>

                  <small>
                    {formatMoney(approvedAmount)}
                  </small>
                </label>

                <button
                  type="button"
                  className="admin-detail-save"
                  disabled={
                    !editable ||
                    !changed ||
                    savingId !== ""
                  }
                  onClick={() => {
                    void saveMileage(entry.id);
                  }}
                >
                  {savingId === entry.id
                    ? "Saving…"
                    : "Save"}
                </button>
              </article>
            );
          })}
        </div>
      </section>

      {detail.status === "submitted" ? (
        <button
          type="button"
          className="admin-detail-review"
          disabled={reviewing || savingId !== ""}
          onClick={() => {
            void handleReview();
          }}
        >
          <CheckCircle2 size={19} />
          {reviewing
            ? "Marking reviewed…"
            : "Mark reimbursement reviewed"}
        </button>
      ) : (
        <div className="admin-detail-reviewed">
          <CheckCircle2 size={20} />
          Reimbursement reviewed
        </div>
      )}
    </main>
  );
}
