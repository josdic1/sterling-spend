import { useEffect, useState } from "react";
import { CalendarDays, MapPin, X } from "lucide-react";
import { format } from "date-fns";
import {
  activateEvent,
  getAssignedEvents,
  type AssignedEvent,
} from "../lib/api";
import "./EventSelector.css";

type EventSelectorProps = {
  userId: string;
  onCancel: () => void;
  onActivated: () => void;
};

function formatEventDate(value: string) {
  return format(
    new Date(`${value.slice(0, 10)}T12:00:00`),
    "EEE, MMM d",
  );
}

export default function EventSelector({
  userId,
  onCancel,
  onActivated,
}: EventSelectorProps) {
  const [events, setEvents] = useState<AssignedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [activatingId, setActivatingId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadEvents() {
      try {
        setLoading(true);
        setError("");

        const result = await getAssignedEvents(
          userId,
        );

        setEvents(result);
      } catch {
        setError("Could not load assigned events.");
      } finally {
        setLoading(false);
      }
    }

    void loadEvents();
  }, [userId]);

  async function handleActivate(eventId: string) {
    try {
      setActivatingId(eventId);
      setError("");

      await activateEvent(
        eventId,
        userId,
      );

      onActivated();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not activate event.",
      );
    } finally {
      setActivatingId("");
    }
  }

  return (
    <main className="event-selector">
      <header className="event-selector-header">
        <div>
          <span>ASSIGNED EVENTS</span>
          <h1>Select event</h1>
        </div>

        <button
          type="button"
          className="event-selector-close"
          onClick={onCancel}
          aria-label="Close"
        >
          <X size={21} />
        </button>
      </header>

      {loading ? (
        <div className="event-selector-message">
          Loading events…
        </div>
      ) : events.length === 0 ? (
        <div className="event-selector-message">
          <CalendarDays size={28} />
          <strong>No assigned events</strong>
          <span>
            Your assigned catering events will appear here.
          </span>
        </div>
      ) : (
        <div className="event-selector-list">
          {events.map((event) => (
            <article
              className="event-selector-card"
              key={event.id}
            >
              <div className="event-selector-card-top">
                <div>
                  <span>{event.event_number}</span>
                  <h2>{event.name}</h2>
                </div>

                <strong>
                  {formatEventDate(event.event_date)}
                </strong>
              </div>

              {event.venue_name && (
                <p>
                  <MapPin size={15} />
                  {event.venue_name}
                </p>
              )}

              <button
                type="button"
                disabled={activatingId !== ""}
                onClick={() => {
                  void handleActivate(event.id);
                }}
              >
                {activatingId === event.id
                  ? "Activating…"
                  : "Activate event"}
              </button>
            </article>
          ))}
        </div>
      )}

      {error && (
        <p className="event-selector-error">{error}</p>
      )}
    </main>
  );
}
