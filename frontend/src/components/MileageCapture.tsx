import { useEffect, useMemo, useState } from "react";
import {
  Car,
  CheckCircle2,
  MapPin,
  Route,
  X,
} from "lucide-react";
import { format } from "date-fns";
import {
  createManualMileage,
  saveAutomaticTravel,
  getAssignedEvents,
  getAutomaticMileageQuote,
  type AssignedEvent,
  type AutomaticMileageQuote,
} from "../lib/api";
import "./MileageCapture.css";

type MileageCaptureProps = {
  userId: string;
  onCancel: () => void;
  onSaved: () => void;
};

function getEventDate(event: AssignedEvent) {
  return event.event_date.slice(0, 10);
}

function formatEventDate(value: string) {
  return format(
    new Date(`${value.slice(0, 10)}T12:00:00`),
    "EEE, MMM d",
  );
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function formatRate(value: number) {
  return `${(value * 100).toFixed(1)}¢/mi`;
}

export default function MileageCapture({
  userId,
  onCancel,
  onSaved,
}: MileageCaptureProps) {
  const [quote, setQuote] =
    useState<AutomaticMileageQuote | null>(null);

  const [events, setEvents] = useState<AssignedEvent[]>([]);
  const [eventId, setEventId] = useState("");
  const [miles, setMiles] = useState("");

  const [manualMode, setManualMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadMileage() {
      setLoading(true);
      setQuoteError("");
      setError("");

      const [quoteResult, eventsResult] =
        await Promise.allSettled([
          getAutomaticMileageQuote(userId),
          getAssignedEvents(userId),
        ]);

      if (quoteResult.status === "fulfilled") {
        setQuote(quoteResult.value);
      } else {
        setQuote(null);
        setQuoteError(
          quoteResult.reason instanceof Error
            ? quoteResult.reason.message
            : "Automatic mileage is unavailable.",
        );
      }

      if (eventsResult.status === "fulfilled") {
        setEvents(eventsResult.value);

        if (eventsResult.value.length > 0) {
          setEventId(eventsResult.value[0].id);
        }
      }

      setLoading(false);
    }

    void loadMileage();
  }, []);

  const selectedEvent = useMemo(
    () =>
      events.find((event) => event.id === eventId) ??
      null,
    [events, eventId],
  );

  async function handleAutomaticSave() {
    if (!quote || quote.already_saved) {
      return;
    }

    try {
      setSaving(true);
      setError("");

      await saveAutomaticTravel({
        user_id: userId,
        event_id: quote.event.id,
        trip_date: quote.event.event_date.slice(0, 10),
        planned_miles: quote.route.round_trip_miles,
        planned_tolls_amount: quote.tolls.has_tolls
          ? quote.tolls.estimated_round_trip_amount
          : 0,
      });

      onSaved();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not save mileage.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleManualSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!selectedEvent || !miles) {
      setError("Event and miles are required.");
      return;
    }

    try {
      setSaving(true);
      setError("");

      await createManualMileage({
        user_id: userId,
        event_id: selectedEvent.id,
        trip_date: getEventDate(selectedEvent),
        claimed_miles: miles,
      });

      onSaved();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not save mileage.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="mileage-capture">
        <header className="mileage-capture-header">
          <div>
            <span>NEW MILEAGE</span>
            <h1>Mileage</h1>
          </div>

          <button
            type="button"
            className="mileage-close"
            onClick={onCancel}
            aria-label="Close"
          >
            <X size={21} />
          </button>
        </header>

        <div className="mileage-message">
          <Route size={27} />
          <strong>Calculating your route…</strong>
          <span>
            Sterling Carlstadt → event → Sterling
            Carlstadt
          </span>
        </div>
      </main>
    );
  }

  return (
    <main className="mileage-capture">
      <header className="mileage-capture-header">
        <div>
          <span>NEW MILEAGE</span>
          <h1>Mileage</h1>
        </div>

        <button
          type="button"
          className="mileage-close"
          onClick={onCancel}
          aria-label="Close"
        >
          <X size={21} />
        </button>
      </header>

      {quote?.already_saved ? (
        <>
          <section className="mileage-auto-card">
            <div className="mileage-auto-label">
              <CheckCircle2 size={17} />
              MILEAGE SAVED
            </div>

            <div className="mileage-auto-event">
              <div>
                <h2>{quote.event.name}</h2>
                <span>{quote.event.event_number}</span>
              </div>

              <span className="mileage-auto-date">
                {formatEventDate(
                  quote.event.event_date,
                )}
              </span>
            </div>

            <div className="mileage-results">
              <div>
                <strong>
                  {quote.travel.planned_miles.toFixed(1)}
                </strong>
                <span>miles round trip</span>
              </div>

              <div>
                <strong>
                  {formatMoney(
                    quote.travel.planned_mileage_amount,
                  )}
                </strong>
                <span>
                  {formatRate(
                    quote.travel.rate_per_mile,
                  )}
                </span>
              </div>
            </div>
          </section>

          <p className="mileage-helper">
            Travel for this active event is already calculated.
          </p>

          <button
            type="button"
            className="mileage-save"
            onClick={onCancel}
          >
            Done
          </button>
        </>
      ) : !manualMode && quote ? (
        <>
          <section className="mileage-auto-card">
            <div className="mileage-auto-label">
              <Route size={17} />
              AUTOMATIC ROUTE
            </div>

            <div className="mileage-auto-event">
              <div>
                <h2>{quote.event.name}</h2>
                <span>{quote.event.event_number}</span>
              </div>

              <span className="mileage-auto-date">
                {formatEventDate(
                  quote.event.event_date,
                )}
              </span>
            </div>

            <div className="mileage-route">
              <div className="mileage-route-stop">
                <span className="route-dot" />

                <div>
                  <strong>Sterling Carlstadt</strong>
                  <span>
                    100 Commerce Road, Carlstadt, NJ
                  </span>
                </div>
              </div>

              <div className="route-line" />

              <div className="mileage-route-stop">
                <span className="route-dot destination" />

                <div>
                  <strong>
                    {quote.event.venue_name ??
                      quote.event.name}
                  </strong>
                  <span>
                    {quote.event.venue_address}
                  </span>
                </div>
              </div>

              <div className="route-line" />

              <div className="mileage-route-stop">
                <span className="route-dot" />

                <div>
                  <strong>Sterling Carlstadt</strong>
                  <span>Return</span>
                </div>
              </div>
            </div>

            <div className="mileage-results">
              <div>
                <strong>
                  {quote.route.round_trip_miles.toFixed(1)}
                </strong>
                <span>miles round trip</span>
              </div>

              <div>
                <strong>
                  {formatMoney(
                    quote.reimbursement_amount,
                  )}
                </strong>
                <span>
                  {formatRate(
                    quote.mileage_rate.rate_per_mile,
                  )}
                </span>
              </div>
            </div>

            {quote.tolls.has_tolls && (
              <div className="mileage-tolls">
                <div>
                  <span>EXPECTED TOLLS</span>
                  <strong>
                    {quote.tolls.estimated_round_trip_amount !== null
                      ? formatMoney(
                          quote.tolls.estimated_round_trip_amount,
                        )
                      : "Tolls on route"}
                  </strong>
                </div>

                {quote.tolls.estimated_round_trip_amount !== null && (
                  <small>
                    Route estimate · actual toll evidence required
                  </small>
                )}
              </div>
            )}
          </section>

          <p className="mileage-helper">
            Mileage is calculated from Sterling
            Carlstadt to the active event and back.
          </p>

          {error && (
            <p className="mileage-error">{error}</p>
          )}

          <button
            type="button"
            className="mileage-save"
            disabled={saving}
            onClick={() => {
              void handleAutomaticSave();
            }}
          >
            {saving
              ? "Saving…"
              : "Confirm & Save"}
          </button>

          <button
            type="button"
            className="mileage-manual-toggle"
            disabled={saving}
            onClick={() => {
              setError("");
              setManualMode(true);
            }}
          >
            Enter mileage manually
          </button>
        </>
      ) : !manualMode ? (
        <>
          <div className="mileage-message">
            <Car size={27} />
            <strong>
              Automatic route unavailable
            </strong>
            <span>
              {quoteError ||
                "Could not calculate this route."}
            </span>
          </div>

          <button
            type="button"
            className="mileage-manual-toggle standalone"
            onClick={() => {
              setError("");
              setManualMode(true);
            }}
          >
            Enter mileage manually
          </button>
        </>
      ) : events.length === 0 ? (
        <>
          <div className="mileage-message">
            <Car size={26} />
            <strong>No assigned events</strong>
            <span>
              Mileage must be linked to an event.
            </span>
          </div>

          {quote && !quote.already_saved && (
            <button
              type="button"
              className="mileage-manual-toggle standalone"
              onClick={() => {
                setError("");
                setManualMode(false);
              }}
            >
              Use automatic mileage
            </button>
          )}
        </>
      ) : (
        <form
          className="mileage-form"
          onSubmit={handleManualSubmit}
        >
          <div className="manual-heading">
            <div>
              <span>MANUAL FALLBACK</span>
              <strong>Enter mileage</strong>
            </div>

            {quote && !quote.already_saved && (
              <button
                type="button"
                onClick={() => {
                  setError("");
                  setManualMode(false);
                }}
              >
                Use automatic
              </button>
            )}
          </div>

          <label className="mileage-field">
            <span>Event</span>

            <select
              value={eventId}
              onChange={(event) =>
                setEventId(event.target.value)
              }
            >
              {events.map((event) => (
                <option
                  key={event.id}
                  value={event.id}
                >
                  {event.event_number} — {event.name}
                </option>
              ))}
            </select>
          </label>

          {selectedEvent && (
            <section className="mileage-event-card">
              <div>
                <strong>
                  {selectedEvent.name}
                </strong>

                <span>
                  {formatEventDate(
                    selectedEvent.event_date,
                  )}
                </span>
              </div>

              {(selectedEvent.venue_name ||
                selectedEvent.venue_address) && (
                <p>
                  <MapPin size={15} />
                  {selectedEvent.venue_name ??
                    selectedEvent.venue_address}
                </p>
              )}
            </section>
          )}

          <label className="mileage-field">
            <span>Miles</span>

            <div className="miles-input">
              <input
                type="number"
                inputMode="decimal"
                min="0.1"
                step="0.1"
                placeholder="0.0"
                value={miles}
                onChange={(event) =>
                  setMiles(event.target.value)
                }
                autoFocus
                required
              />

              <span>mi</span>
            </div>
          </label>

          <p className="mileage-helper">
            Manual entry is available when the automatic
            route needs correction.
          </p>

          {error && (
            <p className="mileage-error">{error}</p>
          )}

          <button
            type="submit"
            className="mileage-save"
            disabled={saving}
          >
            {saving
              ? "Saving…"
              : "Save manual mileage"}
          </button>
        </form>
      )}
    </main>
  );
}
