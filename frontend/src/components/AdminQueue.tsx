import { useEffect, useState } from "react";
import {
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Monitor,
  Smartphone,
  X,
} from "lucide-react";
import { format } from "date-fns";
import {
  getAdminPaidReimbursements,
  getAdminReimbursementQueue,
  TEST_ADMIN_ID,
  type AdminReimbursementQueueItem,
} from "../lib/api";
import "./AdminQueue.css";

type AdminQueueProps = {
  onClose: () => void;
  onOpenReimbursement: (reimbursementId: string) => void;
};

type AdminViewMode = "mobile" | "web";
type AdminQueueSection = "review" | "paid";

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

function formatPaidDate(value: string | null) {
  if (!value) {
    return "";
  }

  return format(new Date(value), "MMM d, yyyy");
}

export default function AdminQueue({
  onClose,
  onOpenReimbursement,
}: AdminQueueProps) {
  const [reviewItems, setReviewItems] = useState<
    AdminReimbursementQueueItem[]
  >([]);

  const [paidItems, setPaidItems] = useState<
    AdminReimbursementQueueItem[]
  >([]);

  const [section, setSection] =
    useState<AdminQueueSection>("review");

  const [viewMode, setViewMode] =
    useState<AdminViewMode>(() =>
      window.matchMedia("(min-width: 760px)").matches
        ? "web"
        : "mobile",
    );

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadReimbursements() {
      try {
        setLoading(true);
        setError("");

        const [queueResult, paidResult] =
          await Promise.all([
            getAdminReimbursementQueue(
              TEST_ADMIN_ID,
            ),
            getAdminPaidReimbursements(
              TEST_ADMIN_ID,
            ),
          ]);

        setReviewItems(queueResult);
        setPaidItems(paidResult);
      } catch (caughtError) {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "Could not load reimbursements.",
        );
      } finally {
        setLoading(false);
      }
    }

    void loadReimbursements();
  }, []);

  const items =
    section === "review"
      ? reviewItems
      : paidItems;

  return (
    <main
      className={`admin-queue admin-queue-${viewMode}`}
    >
      <header className="admin-queue-header">
        <div>
          <span>CONTROLLER</span>
          <h1>Reimbursements</h1>
        </div>

        <button
          type="button"
          className="admin-queue-close"
          onClick={onClose}
          aria-label="Close admin"
        >
          <X size={21} />
        </button>
      </header>

      <nav
        className="admin-queue-sections"
        aria-label="Reimbursement status"
      >
        <button
          type="button"
          className={
            section === "review" ? "active" : ""
          }
          onClick={() => setSection("review")}
        >
          Needs review
          <span>{reviewItems.length}</span>
        </button>

        <button
          type="button"
          className={
            section === "paid" ? "active" : ""
          }
          onClick={() => setSection("paid")}
        >
          Paid
          <span>{paidItems.length}</span>
        </button>
      </nav>

      <div className="admin-view-toggle">
        <button
          type="button"
          className={
            viewMode === "mobile" ? "active" : ""
          }
          onClick={() => setViewMode("mobile")}
        >
          <Smartphone size={16} />
          Mobile
        </button>

        <button
          type="button"
          className={
            viewMode === "web" ? "active" : ""
          }
          onClick={() => setViewMode("web")}
        >
          <Monitor size={16} />
          Web
        </button>
      </div>

      {loading ? (
        <div className="admin-queue-message">
          Loading reimbursements…
        </div>
      ) : error ? (
        <div className="admin-queue-message admin-queue-error">
          {error}
        </div>
      ) : items.length === 0 ? (
        <div className="admin-queue-message">
          {section === "review" ? (
            <>
              <ClipboardCheck size={28} />
              <strong>Nothing waiting for review</strong>
              <span>
                Submitted reimbursements will appear here.
              </span>
            </>
          ) : (
            <>
              <CheckCircle2 size={28} />
              <strong>No paid reimbursements yet</strong>
              <span>
                Completed reimbursements will appear here.
              </span>
            </>
          )}
        </div>
      ) : viewMode === "mobile" ? (
        <section className="admin-queue-cards">
          {items.map((item) => (
            <button
              type="button"
              className="admin-queue-card"
              key={item.id}
              onClick={() =>
                onOpenReimbursement(item.id)
              }
            >
              <div className="admin-queue-card-top">
                <div>
                  <span>
                    {formatMonth(item.year, item.month)}
                  </span>

                  <h2>{item.employee_name}</h2>
                </div>

                <span
                  className={`status-pill ${item.status}`}
                >
                  {item.status}
                </span>
              </div>

              <div className="admin-queue-card-stats">
                <div>
                  <span>
                    {section === "paid"
                      ? "Approved"
                      : "Claimed"}
                  </span>

                  <strong>
                    {formatMoney(
                      section === "paid"
                        ? item.approved_total
                        : item.claimed_total,
                    )}
                  </strong>
                </div>

                <div>
                  <span>Expenses</span>
                  <strong>{item.expense_count}</strong>
                </div>

                <div>
                  <span>Mileage</span>
                  <strong>{item.mileage_count}</strong>
                </div>
              </div>

              <div className="admin-queue-card-footer">
                <span>
                  {section === "paid"
                    ? `Check #${item.check_number ?? "—"} · ${formatPaidDate(
                        item.paid_at,
                      )}`
                    : item.employee_email}
                </span>

                <ChevronRight size={19} />
              </div>
            </button>
          ))}
        </section>
      ) : (
        <section className="admin-queue-table-card">
          <table className="admin-queue-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Month</th>
                <th>Status</th>
                <th>Expenses</th>
                <th>Mileage</th>
                <th>Claimed</th>
                <th>Approved</th>
                {section === "paid" && (
                  <th>Check</th>
                )}
                <th />
              </tr>
            </thead>

            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.employee_name}</strong>
                    <span>{item.employee_email}</span>
                  </td>

                  <td>
                    {formatMonth(item.year, item.month)}
                  </td>

                  <td>
                    <span
                      className={`status-pill ${item.status}`}
                    >
                      {item.status}
                    </span>
                  </td>

                  <td>{item.expense_count}</td>
                  <td>{item.mileage_count}</td>

                  <td>
                    {formatMoney(item.claimed_total)}
                  </td>

                  <td>
                    {formatMoney(item.approved_total)}
                  </td>

                  {section === "paid" && (
                    <td>
                      #{item.check_number ?? "—"}
                    </td>
                  )}

                  <td>
                    <button
                      type="button"
                      className="admin-queue-open"
                      onClick={() =>
                        onOpenReimbursement(item.id)
                      }
                      aria-label={`Open ${item.employee_name}`}
                    >
                      <ChevronRight size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
