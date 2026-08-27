import { ArrowLeft, MapPin, ReceiptText, Route, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import {
  getAdminTodayDetail,
  type AdminTodayDetail as AdminTodayDetailData,
} from "../lib/api";
import "./AdminTodayDetail.css";

type Props = {
  adminUserId: string;
  userId: string;
  onBack: () => void;
};

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

export default function AdminTodayDetail({
  adminUserId,
  userId,
  onBack,
}: Props) {
  const [detail, setDetail] = useState<AdminTodayDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError("");
        const result = await getAdminTodayDetail(adminUserId, userId);
        if (!cancelled) setDetail(result);
      } catch (caughtError) {
        if (!cancelled) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "Could not load Today detail.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    const timer = window.setInterval(() => void load(), 15_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [adminUserId, userId]);

  return (
    <section className="admin-today-detail">
      <button type="button" className="admin-today-back" onClick={onBack}>
        <ArrowLeft size={17} />
        Today
      </button>

      {loading && !detail ? (
        <div className="admin-today-message">Loading today…</div>
      ) : error ? (
        <div className="admin-today-message admin-today-error">{error}</div>
      ) : detail ? (
        <>
          <header className="admin-today-person">
            <div>
              <span>EMPLOYEE</span>
              <h2>{detail.employee.name}</h2>
              <p>{detail.employee.email}</p>
            </div>
            <div className="admin-today-statuses">
              <span className="admin-today-status assigned">
                {detail.assigned_events.length > 0 ? "Assigned" : "Not assigned today"}
              </span>
              <span className={`admin-today-status ${detail.active_event ? "active" : "inactive"}`}>
                {detail.active_event ? "Active" : "Not active"}
              </span>
            </div>
          </header>

          <section className="admin-today-section">
            <div className="admin-today-section-title">
              <MapPin size={17} />
              <h3>Assignment</h3>
            </div>

            {detail.assigned_events.length === 0 ? (
              <p className="admin-today-empty">No Event assigned for today.</p>
            ) : (
              <div className="admin-today-assignment-list">
                {detail.assigned_events.map((event) => (
                  <div className="admin-today-assignment" key={event.id}>
                    <strong>{event.name}</strong>
                    <span>{event.event_number}</span>
                    {event.venue_name && <span>{event.venue_name}</span>}
                    {detail.active_event?.event_id === event.id && (
                      <span className="admin-today-inline-active">ACTIVE NOW</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="admin-today-summary">
            <div>
              <span>Expenses</span>
              <strong>{money(detail.totals.expenses)}</strong>
            </div>
            <div>
              <span>Mileage</span>
              <strong>{money(detail.totals.mileage)}</strong>
            </div>
            <div>
              <span>Running total</span>
              <strong>{money(detail.totals.running)}</strong>
            </div>
          </section>

          <section className="admin-today-section">
            <div className="admin-today-section-title">
              <ReceiptText size={17} />
              <h3>Expenses so far</h3>
              <span>{detail.expenses.length}</span>
            </div>

            {detail.expenses.length === 0 ? (
              <p className="admin-today-empty">No receipts saved yet.</p>
            ) : (
              <div className="admin-today-rows">
                {detail.expenses.map((expense) => (
                  <div className="admin-today-row" key={expense.id}>
                    <div>
                      <strong>{expense.vendor || expense.category_name}</strong>
                      <span>
                        {expense.category_name} · {expense.event_name}
                      </span>
                    </div>
                    <strong>{money(expense.claimed_amount)}</strong>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="admin-today-section">
            <div className="admin-today-section-title">
              <Route size={17} />
              <h3>Travel</h3>
              <span>{detail.mileage.length}</span>
            </div>

            {detail.mileage.length === 0 ? (
              <p className="admin-today-empty">
                {detail.active_event
                  ? "Travel calculation has not been saved yet."
                  : "No travel recorded today."}
              </p>
            ) : (
              <div className="admin-today-travel-list">
                {detail.mileage.map((entry) => (
                  <div className="admin-today-travel" key={entry.id}>
                    <div className="admin-today-row">
                      <div>
                        <strong>{entry.event_name}</strong>
                        <span>{entry.claimed_miles.toFixed(1)} mi · {money(entry.mileage_amount)}</span>
                      </div>
                    </div>
                    <div className="admin-today-toll-line">
                      <span>Tolls expected</span>
                      <strong>
                        {entry.planned_tolls_amount === null
                          ? "—"
                          : money(entry.planned_tolls_amount)}
                      </strong>
                    </div>
                    <div className="admin-today-toll-line">
                      <span>Toll evidence</span>
                      <strong>{money(entry.toll_evidence_amount)}</strong>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="admin-today-section">
            <div className="admin-today-section-title">
              <TriangleAlert size={17} />
              <h3>Issues</h3>
              <span>{detail.issues.length}</span>
            </div>

            {detail.issues.length === 0 ? (
              <p className="admin-today-empty">No current issues.</p>
            ) : (
              <div className="admin-today-issues">
                {detail.issues.map((issue, index) => (
                  <div className="admin-today-issue" key={`${issue.type}-${index}`}>
                    <strong>{issue.message}</strong>
                    {issue.event_name && <span>{issue.event_name}</span>}
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
    </section>
  );
}
