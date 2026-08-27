import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Car,
  CheckCircle2,
  Flag,
  Pencil,
  ReceiptText,
  Save,
  X,
} from "lucide-react";
import { format } from "date-fns";
import {
  correctExpense,
  flagExpense,
  getExpenseCategories,
  submitReimbursement,
  type CurrentReimbursement,
  type ExpenseCategory,
} from "../lib/api";
import "./ReimbursementReview.css";

type ReimbursementReviewProps = {
  userId: string;
  reimbursement: CurrentReimbursement;
  onCancel: () => void;
  onSubmitted: () => void;
  onChanged: () => void;
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

function issueTitle(
  issue: CurrentReimbursement["analysis"]["known_issues"][number],
) {
  if (issue.type === "toll_mismatch") {
    return issue.evidence_amount === 0
      ? `Toll evidence missing · ${issue.event_name}`
      : `Toll mismatch · ${issue.event_name}`;
  }

  if (issue.type === "employee_flag") {
    return `Employee flagged receipt · ${issue.vendor || "Receipt"}${
      issue.event_name ? ` · ${issue.event_name}` : ""
    }`;
  }

  return `Possible duplicate · ${issue.vendor}${
    issue.event_name ? ` · ${issue.event_name}` : ""
  }`;
}

export default function ReimbursementReview({
  userId,
  reimbursement,
  onCancel,
  onSubmitted,
  onChanged,
}: ReimbursementReviewProps) {
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({
    vendor: "",
    expense_date: "",
    category_id: "",
    claimed_amount: "",
    reason: "",
  });
  const [flaggingExpenseId, setFlaggingExpenseId] = useState<string | null>(null);
  const [flagReason, setFlagReason] = useState("");
  const [busyExpenseId, setBusyExpenseId] = useState<string | null>(null);

  useEffect(() => {
    if (reimbursement.status !== "open") return;
    void getExpenseCategories()
      .then((rows) => setCategories(rows.filter((row) => row.is_active)))
      .catch(() => undefined);
  }, [reimbursement.status]);

  const canSubmit =
    reimbursement.status === "open" &&
    reimbursement.analysis.blocker_count === 0;
  const isPaid = reimbursement.status === "paid";
  const issueTitles = reimbursement.analysis.known_issues.map(issueTitle);
  const flaggedExpenseIds = useMemo(
    () => new Set(
      reimbursement.analysis.known_issues
        .filter((issue) => issue.type === "employee_flag" && !issue.resolved)
        .map((issue) => issue.type === "employee_flag" ? issue.expense_id : ""),
    ),
    [reimbursement.analysis.known_issues],
  );

  function beginCorrection(expense: CurrentReimbursement["expenses"][number]) {
    setEditingExpenseId(expense.id);
    setFlaggingExpenseId(null);
    setEditDraft({
      vendor: expense.vendor ?? "",
      expense_date: String(expense.expense_date).slice(0, 10),
      category_id: expense.category_id,
      claimed_amount: String(expense.claimed_amount),
      reason: "",
    });
    setError("");
  }

  async function saveCorrection() {
    if (!editingExpenseId) return;
    const amount = Number(editDraft.claimed_amount);
    if (!editDraft.expense_date || !editDraft.category_id || !Number.isFinite(amount) || amount < 0 || !editDraft.reason.trim()) return;

    try {
      setBusyExpenseId(editingExpenseId);
      setError("");
      await correctExpense(editingExpenseId, {
        user_id: userId,
        vendor: editDraft.vendor.trim() || null,
        expense_date: editDraft.expense_date,
        category_id: editDraft.category_id,
        claimed_amount: amount,
        reason: editDraft.reason.trim(),
      });
      setEditingExpenseId(null);
      onChanged();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Could not correct receipt.");
    } finally {
      setBusyExpenseId(null);
    }
  }

  async function submitFlag(expenseId: string) {
    if (!flagReason.trim()) return;
    try {
      setBusyExpenseId(expenseId);
      setError("");
      await flagExpense(expenseId, userId, flagReason.trim());
      setFlaggingExpenseId(null);
      setFlagReason("");
      onChanged();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Could not flag receipt.");
    } finally {
      setBusyExpenseId(null);
    }
  }

  async function handleSubmit() {
    try {
      setSubmitting(true);
      setError("");

      await submitReimbursement(
        reimbursement.id,
        userId,
        reimbursement.analysis.issue_count > 0,
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

  function renderFinalStatus() {
    if (reimbursement.status === "paid") {
      return (
        <div className="reimbursement-final-status paid">
          <CheckCircle2 size={20} />

          <strong>
            Paid
            {reimbursement.check_number
              ? ` · Check #${reimbursement.check_number}`
              : ""}
          </strong>
        </div>
      );
    }

    if (reimbursement.status === "reviewed") {
      return (
        <div className="reimbursement-final-status reviewed">
          <CheckCircle2 size={20} />

          <strong>Reviewed · Awaiting payment</strong>
        </div>
      );
    }

    return (
      <div className="reimbursement-final-status submitted">
        <CheckCircle2 size={20} />

        <strong>Submitted for review</strong>
      </div>
    );
  }

  return (
    <main
      className={`reimbursement-review ${
        isPaid ? "reimbursement-review-paid" : ""
      }`}
    >
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
            Mileage
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
          reimbursement.expenses.map((expense) => {
            const editing = editingExpenseId === expense.id;
            const flagging = flaggingExpenseId === expense.id;
            const alreadyFlagged = flaggedExpenseIds.has(expense.id);
            const busy = busyExpenseId === expense.id;

            return (
              <article
                className={`reimbursement-review-row receipt-review-row ${editing || flagging ? "expanded" : ""}`}
                key={expense.id}
              >
                <div className="receipt-review-summary">
                  <div>
                    <strong>{expense.vendor || "Expense"}</strong>
                    <span>
                      {expense.category_name}
                      {expense.event_name ? ` · ${expense.event_name}` : ""}
                    </span>
                  </div>
                  <strong>{formatMoney(expense.claimed_amount)}</strong>
                </div>

                <div className="receipt-review-actions">
                  {reimbursement.status === "open" ? (
                    <button type="button" onClick={() => beginCorrection(expense)}>
                      <Pencil size={14} /> Correct
                    </button>
                  ) : alreadyFlagged ? (
                    <span className="receipt-flagged"><Flag size={13} /> Flagged for Jill</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingExpenseId(null);
                        setFlaggingExpenseId(flagging ? null : expense.id);
                        setFlagReason("");
                      }}
                    >
                      <Flag size={14} /> Report mistake
                    </button>
                  )}
                </div>

                {editing && (
                  <div className="receipt-correction-form">
                    <label><span>Vendor</span><input value={editDraft.vendor} onChange={(event) => setEditDraft({ ...editDraft, vendor: event.target.value })} /></label>
                    <label><span>Date</span><input type="date" value={editDraft.expense_date} onChange={(event) => setEditDraft({ ...editDraft, expense_date: event.target.value })} /></label>
                    <label><span>Amount</span><input inputMode="decimal" value={editDraft.claimed_amount} onChange={(event) => setEditDraft({ ...editDraft, claimed_amount: event.target.value })} /></label>
                    <label><span>Category</span><select value={editDraft.category_id} onChange={(event) => setEditDraft({ ...editDraft, category_id: event.target.value })}>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
                    <label className="receipt-correction-reason"><span>Why are you correcting it?</span><input value={editDraft.reason} maxLength={500} onChange={(event) => setEditDraft({ ...editDraft, reason: event.target.value })} placeholder="Required for history" /></label>
                    <div className="receipt-correction-buttons">
                      <button type="button" className="save" disabled={busy || !editDraft.reason.trim()} onClick={() => void saveCorrection()}><Save size={14} /> {busy ? "Saving…" : "Save correction"}</button>
                      <button type="button" onClick={() => setEditingExpenseId(null)}>Cancel</button>
                    </div>
                  </div>
                )}

                {flagging && (
                  <div className="receipt-flag-form">
                    <label><span>What is wrong with this receipt?</span><textarea value={flagReason} maxLength={500} onChange={(event) => setFlagReason(event.target.value)} placeholder="Tell Jill what needs attention" /></label>
                    <div className="receipt-correction-buttons">
                      <button type="button" className="flag" disabled={busy || !flagReason.trim()} onClick={() => void submitFlag(expense.id)}><Flag size={14} /> {busy ? "Sending…" : "Flag for Jill"}</button>
                      <button type="button" onClick={() => setFlaggingExpenseId(null)}>Cancel</button>
                    </div>
                  </div>
                )}
              </article>
            );
          })
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

      {reimbursement.analysis.blocker_count > 0 && (
        <section className="reimbursement-review-blockers">
          <div className="reimbursement-review-analysis-heading">
            <AlertTriangle size={20} />

            <div>
              <strong>Cannot submit yet</strong>
              <span>
                Finish the work and fix required items first.
              </span>
            </div>
          </div>

          {reimbursement.analysis.submission_blockers.map(
            (blocker, index) => (
              <div
                className="reimbursement-review-issue"
                key={`${blocker.type}-${index}`}
              >
                {blocker.type === "active_event" ? (
                  <>
                    <strong>{blocker.event_name} is still active</strong>
                    <span>
                      End the Event before submitting so all receipts, mileage, and tolls can be included.
                    </span>
                  </>
                ) : (
                  <>
                    <strong>
                      {blocker.vendor || "Receipt"} is not attached to an Event
                    </strong>
                    <span>
                      {formatMoney(blocker.claimed_amount)} · Choose the correct Event before submitting.
                    </span>
                  </>
                )}
              </div>
            ),
          )}
        </section>
      )}

      <section className={`reimbursement-review-analysis ${reimbursement.analysis.issue_count > 0 ? "has-issues" : "clean"}`}>
        <div className="reimbursement-review-analysis-heading">
          {reimbursement.analysis.issue_count > 0 ? (
            <AlertTriangle size={20} />
          ) : (
            <CheckCircle2 size={20} />
          )}

          <div>
            {issueTitles.length > 0 ? (
              <div className="reimbursement-review-issue-summary">
                {issueTitles.map((title) => (
                  <strong key={title}>{title}</strong>
                ))}
              </div>
            ) : (
              <strong>No known issues</strong>
            )}
          </div>
        </div>

        {reimbursement.analysis.known_issues.map((issue, index) => (
          <div
            className="reimbursement-review-issue"
            key={`${issue.type}-${index}`}
          >
            {issue.type === "toll_mismatch" ? (
              <>
                <strong>
                  {issue.evidence_amount === 0
                    ? `Toll evidence missing · ${issue.event_name}`
                    : `Toll mismatch · ${issue.event_name}`}
                </strong>
                <span>
                  Planned {formatMoney(issue.planned_amount)} · Evidence {formatMoney(issue.evidence_amount)} · Difference {issue.difference >= 0 ? "+" : ""}{formatMoney(issue.difference)}
                </span>
              </>
            ) : issue.type === "employee_flag" ? (
              <>
                <strong>Receipt flagged for Jill · {issue.vendor || "Receipt"}</strong>
                <span>{issue.reason}{issue.event_name ? ` · ${issue.event_name}` : ""}</span>
              </>
            ) : (
              <>
                <strong>Possible duplicate · {issue.vendor}</strong>
                <span>
                  {issue.count} matching receipts at {formatMoney(issue.claimed_amount)}
                  {issue.event_name ? ` · ${issue.event_name}` : ""}
                </span>
              </>
            )}
          </div>
        ))}
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
              <strong>
                {reimbursement.analysis.issue_count > 0
                  ? `Submit with ${reimbursement.analysis.issue_count === 1 ? "this issue" : "these issues"}?`
                  : "Ready to submit?"}
              </strong>

              <span>
                {reimbursement.analysis.issue_count > 0
                  ? `${issueTitles.join("; ")}. You can submit anyway, and Jill will see the same ${reimbursement.analysis.issue_count === 1 ? "issue" : "issues"}.`
                  : "This sends the completed expense record to Jill for review."}
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
                  : reimbursement.analysis.issue_count > 0
                    ? "Submit anyway"
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
      ) : reimbursement.status === "open" ? (
        <div className="reimbursement-submit-blocked">
          <AlertTriangle size={19} />
          <strong>Finish required items before submitting.</strong>
        </div>
      ) : (
        renderFinalStatus()
      )}
    </main>
  );
}
