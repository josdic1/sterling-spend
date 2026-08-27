import {
  ArrowLeft,
  CalendarDays,
  CircleDollarSign,
  Clock3,
  ExternalLink,
  FileText,
  MapPin,
  ReceiptText,
  Route,
  TriangleAlert,
  UserRound,
  Users,
} from "lucide-react";
import { format } from "date-fns";
import { useEffect, useMemo, useState } from "react";
import {
  getAdminEventDetail,
  type AdminEventDetail,
} from "../lib/api";
import "./AdminEventDashboard.css";

type Props = {
  adminUserId: string;
  eventId: string;
  onBack: () => void;
};

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function eventDate(value: string) {
  return format(new Date(`${value.slice(0, 10)}T12:00:00`), "EEE, MMM d, yyyy");
}

function shortDate(value: string) {
  return format(new Date(`${value.slice(0, 10)}T12:00:00`), "MMM d, yyyy");
}

function dateTime(value: string) {
  return format(new Date(value), "MMM d · h:mm a");
}

function timeRange(start: string | null, end: string | null) {
  const clean = (value: string) => {
    const [hourRaw, minute] = value.slice(0, 5).split(":");
    const hour = Number(hourRaw);
    const suffix = hour >= 12 ? "PM" : "AM";
    const display = hour % 12 || 12;
    return `${display}:${minute} ${suffix}`;
  };

  if (start && end) return `${clean(start)}–${clean(end)}`;
  if (start) return clean(start);
  if (end) return `Ends ${clean(end)}`;
  return null;
}

function bytes(value: string) {
  const size = Number(value);
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AdminEventDashboard({
  adminUserId,
  eventId,
  onBack,
}: Props) {
  const [detail, setDetail] = useState<AdminEventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError("");
        const result = await getAdminEventDetail(adminUserId, eventId);
        if (!cancelled) setDetail(result);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Could not load event.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [adminUserId, eventId]);

  const maxBreakdown = useMemo(
    () => Math.max(0, ...(detail?.category_breakdown.map((item) => item.amount) ?? [])),
    [detail],
  );

  if (loading && !detail) {
    return <div className="admin-event-dashboard-message">Loading event…</div>;
  }

  if (error || !detail) {
    return (
      <section className="admin-event-dashboard">
        <button type="button" className="admin-event-dashboard-back" onClick={onBack}>
          <ArrowLeft size={17} /> Events
        </button>
        <div className="admin-event-dashboard-message error">{error || "Event not found."}</div>
      </section>
    );
  }

  const { event, totals } = detail;
  const eventTime = timeRange(event.start_time, event.end_time);
  const liveCount = detail.employees.filter((employee) => employee.active_now).length;

  return (
    <section className="admin-event-dashboard">
      <div className="admin-event-dashboard-crumb">
        <button type="button" className="admin-event-dashboard-back" onClick={onBack}>
          <ArrowLeft size={17} /> Events
        </button>
        <span>{event.event_number}</span>
      </div>

      <section className="admin-event-hero">
        <div className="admin-event-hero-top">
          <div>
            <span className="admin-event-eyebrow">EVENT</span>
            <h2>{event.name}</h2>
            <p>{event.event_number}</p>
            {event.event_type && <span className="admin-event-type">{event.event_type}</span>}
          </div>

          <div className="admin-event-badges">
            {liveCount > 0 && <span className="admin-event-badge live">● {liveCount} active now</span>}
            {event.status && <span className="admin-event-badge">{event.status}</span>}
          </div>
        </div>

        <div className="admin-event-meta-grid">
          <div>
            <CalendarDays size={16} />
            <span>Date</span>
            <strong>{eventDate(event.event_date)}</strong>
          </div>
          {eventTime && (
            <div>
              <Clock3 size={16} />
              <span>Time</span>
              <strong>{eventTime}</strong>
            </div>
          )}
          {(event.venue_name || event.venue_address) && (
            <div>
              <MapPin size={16} />
              <span>Location</span>
              <strong>{event.venue_name || event.venue_address}</strong>
              {event.venue_name && event.venue_address && <small>{event.venue_address}</small>}
            </div>
          )}
          {event.client_name && (
            <div>
              <CircleDollarSign size={16} />
              <span>Client</span>
              <strong>{event.client_name}</strong>
            </div>
          )}
        </div>
      </section>

      <section className="admin-event-kpis" aria-label="Event totals">
        <div className="admin-event-kpi total">
          <span>Event total</span>
          <strong>{money(totals.total)}</strong>
          <small>{detail.expenses.length + detail.mileage.length} recorded items</small>
        </div>
        <div className="admin-event-kpi receipts">
          <span>Receipts</span>
          <strong>{money(totals.receipts)}</strong>
          <small>{totals.receipt_count} {totals.receipt_count === 1 ? "item" : "items"}</small>
        </div>
        <div className="admin-event-kpi mileage">
          <span>Mileage</span>
          <strong>{money(totals.mileage)}</strong>
          <small>{detail.mileage.reduce((sum, row) => sum + row.approved_miles, 0).toFixed(1)} miles</small>
        </div>
        <div className="admin-event-kpi tolls">
          <span>Tolls</span>
          <strong>{money(totals.tolls)}</strong>
          <small>{totals.toll_count} {totals.toll_count === 1 ? "toll" : "tolls"}</small>
        </div>
      </section>

      <div className="admin-event-section-heading">
        <div>
          <span>TEAM</span>
          <h3>Employees</h3>
        </div>
        <strong>{detail.employees.length} assigned</strong>
      </div>

      {detail.employees.length === 0 ? (
        <div className="admin-event-empty"><Users size={22} />No employees assigned.</div>
      ) : (
        <section className="admin-event-employee-grid">
          {detail.employees.map((employee) => (
            <article className="admin-event-employee-card" key={employee.id}>
              <div className="admin-event-employee-head">
                <span className="admin-event-avatar"><UserRound size={18} /></span>
                <div>
                  <strong>{employee.name}</strong>
                  <span>{employee.email}</span>
                </div>
                {employee.active_now && <span className="admin-event-employee-live">ACTIVE</span>}
              </div>

              <div className="admin-event-employee-total">
                <span>Event spend</span>
                <strong>{money(employee.total)}</strong>
              </div>

              <div className="admin-event-employee-stats">
                <div><span>Receipts</span><strong>{employee.receipt_count}</strong></div>
                <div><span>Miles</span><strong>{employee.miles.toFixed(1)}</strong></div>
                <div><span>Tolls</span><strong>{money(employee.tolls_total)}</strong></div>
              </div>
            </article>
          ))}
        </section>
      )}

      {detail.issues.length > 0 && (
        <>
          <div className="admin-event-section-heading issue-heading">
            <div>
              <span>ATTENTION</span>
              <h3>Issues</h3>
            </div>
            <strong>{detail.issues.length}</strong>
          </div>
          <section className="admin-event-issues">
            {detail.issues.map((issue, index) => (
              <article key={`${issue.type}-${index}`}>
                <TriangleAlert size={18} />
                <div>
                  <strong>{issue.message}</strong>
                  {issue.employee_name && <span>{issue.employee_name}</span>}
                </div>
              </article>
            ))}
          </section>
        </>
      )}

      <div className="admin-event-section-heading">
        <div>
          <span>DETAIL</span>
          <h3>Expenses</h3>
        </div>
        <strong>{detail.expenses.length}</strong>
      </div>

      {detail.expenses.length === 0 ? (
        <div className="admin-event-empty"><ReceiptText size={22} />No expenses recorded for this Event.</div>
      ) : (
        <section className="admin-event-expense-table-card">
          <div className="admin-event-expense-table-head">
            <span>Vendor</span><span>Employee</span><span>Category</span><span>Date</span><span>Amount</span>
          </div>
          {detail.expenses.map((expense) => {
            const dateIssue = detail.issues.some(
              (issue) => issue.type === "date_mismatch" && issue.expense_id === expense.id,
            );

            return (
            <article className={`admin-event-expense-row ${dateIssue ? "has-issue" : ""}`} key={expense.id}>
              <div>
                <strong>{expense.vendor || expense.category_name}</strong>
                {expense.description && <small>{expense.description}</small>}
              </div>
              <span>{expense.employee_name}</span>
              <span className={`admin-event-category ${expense.category_name === "Tolls" ? "toll" : ""}`}>
                {expense.category_name}
              </span>
              <span>{shortDate(expense.expense_date)}</span>
              <div className="admin-event-amount-cell">
                <strong>{money(expense.approved_amount)}</strong>
                {expense.approved_amount !== expense.claimed_amount && (
                  <small>Claimed {money(expense.claimed_amount)}</small>
                )}
              </div>
            </article>
            );
          })}
        </section>
      )}

      <div className="admin-event-two-column">
        <section>
          <div className="admin-event-section-heading compact">
            <div>
              <span>TRAVEL</span>
              <h3>Mileage & tolls</h3>
            </div>
            <Route size={18} />
          </div>

          {detail.travel_by_employee.length === 0 ? (
            <div className="admin-event-empty"><Route size={22} />No travel recorded for this Event.</div>
          ) : (
            <div className="admin-event-travel-list">
              {detail.travel_by_employee.map((travel) => {
                const tollIssue = detail.issues.some(
                  (issue) => issue.type === "toll_mismatch" && issue.employee_id === travel.employee_id,
                );
                return (
                  <article className={`admin-event-travel-card ${tollIssue ? "has-issue" : ""}`} key={travel.employee_id}>
                    <div className="admin-event-travel-head">
                      <div>
                        <strong>{travel.employee_name}</strong>
                        <span>{travel.trip_count} {travel.trip_count === 1 ? "trip" : "trips"}</span>
                      </div>
                      <strong>{money(travel.mileage_amount)}</strong>
                    </div>
                    <div className="admin-event-travel-stats">
                      <div><span>Miles</span><strong>{travel.approved_miles.toFixed(2)}</strong></div>
                      <div><span>Mileage</span><strong>{money(travel.mileage_amount)}</strong></div>
                      <div className={tollIssue ? "warning" : ""}>
                        <span>Planned tolls</span>
                        <strong>{travel.planned_tolls_amount === null ? "—" : money(travel.planned_tolls_amount)}</strong>
                      </div>
                      <div className={tollIssue ? "warning" : ""}>
                        <span>Toll evidence</span>
                        <strong>{money(travel.toll_evidence_amount)}</strong>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section>
          <div className="admin-event-section-heading compact">
            <div>
              <span>SPEND</span>
              <h3>Breakdown</h3>
            </div>
            <CircleDollarSign size={18} />
          </div>

          {detail.category_breakdown.length === 0 ? (
            <div className="admin-event-empty">No spend recorded.</div>
          ) : (
            <div className="admin-event-breakdown">
              {detail.category_breakdown.map((item) => (
                <div className="admin-event-breakdown-row" key={item.name}>
                  <div><span>{item.name}</span><strong>{money(item.amount)}</strong></div>
                  <div className="admin-event-breakdown-track">
                    <span style={{ width: `${maxBreakdown > 0 ? (item.amount / maxBreakdown) * 100 : 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="admin-event-two-column lower">
        <section>
          <div className="admin-event-section-heading compact">
            <div>
              <span>ACTIVITY</span>
              <h3>Timeline</h3>
            </div>
            <Clock3 size={18} />
          </div>

          {detail.activity.length === 0 ? (
            <div className="admin-event-empty">No Event activity yet.</div>
          ) : (
            <div className="admin-event-timeline">
              {detail.activity.map((item, index) => (
                <div className="admin-event-timeline-row" key={`${item.type}-${item.occurred_at}-${index}`}>
                  <span className="admin-event-timeline-dot" />
                  <div>
                    <strong>{item.label}</strong>
                    <span>{item.detail}</span>
                  </div>
                  <time>{dateTime(item.occurred_at)}</time>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="admin-event-section-heading compact">
            <div>
              <span>FILES</span>
              <h3>Documents</h3>
            </div>
            <FileText size={18} />
          </div>

          {detail.documents.length === 0 ? (
            <div className="admin-event-empty">No receipt files attached.</div>
          ) : (
            <div className="admin-event-documents">
              {detail.documents.map((document) => (
                <a
                  key={document.id}
                  href={`/api/attachments/${document.id}/file?requesting_user_id=${encodeURIComponent(adminUserId)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span className="admin-event-document-icon"><FileText size={17} /></span>
                  <div>
                    <strong>{document.file_name}</strong>
                    <span>
                      {document.employee_name}
                      {bytes(document.file_size_bytes) ? ` · ${bytes(document.file_size_bytes)}` : ""}
                    </span>
                  </div>
                  <ExternalLink size={15} />
                </a>
              ))}
            </div>
          )}
        </section>
      </div>

      <footer className="admin-event-readonly-note">
        Read-only Event view · reflects saved Sterling Spend records only
      </footer>
    </section>
  );
}
