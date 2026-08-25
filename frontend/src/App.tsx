import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Navigate,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import {
  Camera,
  Car,
  ChevronRight,
  ClipboardCheck,
  MapPin,
  ReceiptText,
  Route as RouteIcon,
} from "lucide-react";
import { format } from "date-fns";
import ReceiptCapture from "./components/ReceiptCapture";
import {
  getActiveEvent,
  getCurrentReimbursement,
  TEST_EMPLOYEE_ID,
  type ActiveEvent,
  type CurrentReimbursement,
} from "./lib/api";

function formatMoney(value: string | number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value));
}

function formatMonth(year: number, month: number) {
  return format(new Date(year, month - 1, 1), "MMMM");
}

function EmployeeHome() {
  const navigate = useNavigate();
  const receiptInputRef = useRef<HTMLInputElement>(null);

  const [reimbursement, setReimbursement] =
    useState<CurrentReimbursement | null>(null);
  const [activeEvent, setActiveEvent] =
    useState<ActiveEvent | null>(null);
  const [receiptFile, setReceiptFile] =
    useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadHome = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const [reimbursementResult, activeEventResult] =
        await Promise.all([
          getCurrentReimbursement(TEST_EMPLOYEE_ID),
          getActiveEvent(TEST_EMPLOYEE_ID),
        ]);

      setReimbursement(reimbursementResult);
      setActiveEvent(activeEventResult);
    } catch {
      setError("Could not load Sterling Spend.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHome();
  }, [loadHome]);

  function handleReceiptSelected(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];

    if (file) {
      setReceiptFile(file);
    }

    event.target.value = "";
  }

  async function handleReceiptSaved() {
    setReceiptFile(null);
    await loadHome();
  }

  if (receiptFile) {
    return (
      <div className="employee-app">
        <ReceiptCapture
          file={receiptFile}
          onCancel={() => setReceiptFile(null)}
          onSaved={() => {
            void handleReceiptSaved();
          }}
        />
      </div>
    );
  }

  if (loading) {
    return (
      <main className="employee-page">
        <div className="employee-loading">Loading…</div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="employee-page">
        <div className="employee-loading">{error}</div>
      </main>
    );
  }

  const canAdd =
    !reimbursement || reimbursement.status === "open";

  return (
    <div className="employee-app">
      <header className="employee-topbar">
        <div>
          <strong>STERLING</strong>
          <span> Spend</span>
        </div>

        <button
          type="button"
          className="controller-link"
          onClick={() => navigate("/admin")}
        >
          <ClipboardCheck size={17} />
          Review
        </button>
      </header>

      <main className="employee-page">
        {activeEvent ? (
          <section className="active-event">
            <div className="active-event-topline">
              <span className="active-dot" />
              ACTIVE EVENT
            </div>

            <div className="active-event-main">
              <div>
                <h1>{activeEvent.name}</h1>

                <p className="event-number">
                  {activeEvent.event_number}
                </p>

                {activeEvent.venue_name && (
                  <p className="event-location">
                    <MapPin size={15} />
                    {activeEvent.venue_name}
                  </p>
                )}
              </div>

              <ChevronRight size={22} />
            </div>
          </section>
        ) : (
          <section className="no-active-event">
            <span>No active event</span>
            <strong>Select today’s event to begin</strong>
          </section>
        )}

        <section className="capture-section">
          <input
            ref={receiptInputRef}
            className="receipt-file-input"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleReceiptSelected}
          />

          <button
            type="button"
            className="receipt-action"
            disabled={!canAdd}
            onClick={() => receiptInputRef.current?.click()}
          >
            <span className="receipt-icon">
              <Camera size={30} />
            </span>

            <span>
              <strong>Receipt</strong>
              <small>Snap it now</small>
            </span>
          </button>

          <div className="secondary-actions">
            <button type="button" disabled={!canAdd}>
              <Car size={23} />
              <span>
                <strong>Mileage</strong>
                <small>Log a trip</small>
              </span>
            </button>

            <button type="button" disabled={!canAdd}>
              <RouteIcon size={23} />
              <span>
                <strong>Toll</strong>
                <small>Add receipt</small>
              </span>
            </button>
          </div>
        </section>

        {reimbursement && (
          <section className="month-summary">
            <div>
              <span>
                {formatMonth(
                  reimbursement.year,
                  reimbursement.month,
                ).toUpperCase()}
              </span>

              <strong>
                {formatMoney(
                  reimbursement.totals.claimed_total,
                )}
              </strong>
            </div>

            <span
              className={`status-pill ${reimbursement.status}`}
            >
              {reimbursement.status}
            </span>
          </section>
        )}

        <section className="recent-section">
          <div className="section-heading">
            <span>RECENT</span>
          </div>

          {!reimbursement ||
          (reimbursement.expenses.length === 0 &&
            reimbursement.mileage.length === 0) ? (
            <div className="recent-empty">
              <ReceiptText size={24} />
              <strong>No activity yet</strong>
              <span>Your expenses will appear here.</span>
            </div>
          ) : (
            <div className="activity-list">
              {reimbursement.expenses.map((expense) => (
                <article
                  className="activity-row"
                  key={expense.id}
                >
                  <div className="activity-icon">
                    <ReceiptText size={19} />
                  </div>

                  <div className="activity-copy">
                    <div className="activity-title">
                      <strong>
                        {expense.vendor || "Expense"}
                      </strong>
                      <strong>
                        {formatMoney(expense.claimed_amount)}
                      </strong>
                    </div>

                    <p>
                      {expense.category_name}
                      {expense.event_name
                        ? ` · ${expense.event_name}`
                        : ""}
                    </p>
                  </div>
                </article>
              ))}

              {reimbursement.mileage.map((entry) => {
                const amount =
                  Number(entry.claimed_miles) *
                  Number(entry.rate_per_mile);

                return (
                  <article
                    className="activity-row"
                    key={entry.id}
                  >
                    <div className="activity-icon">
                      <Car size={19} />
                    </div>

                    <div className="activity-copy">
                      <div className="activity-title">
                        <strong>Mileage</strong>
                        <strong>
                          {formatMoney(amount)}
                        </strong>
                      </div>

                      <p>
                        {entry.claimed_miles} mi
                        {entry.event_name
                          ? ` · ${entry.event_name}`
                          : ""}
                      </p>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function AdminQueue() {
  const navigate = useNavigate();

  return (
    <div className="admin-placeholder">
      <header>
        <button
          type="button"
          onClick={() => navigate("/")}
        >
          ← Employee
        </button>
      </header>

      <main>
        <p>CONTROLLER</p>
        <h1>Reimbursements</h1>

        <div className="recent-empty">
          <ClipboardCheck size={26} />
          <strong>Nothing waiting for review</strong>
          <span>
            Submitted reimbursements will appear here.
          </span>
        </div>
      </main>
    </div>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<EmployeeHome />} />
      <Route path="/admin" element={<AdminQueue />} />
      <Route
        path="*"
        element={<Navigate to="/" replace />}
      />
    </Routes>
  );
}

export default App;
