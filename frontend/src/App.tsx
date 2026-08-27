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
  MapPin,
  ReceiptText,
  Route as RouteIcon,
} from "lucide-react";
import { format } from "date-fns";
import ActiveEventDetail from "./components/ActiveEventDetail";
import AdminQueue from "./components/AdminQueue";
import AdminReimbursementDetail from "./components/AdminReimbursementDetail";
import EventSelector from "./components/EventSelector";
import ReceiptCapture from "./components/ReceiptCapture";
import ReimbursementReview from "./components/ReimbursementReview";
import LoginScreen from "./components/LoginScreen";
import { useAuth } from "./auth";
import {
  ensureAutomaticTravel,
  getActiveEvent,
  getCurrentReimbursement,
  type ActiveEvent,
  type CurrentReimbursement,
} from "./lib/api";

type CaptureMode = "receipt" | "toll";

type EmployeeHomeProps = {
  userId: string;
  isAdmin: boolean;
  onLogout: () => Promise<void>;
};

function formatMoney(value: string | number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value));
}

function formatMonth(year: number, month: number) {
  return format(new Date(year, month - 1, 1), "MMMM");
}

function EmployeeHome({ userId, isAdmin, onLogout }: EmployeeHomeProps) {
  const navigate = useNavigate();
  const receiptInputRef = useRef<HTMLInputElement>(null);

  const [reimbursement, setReimbursement] =
    useState<CurrentReimbursement | null>(null);
  const [activeEvent, setActiveEvent] =
    useState<ActiveEvent | null>(null);
  const [receiptFile, setReceiptFile] =
    useState<File | null>(null);
  const [captureMode, setCaptureMode] =
    useState<CaptureMode>("receipt");
  const [showEventSelector, setShowEventSelector] =
    useState(false);
  const [showActiveEvent, setShowActiveEvent] =
    useState(false);
  const [showReimbursement, setShowReimbursement] =
    useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [travelWarning, setTravelWarning] = useState("");

  const loadHome = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const [reimbursementResult, activeEventResult] =
        await Promise.all([
          getCurrentReimbursement(userId),
          getActiveEvent(userId),
        ]);

      let resolvedReimbursement = reimbursementResult;
      let resolvedActiveEvent = activeEventResult;
      setTravelWarning("");

      if (activeEventResult) {
        try {
          const created = await ensureAutomaticTravel(userId);

          if (created) {
            [resolvedReimbursement, resolvedActiveEvent] =
              await Promise.all([
                getCurrentReimbursement(userId),
                getActiveEvent(userId),
              ]);
          }
        } catch (caughtError) {
          setTravelWarning(
            caughtError instanceof Error
              ? caughtError.message
              : "Could not calculate travel automatically.",
          );
        }
      }

      setReimbursement(resolvedReimbursement);
      setActiveEvent(resolvedActiveEvent);
    } catch {
      setError("Could not load Sterling Spend.");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void loadHome();
  }, [loadHome]);

  function openCapture(mode: CaptureMode) {
    setCaptureMode(mode);
    receiptInputRef.current?.click();
  }

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
    setCaptureMode("receipt");
    await loadHome();
  }

  function handleReceiptCancel() {
    setReceiptFile(null);
    setCaptureMode("receipt");
  }

  async function handleEventActivated() {
    setShowEventSelector(false);
    await loadHome();
  }

  async function handleEventEnded() {
    setShowActiveEvent(false);
    await loadHome();
  }

  async function handleReimbursementSubmitted() {
    setShowReimbursement(false);
    await loadHome();
  }

  if (receiptFile) {
    return (
      <div className="employee-app">
        <ReceiptCapture
          userId={userId}
          file={receiptFile}
          mode={captureMode}
          onCancel={handleReceiptCancel}
          onSaved={() => {
            void handleReceiptSaved();
          }}
        />
      </div>
    );
  }

  if (showEventSelector) {
    return (
      <div className="employee-app">
        <EventSelector
          userId={userId}
          onCancel={() => setShowEventSelector(false)}
          onActivated={() => {
            void handleEventActivated();
          }}
        />
      </div>
    );
  }

  if (showActiveEvent && activeEvent) {
    return (
      <div className="employee-app">
        <ActiveEventDetail
          event={activeEvent}
          onCancel={() => setShowActiveEvent(false)}
          onEnded={() => {
            void handleEventEnded();
          }}
        />
      </div>
    );
  }

  if (showReimbursement && reimbursement) {
    return (
      <div className="employee-app">
        <ReimbursementReview
          userId={userId}
          reimbursement={reimbursement}
          onCancel={() => setShowReimbursement(false)}
          onSubmitted={() => {
            void handleReimbursementSubmitted();
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

  const activeTravelAlreadyListed = Boolean(
    activeEvent &&
      reimbursement?.mileage.some(
        (entry) =>
          entry.event_session_id === activeEvent.session_id,
      ),
  );

  const showActiveTravel = Boolean(
    activeEvent?.planned_miles !== null &&
      activeEvent?.planned_miles !== undefined &&
      activeEvent?.planned_mileage_amount !== null &&
      activeEvent?.planned_mileage_amount !== undefined &&
      !activeTravelAlreadyListed,
  );

  return (
    <div className="employee-app">
      <header className="employee-topbar">
        <div>
          <strong>STERLING</strong>
          <span> Spend</span>
        </div>

        <div className="employee-topbar-actions">
          {isAdmin && (
            <button
              type="button"
              className="controller-link"
              onClick={() => navigate("/admin")}
            >
              Admin
            </button>
          )}

          <button
            type="button"
            className="employee-signout"
            onClick={() => { void onLogout(); }}
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="employee-page">
        {activeEvent ? (
          <button
            type="button"
            className="active-event"
            onClick={() => setShowActiveEvent(true)}
          >
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
          </button>
        ) : (
          <button
            type="button"
            className="no-active-event"
            onClick={() => setShowEventSelector(true)}
          >
            <span>No active event</span>
            <strong>Select today’s event to begin</strong>
          </button>
        )}

        {travelWarning && (
          <div className="employee-warning" role="status">
            Travel calculation needs attention: {travelWarning}
          </div>
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
            onClick={() => openCapture("receipt")}
          >
            <span className="receipt-icon">
              <Camera size={30} />
            </span>

            <span>
              <strong>Receipt</strong>
              <small>Snap it now</small>
            </span>
          </button>

          <div className="secondary-actions single-action">
            <button
              type="button"
              onClick={() => openCapture("toll")}
            >
              <RouteIcon size={23} />

              <span>
                <strong>Toll</strong>
                <small>Add receipt</small>
              </span>
            </button>
          </div>
        </section>

        {reimbursement && (
          <button
            type="button"
            className="month-summary"
            onClick={() => setShowReimbursement(true)}
          >
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

            <div className="month-summary-right">
              <span
                className={`status-pill ${reimbursement.status}`}
              >
                {reimbursement.status}
              </span>

              <ChevronRight size={19} />
            </div>
          </button>
        )}

        <section className="recent-section">
          <div className="section-heading">
            <span>RECENT</span>
          </div>

          {(!reimbursement ||
            (reimbursement.expenses.length === 0 &&
              reimbursement.mileage.length === 0)) &&
          !showActiveTravel ? (
            <div className="recent-empty">
              <ReceiptText size={24} />
              <strong>No activity yet</strong>
              <span>Your expenses will appear here.</span>
            </div>
          ) : (
            <div className="activity-list">
              {showActiveTravel && activeEvent && (
                <article className="activity-row">
                  <div className="activity-icon">
                    <Car size={19} />
                  </div>

                  <div className="activity-copy">
                    <div className="activity-title">
                      <strong>Mileage</strong>

                      <strong>
                        {formatMoney(
                          activeEvent.planned_mileage_amount ?? 0,
                        )}
                      </strong>
                    </div>

                    <p>
                      {activeEvent.planned_miles} mi · {activeEvent.name}
                    </p>
                  </div>
                </article>
              )}

              {reimbursement?.expenses.map((expense) => (
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

              {reimbursement?.mileage.map((entry) => {
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

function AdminWorkspace({ adminUserId }: { adminUserId: string }) {
  const navigate = useNavigate();

  const [selectedReimbursementId, setSelectedReimbursementId] =
    useState<string | null>(null);

  if (selectedReimbursementId) {
    return (
      <AdminReimbursementDetail
        adminUserId={adminUserId}
        reimbursementId={selectedReimbursementId}
        onBack={() => setSelectedReimbursementId(null)}
        onReviewed={() => setSelectedReimbursementId(null)}
      />
    );
  }

  return (
    <AdminQueue
      adminUserId={adminUserId}
      onClose={() => navigate("/")}
      onOpenReimbursement={(reimbursementId) =>
        setSelectedReimbursementId(reimbursementId)
      }
    />
  );
}

function App() {
  const { user, loading, logout } = useAuth();

  if (loading) {
    return (
      <main className="employee-page">
        <div className="employee-loading">Loading…</div>
      </main>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<LoginScreen />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route
        path="/"
        element={
          <EmployeeHome
            userId={user.id}
            isAdmin={user.role === "admin"}
            onLogout={logout}
          />
        }
      />
      <Route
        path="/admin"
        element={
          user.role === "admin" ? (
            <AdminWorkspace adminUserId={user.id} />
          ) : (
            <Navigate to="/" replace />
          )
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
