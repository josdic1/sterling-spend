import { useEffect, useMemo, useState } from "react";
import { Car, MapPin, X } from "lucide-react";
import { format } from "date-fns";
import {
  createManualMileage,
  getAssignedEvents,
  TEST_EMPLOYEE_ID,
  type AssignedEvent,
} from "../lib/api";
import "./MileageCapture.css";

type MileageCaptureProps = {
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

export default function MileageCapture({
  onCancel,
  onSaved,
}: MileageCaptureProps) {
  const [events, setEvents] = useState<AssignedEvent[]>([]);
  const [eventId, setEventId] = useState("");
  const [miles, setMiles] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadEvents() {
      try {
        setLoading(true);
        setError("");

        const result = await getAssignedEvents(
          TEST_EMPLOYEE_ID,
        );

        setEvents(result);

        if (result.length > 0) {
          setEventId(result[0].id);
        }
      } catch {
        setError("Could not load assigned events.");
      } finally {
        setLoading(false);
      }
    }

    void loadEvents();
  }, []);

  const selectedEvent = useMemo(
    () => events.find((event) => event.id === eventId) ?? null,
    [events, eventId],
  );

  async function handleSubmit(
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
        user_id: TEST_EMPLOYEE_ID,
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

  return (
    <main className="mileage-capture">
      <header className="mileage-capture-header">
        <div>
          <span>NEW MILEAGE</span>
          <h1>Log mileage</h1>
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

      {loading ? (
        <div className="mileage-message">
          Loading assigned events…
        </div>
      ) : events.length === 0 ? (
        <div className="mileage-message">
          <Car size={26} />
          <strong>No assigned events</strong>
          <span>
            Mileage must be linked to an event.
          </span>
        </div>
      ) : (
        <form
          className="mileage-form"
          onSubmit={handleSubmit}
        >
          <label className="mileage-field">
            <span>Event</span>

            <select
              value={eventId}
              onChange={(event) =>
                setEventId(event.target.value)
              }
            >
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.event_number} — {event.name}
                </option>
              ))}
            </select>
          </label>

          {selectedEvent && (
            <section className="mileage-event-card">
              <div>
                <strong>{selectedEvent.name}</strong>
                <span>
                  {formatEventDate(
                    selectedEvent.event_date,
                  )}
                </span>
              </div>

              {selectedEvent.venue_name && (
                <p>
                  <MapPin size={15} />
                  {selectedEvent.venue_name}
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
            Enter the total business miles for this event.
          </p>

          {error && (
            <p className="mileage-error">{error}</p>
          )}

          <button
            type="submit"
            className="mileage-save"
            disabled={saving}
          >
            {saving ? "Saving…" : "Save mileage"}
          </button>
        </form>
      )}
    </main>
  );
}
