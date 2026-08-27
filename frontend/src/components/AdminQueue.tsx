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
import AdminPeople from "./AdminPeople";
import AdminEvents from "./AdminEvents";
import AdminTodayDetail from "./AdminTodayDetail";
import ThemeToggle from "./ThemeToggle";
import {
  getAdminActivationStatus,
  getAdminPaidReimbursements,
  getAdminReimbursementQueue,
  type AdminActivationStatus,
  type AdminReimbursementQueueItem,
} from "../lib/api";
import "./AdminQueue.css";

type AdminQueueProps = {
  adminUserId: string;
  onClose: () => void;
  onOpenReimbursement: (reimbursementId: string) => void;
};

type AdminViewMode = "mobile" | "web";
type AdminQueueSection =
  | "today"
  | "events"
  | "people"
  | "review"
  | "reviewed"
  | "paid";

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
  adminUserId,
  onClose,
  onOpenReimbursement,
}: AdminQueueProps) {
  const [reviewItems, setReviewItems] = useState<
    AdminReimbursementQueueItem[]
  >([]);

  const [paidItems, setPaidItems] = useState<
    AdminReimbursementQueueItem[]
  >([]);

  const [activationItems, setActivationItems] = useState<
    AdminActivationStatus[]
  >([]);

  const [section, setSection] =
    useState<AdminQueueSection>("today");
  const [selectedTodayUserId, setSelectedTodayUserId] = useState<string | null>(null);

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

        const [activationResult, queueResult, paidResult] =
          await Promise.all([
            getAdminActivationStatus(adminUserId),
            getAdminReimbursementQueue(
              adminUserId,
            ),
            getAdminPaidReimbursements(
              adminUserId,
            ),
          ]);

        setActivationItems(activationResult);
        setReviewItems(queueResult);
        setPaidItems(paidResult);
      } catch (caughtError) {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "Could not load Controller.",
        );
      } finally {
        setLoading(false);
      }
    }

    void loadReimbursements();
  }, [adminUserId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void getAdminActivationStatus(adminUserId)
        .then(setActivationItems)
        .catch(() => undefined);
    }, 10_000);

    return () => window.clearInterval(timer);
  }, [adminUserId]);

  const needsReviewItems = reviewItems.filter(
    (item) => item.status === "submitted",
  );

  const reviewedItems = reviewItems.filter(
    (item) => item.status === "reviewed",
  );

  const items =
    section === "review"
      ? needsReviewItems
      : section === "reviewed"
        ? reviewedItems
        : paidItems;

  const todayKey = new Date().toLocaleDateString("en-CA");

  const todayAssignmentItems = activationItems.filter((item) =>
    item.assigned_events.some(
      (event) => String(event.event_date).slice(0, 10) === todayKey,
    ),
  );

  const sectionTitle =
    section === "today"
      ? "Today"
      : section === "events"
        ? "Events"
        : section === "people"
          ? "People"
          : section === "review"
            ? "Needs review"
            : section === "reviewed"
              ? "Reviewed"
              : "Paid";

  return (
    <main
      className={`admin-queue admin-queue-${viewMode}`}
    >
      <header className="admin-queue-header">
        <div>
          <span>CONTROLLER</span>
          <h1>{sectionTitle}</h1>
        </div>

        <div className="admin-queue-header-actions">
          <ThemeToggle />
          <button
            type="button"
            className="admin-queue-close"
            onClick={onClose}
            aria-label="Close admin"
          >
            <X size={21} />
          </button>
        </div>
      </header>

      <nav
        className="admin-queue-sections"
        aria-label="Controller sections"
      >
        <button
          type="button"
          className={section === "today" ? "active" : ""}
          onClick={() => {
            setSection("today");
            setSelectedTodayUserId(null);
          }}
        >
          Today
          <span>{todayAssignmentItems.length}</span>
        </button>

        <button
          type="button"
          className={section === "events" ? "active" : ""}
          onClick={() => { setSection("events"); setSelectedTodayUserId(null); }}
        >
          Events
        </button>

        <button
          type="button"
          className={section === "people" ? "active" : ""}
          onClick={() => { setSection("people"); setSelectedTodayUserId(null); }}
        >
          People
        </button>

        <button
          type="button"
          className={
            section === "review" ? "active" : ""
          }
          onClick={() => { setSection("review"); setSelectedTodayUserId(null); }}
        >
          Needs review
          <span>{needsReviewItems.length}</span>
        </button>

        <button
          type="button"
          className={
            section === "reviewed" ? "active" : ""
          }
          onClick={() => { setSection("reviewed"); setSelectedTodayUserId(null); }}
        >
          Reviewed
          <span>{reviewedItems.length}</span>
        </button>

        <button
          type="button"
          className={
            section === "paid" ? "active" : ""
          }
          onClick={() => { setSection("paid"); setSelectedTodayUserId(null); }}
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

      {section === "today" && selectedTodayUserId ? (
        <AdminTodayDetail
          adminUserId={adminUserId}
          userId={selectedTodayUserId}
          onBack={() => setSelectedTodayUserId(null)}
        />
      ) : section === "today" && !loading && !error ? (
        <section className="admin-live-list">
          {todayAssignmentItems.length === 0 && (
            <div className="admin-queue-message">
              <strong>No one assigned today</strong>
              <span>Assign employees from Events to put them on Today.</span>
            </div>
          )}

          {todayAssignmentItems.map((item) => {
            const todayAssignments = item.assigned_events.filter(
              (event) => String(event.event_date).slice(0, 10) === todayKey,
            );
            const assignmentNames = todayAssignments.map((event) => event.name);
            const assignmentLabel = assignmentNames.length === 1
              ? assignmentNames[0]
              : `${assignmentNames.length} Events`;
            const todayState = item.is_activated ? "active" : "ready";

            return (
              <button
                type="button"
                className={`admin-live-row ${todayState}`}
                key={item.user_id}
                onClick={() => setSelectedTodayUserId(item.user_id)}
              >
                <div className="admin-live-person">
                  <strong>{item.employee_name}</strong>
                  <span>{item.employee_email}</span>
                </div>

                <div className="admin-live-status-grid">
                  <div className="admin-live-status-line">
                    <span className="admin-live-status-label">Assigned</span>
                    <strong>{assignmentLabel}</strong>
                  </div>

                  <div className="admin-live-status-line">
                    <span className="admin-live-status-label">Status</span>
                    <span className="admin-live-state">
                      <span
                        className={
                          item.is_activated
                            ? "admin-live-dot active"
                            : "admin-live-dot"
                        }
                      />
                      <strong>
                        {item.is_activated ? "ACTIVE" : "READY"}
                      </strong>
                    </span>
                  </div>
                </div>

                <ChevronRight size={19} className="admin-live-chevron" />
              </button>
            );
          })}
        </section>
      ) : section === "events" ? (
        <AdminEvents adminUserId={adminUserId} />
      ) : section === "people" ? (
        <AdminPeople adminUserId={adminUserId} />
      ) : loading ? (
        <div className="admin-queue-message">
          Loading…
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
          ) : section === "reviewed" ? (
            <>
              <CheckCircle2 size={28} />
              <strong>No reviewed reimbursements</strong>
              <span>
                Reviewed reimbursements waiting for payment will appear here.
              </span>
            </>
          ) : (
            <>
              <CheckCircle2 size={28} />
              <strong>No paid reimbursements yet</strong>
              <span>
                Paid reimbursements will appear here.
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

                {section === "review" && (item.issue_summaries?.length ?? 0) > 0 && (
                  <span className="admin-queue-issue-summary">
                    {item.issue_summaries?.join(" · ")}
                  </span>
                )}

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
                {section === "review" && <th>Issues</th>}
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

                  {section === "review" && (
                    <td>
                      {(item.issue_summaries?.length ?? 0) > 0
                        ? item.issue_summaries?.join(" · ")
                        : "—"}
                    </td>
                  )}

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
