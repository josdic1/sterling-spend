import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  Car,
  CheckCircle2,
  FileText,
  ReceiptText,
  Upload,
} from "lucide-react";
import { format } from "date-fns";
import {
  addReimbursementNote,
  getAdminReimbursementDetail,
  getReimbursementAttachments,
  payReimbursement,
  resolveReimbursementIssue,
  reviewReimbursement,
  updateApprovedExpenseAmount,
  updateApprovedMileage,
  uploadCheckStub,
  type AdminReimbursementDetail as AdminReimbursementDetailData,
  type ReimbursementAttachment,
} from "../lib/api";
import "./AdminReimbursementDetail.css";

type AdminReimbursementDetailProps = {
  adminUserId: string;
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

function formatAttachmentDate(value: string) {
  return format(new Date(value), "MMM d, yyyy");
}

function formatFileSize(value: number) {
  if (value < 1024 * 1024) {
    return `${Math.max(1, Math.round(value / 1024))} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function adminIssueTitle(
  issue: AdminReimbursementDetailData["analysis"]["known_issues"][number],
) {
  if (issue.type === "toll_mismatch") {
    return `${issue.evidence_amount === 0 ? "Toll evidence missing" : "Toll mismatch"} · ${issue.event_name}`;
  }

  return `Possible duplicate · ${issue.vendor}${
    issue.event_name ? ` · ${issue.event_name}` : ""
  }`;
}

export default function AdminReimbursementDetail({
  adminUserId,
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

  const [expenseReasons, setExpenseReasons] = useState<
    Record<string, string>
  >({});

  const [mileageReasons, setMileageReasons] = useState<
    Record<string, string>
  >({});

  const [issueReasons, setIssueReasons] = useState<
    Record<string, string>
  >({});

  const [reviewNote, setReviewNote] = useState("");

  const [attachments, setAttachments] = useState<
    ReimbursementAttachment[]
  >([]);

  const [checkNumber, setCheckNumber] = useState("");
  const [confirmingPayment, setConfirmingPayment] =
    useState(false);

  const [selectedCheckStub, setSelectedCheckStub] =
    useState<File | null>(null);

  const checkStubInputRef =
    useRef<HTMLInputElement | null>(null);

  const [savingId, setSavingId] = useState("");
  const [resolvingIssueKey, setResolvingIssueKey] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [uploadingCheckStub, setUploadingCheckStub] =
    useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attachmentError, setAttachmentError] =
    useState("");

  const loadDetail = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const result =
        await getAdminReimbursementDetail(
          reimbursementId,
          adminUserId,
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

      if (result.check_number) {
        setCheckNumber(result.check_number);
      }
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

  const loadAttachments = useCallback(async () => {
    try {
      setAttachmentError("");

      const result =
        await getReimbursementAttachments(
          reimbursementId,
          adminUserId,
        );

      setAttachments(result);
    } catch (caughtError) {
      setAttachmentError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not load attachments.",
      );
    }
  }, [reimbursementId]);

  useEffect(() => {
    void loadDetail();
    void loadAttachments();
  }, [loadDetail, loadAttachments]);

  async function saveExpense(expenseId: string) {
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
        adminUserId,
        expenseReasons[expenseId]?.trim() ?? "",
      );

      setExpenseReasons((current) => ({
        ...current,
        [expenseId]: "",
      }));

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

  async function saveMileage(mileageId: string) {
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
        adminUserId,
        mileageReasons[mileageId]?.trim() ?? "",
      );

      setMileageReasons((current) => ({
        ...current,
        [mileageId]: "",
      }));

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

  async function disallowExpense(expenseId: string) {
    const reason = expenseReasons[expenseId]?.trim() ?? "";

    if (!reason) {
      setError("A reason is required to disallow an expense.");
      return;
    }

    try {
      setSavingId(expenseId);
      setError("");

      await updateApprovedExpenseAmount(
        expenseId,
        "0",
        adminUserId,
        reason,
      );

      setExpenseReasons((current) => ({
        ...current,
        [expenseId]: "",
      }));

      await loadDetail();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not disallow expense.",
      );
    } finally {
      setSavingId("");
    }
  }

  async function disallowMileage(mileageId: string) {
    const reason = mileageReasons[mileageId]?.trim() ?? "";

    if (!reason) {
      setError("A reason is required to disallow mileage.");
      return;
    }

    try {
      setSavingId(mileageId);
      setError("");

      await updateApprovedMileage(
        mileageId,
        "0",
        adminUserId,
        reason,
      );

      setMileageReasons((current) => ({
        ...current,
        [mileageId]: "",
      }));

      await loadDetail();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not disallow mileage.",
      );
    } finally {
      setSavingId("");
    }
  }

  async function handleResolveIssue(issueKey: string) {
    const reason = issueReasons[issueKey]?.trim() ?? "";

    if (!detail || !reason) {
      setError("A resolution note is required.");
      return;
    }

    try {
      setResolvingIssueKey(issueKey);
      setError("");

      await resolveReimbursementIssue(
        detail.id,
        adminUserId,
        issueKey,
        reason,
      );

      setIssueReasons((current) => ({
        ...current,
        [issueKey]: "",
      }));

      await loadDetail();
      onReviewed();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not resolve issue.",
      );
    } finally {
      setResolvingIssueKey("");
    }
  }

  async function handleAddNote() {
    const note = reviewNote.trim();

    if (!detail || !note) {
      return;
    }

    try {
      setAddingNote(true);
      setError("");

      await addReimbursementNote(
        detail.id,
        adminUserId,
        note,
      );

      setReviewNote("");
      await loadDetail();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not add note.",
      );
    } finally {
      setAddingNote(false);
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
        adminUserId,
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

  async function handlePay() {
    if (!detail || !checkNumber.trim()) {
      setError("Check number is required.");
      return;
    }

    try {
      setPaying(true);
      setError("");

      await payReimbursement(
        detail.id,
        adminUserId,
        checkNumber.trim(),
      );

      setConfirmingPayment(false);
      await loadDetail();
      await loadAttachments();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not mark reimbursement paid.",
      );
    } finally {
      setPaying(false);
    }
  }

  async function handleCheckStubUpload() {
    if (!detail || !selectedCheckStub) {
      return;
    }

    try {
      setUploadingCheckStub(true);
      setAttachmentError("");

      await uploadCheckStub(
        detail.id,
        adminUserId,
        selectedCheckStub,
      );

      setSelectedCheckStub(null);

      if (checkStubInputRef.current) {
        checkStubInputRef.current.value = "";
      }

      await loadAttachments();
    } catch (caughtError) {
      setAttachmentError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not upload check stub.",
      );
    } finally {
      setUploadingCheckStub(false);
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

  const checkStubs = attachments.filter(
    (attachment) =>
      attachment.purpose === "check_stub",
  );

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
        <p className="admin-detail-error">{error}</p>
      )}

      {detail.analysis.blocker_count > 0 && (
        <section className="admin-detail-known-issues admin-detail-blockers">
          <div className="admin-detail-known-issues-heading">
            <AlertTriangle size={20} />
            <div>
              <strong>Required items need correction</strong>
              <span>This record contains data that should never have been submitted.</span>
            </div>
          </div>

          {detail.analysis.submission_blockers.map((blocker, index) => (
            <div className="admin-detail-known-issue" key={`${blocker.type}-${index}`}>
              {blocker.type === "unassigned_expense" ? (
                <>
                  <strong>{blocker.vendor || "Receipt"} · No Event</strong>
                  <span>{formatMoney(blocker.claimed_amount)} · This receipt must be associated with an Event.</span>
                </>
              ) : (
                <>
                  <strong>{blocker.event_name} is still active</strong>
                  <span>The employee must finish the Event before submission.</span>
                </>
              )}
            </div>
          ))}
        </section>
      )}

      {detail.analysis.issue_count > 0 && (
        <section className="admin-detail-known-issues">
          <div className="admin-detail-known-issues-heading">
            <AlertTriangle size={20} />
            <div>
              {detail.analysis.unresolved_issue_count > 0 ? (
                <div className="admin-detail-issue-summary">
                  {detail.analysis.known_issues
                    .filter((issue) => !issue.resolved)
                    .map((issue) => (
                      <strong key={issue.issue_key}>{adminIssueTitle(issue)}</strong>
                    ))}
                </div>
              ) : (
                <strong>All known issues resolved</strong>
              )}
              <span>Employee saw these same issues before submission.</span>
            </div>
          </div>

          {detail.analysis.known_issues.map((issue) => (
            <div
              className={`admin-detail-known-issue ${issue.resolved ? "resolved" : "unresolved"}`}
              key={issue.issue_key}
            >
              {issue.type === "toll_mismatch" ? (
                <>
                  <strong>
                    {issue.event_name} · {issue.evidence_amount === 0 ? "Missing toll evidence" : "Toll mismatch"}
                  </strong>
                  <span>
                    Planned {formatMoney(issue.planned_amount)} · Evidence {formatMoney(issue.evidence_amount)} · Difference {issue.difference >= 0 ? "+" : ""}{formatMoney(issue.difference)}
                  </span>
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

              {issue.resolved ? (
                <div className="admin-issue-resolution">
                  <CheckCircle2 size={16} />
                  <div>
                    <strong>Resolved</strong>
                    <span>{issue.resolution_reason}</span>
                    {issue.resolved_by_name && issue.resolved_at && (
                      <small>
                        {issue.resolved_by_name} · {format(new Date(issue.resolved_at), "MMM d, yyyy h:mm a")}
                      </small>
                    )}
                  </div>
                </div>
              ) : detail.status === "submitted" ? (
                <div className="admin-issue-actions">
                  <input
                    type="text"
                    maxLength={500}
                    placeholder="How was this resolved?"
                    value={issueReasons[issue.issue_key] ?? ""}
                    onChange={(event) =>
                      setIssueReasons((current) => ({
                        ...current,
                        [issue.issue_key]: event.target.value,
                      }))
                    }
                  />

                  <button
                    type="button"
                    disabled={
                      !(issueReasons[issue.issue_key]?.trim()) ||
                      resolvingIssueKey !== ""
                    }
                    onClick={() => {
                      void handleResolveIssue(issue.issue_key);
                    }}
                  >
                    {resolvingIssueKey === issue.issue_key
                      ? "Resolving…"
                      : "Resolve issue"}
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </section>
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

                {editable && (
                  <label className="admin-detail-reason">
                    <span>Reason for adjustment or disallow</span>
                    <input
                      type="text"
                      maxLength={500}
                      placeholder="Why is this changing?"
                      value={expenseReasons[expense.id] ?? ""}
                      onChange={(event) =>
                        setExpenseReasons((current) => ({
                          ...current,
                          [expense.id]: event.target.value,
                        }))
                      }
                    />
                  </label>
                )}

                <div className="admin-detail-item-actions">
                  <button
                    type="button"
                    className="admin-detail-save"
                    disabled={
                      !editable ||
                      !changed ||
                      !(expenseReasons[expense.id]?.trim()) ||
                      savingId !== ""
                    }
                    onClick={() => {
                      void saveExpense(expense.id);
                    }}
                  >
                    {savingId === expense.id
                      ? "Saving…"
                      : "Save adjustment"}
                  </button>

                  <button
                    type="button"
                    className="admin-detail-disallow"
                    disabled={
                      !editable ||
                      Number(expense.approved_amount) === 0 ||
                      !(expenseReasons[expense.id]?.trim()) ||
                      savingId !== ""
                    }
                    onClick={() => {
                      void disallowExpense(expense.id);
                    }}
                  >
                    Disallow
                  </button>
                </div>
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
                  <strong>{entry.event_name}</strong>

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

                {editable && (
                  <label className="admin-detail-reason">
                    <span>Reason for adjustment or disallow</span>
                    <input
                      type="text"
                      maxLength={500}
                      placeholder="Why is this changing?"
                      value={mileageReasons[entry.id] ?? ""}
                      onChange={(event) =>
                        setMileageReasons((current) => ({
                          ...current,
                          [entry.id]: event.target.value,
                        }))
                      }
                    />
                  </label>
                )}

                <div className="admin-detail-item-actions">
                  <button
                    type="button"
                    className="admin-detail-save"
                    disabled={
                      !editable ||
                      !changed ||
                      !(mileageReasons[entry.id]?.trim()) ||
                      savingId !== ""
                    }
                    onClick={() => {
                      void saveMileage(entry.id);
                    }}
                  >
                    {savingId === entry.id
                      ? "Saving…"
                      : "Save adjustment"}
                  </button>

                  <button
                    type="button"
                    className="admin-detail-disallow"
                    disabled={
                      !editable ||
                      Number(entry.approved_miles) === 0 ||
                      !(mileageReasons[entry.id]?.trim()) ||
                      savingId !== ""
                    }
                    onClick={() => {
                      void disallowMileage(entry.id);
                    }}
                  >
                    Disallow
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="admin-detail-section">
        <div className="admin-detail-section-heading">
          <FileText size={20} />
          <div>
            <h2>Admin notes</h2>
            <span>Add context without changing the employee's original claim.</span>
          </div>
        </div>

        {editable && (
          <div className="admin-note-entry">
            <textarea
              maxLength={1000}
              rows={3}
              placeholder="Add a review note…"
              value={reviewNote}
              onChange={(event) => setReviewNote(event.target.value)}
            />
            <button
              type="button"
              disabled={!reviewNote.trim() || addingNote}
              onClick={() => {
                void handleAddNote();
              }}
            >
              {addingNote ? "Adding…" : "Add note"}
            </button>
          </div>
        )}

        {detail.notes.length > 0 ? (
          <div className="admin-note-history">
            {detail.notes.map((note) => (
              <article key={note.id}>
                <p>{note.note}</p>
                <small>
                  {note.changed_by_name} · {format(new Date(note.changed_at), "MMM d, yyyy h:mm a")}
                </small>
              </article>
            ))}
          </div>
        ) : (
          <p className="admin-note-empty">No admin notes yet.</p>
        )}
      </section>

      {detail.adjustments.length > 0 && (
        <section className="admin-detail-section">
          <div className="admin-detail-section-heading">
            <FileText size={20} />
            <div>
              <h2>Adjustment history</h2>
              <span>Original claim remains intact. Every admin change is recorded.</span>
            </div>
          </div>

          <div className="admin-adjustment-history">
            {detail.adjustments.map((adjustment) => (
              <article key={adjustment.id}>
                <div>
                  <strong>{adjustment.item_name}</strong>
                  <span>
                    {adjustment.entity_type === "mileage"
                      ? `${adjustment.old_value ?? "—"} mi → ${adjustment.new_value ?? "—"} mi`
                      : `${formatMoney(adjustment.old_value ?? 0)} → ${formatMoney(adjustment.new_value ?? 0)}`}
                  </span>
                </div>
                <p>
                  {adjustment.reason || "Historical adjustment — no reason was recorded before reasons were required."}
                </p>
                <small>
                  {adjustment.changed_by_name} · {format(new Date(adjustment.changed_at), "MMM d, yyyy h:mm a")}
                </small>
              </article>
            ))}
          </div>
        </section>
      )}

      {detail.status === "submitted" && (
        <button
          type="button"
          className="admin-detail-review"
          disabled={
            reviewing ||
            savingId !== "" ||
            resolvingIssueKey !== "" ||
            detail.analysis.blocker_count > 0 ||
            detail.analysis.unresolved_issue_count > 0
          }
          onClick={() => {
            void handleReview();
          }}
        >
          <CheckCircle2 size={19} />
          {reviewing
            ? "Marking reviewed…"
            : detail.analysis.blocker_count > 0
              ? "Fix required items before review"
              : detail.analysis.unresolved_issue_count > 0
                ? "Resolve issues before review"
                : "Approve / mark reviewed"}
        </button>
      )}

      {detail.status === "reviewed" && (
        <section className="admin-payment">
          <div className="admin-payment-heading">
            <Banknote size={22} />

            <div>
              <strong>Record payment</strong>
              <span>
                Enter the QuickBooks check number after
                the reimbursement has been paid.
              </span>
            </div>
          </div>

          <label className="admin-payment-field">
            <span>Check number</span>

            <input
              type="text"
              inputMode="numeric"
              placeholder="e.g. 10482"
              value={checkNumber}
              onChange={(event) =>
                setCheckNumber(event.target.value)
              }
            />
          </label>

          {confirmingPayment ? (
            <div className="admin-payment-confirm">
              <strong>
                Mark this reimbursement paid?
              </strong>

              <span>
                Paid reimbursements are permanently locked.
              </span>

              <div>
                <button
                  type="button"
                  disabled={paying}
                  onClick={() =>
                    setConfirmingPayment(false)
                  }
                >
                  Cancel
                </button>

                <button
                  type="button"
                  className="admin-payment-confirm-pay"
                  disabled={paying}
                  onClick={() => {
                    void handlePay();
                  }}
                >
                  {paying ? "Saving…" : "Mark paid"}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="admin-detail-pay"
              disabled={!checkNumber.trim()}
              onClick={() =>
                setConfirmingPayment(true)
              }
            >
              <Banknote size={19} />
              Mark reimbursement paid
            </button>
          )}
        </section>
      )}

      {detail.status === "paid" && (
        <>
          <div className="admin-detail-reviewed">
            <CheckCircle2 size={20} />

            <div>
              <strong>Reimbursement paid</strong>
              <span>
                Check #{detail.check_number}
              </span>
            </div>
          </div>

          <section className="admin-check-stub">
            <div className="admin-check-stub-heading">
              <FileText size={22} />

              <div>
                <strong>QuickBooks check stub</strong>
                <span>
                  Attach the check stub to complete the
                  reimbursement packet.
                </span>
              </div>
            </div>

            {checkStubs.length > 0 && (
              <div className="admin-check-stub-files">
                {checkStubs.map((attachment) => (
                  <div
                    className="admin-check-stub-file"
                    key={attachment.id}
                  >
                    <FileText size={18} />

                    <div>
                      <strong>
                        {attachment.file_name}
                      </strong>

                      <span>
                        {formatAttachmentDate(
                          attachment.created_at,
                        )}
                        {" · "}
                        {formatFileSize(
                          Number(
                            attachment.file_size_bytes,
                          ),
                        )}
                      </span>
                    </div>

                    <CheckCircle2 size={18} />
                  </div>
                ))}
              </div>
            )}

            <div className="admin-check-stub-upload">
              <input
                ref={checkStubInputRef}
                id="check-stub-file"
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={(event) => {
                  setSelectedCheckStub(
                    event.target.files?.[0] ?? null,
                  );
                  setAttachmentError("");
                }}
              />

              <label htmlFor="check-stub-file">
                <Upload size={18} />

                {selectedCheckStub
                  ? selectedCheckStub.name
                  : checkStubs.length > 0
                    ? "Choose another check stub"
                    : "Choose check stub"}
              </label>

              <button
                type="button"
                disabled={
                  !selectedCheckStub ||
                  uploadingCheckStub
                }
                onClick={() => {
                  void handleCheckStubUpload();
                }}
              >
                {uploadingCheckStub
                  ? "Uploading…"
                  : checkStubs.length > 0
                    ? "Add check stub"
                    : "Upload check stub"}
              </button>
            </div>

            <span className="admin-check-stub-help">
              PDF, JPEG, PNG, or WebP.
            </span>

            {attachmentError && (
              <p className="admin-check-stub-error">
                {attachmentError}
              </p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
