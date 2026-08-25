import { useState } from "react";
import {
  CalendarDays,
  MapPin,
  Square,
  X,
} from "lucide-react";
import { format } from "date-fns";
import {
  endEventSession,
  type ActiveEvent,
} from "../lib/api";
import "./ActiveEventDetail.css";

type ActiveEventDetailProps = {
  event: ActiveEvent;
  onCancel: () => void;
  onEnded: () => void;
};

function formatEventDate(value: string) {
  return format(
    new Date(`${value.slice(0, 10)}T12:00:00`),
    "EEEE, MMMM d",
  );
}

export default function ActiveEventDetail({
  event,
  onCancel,
  onEnded,
}: ActiveEventDetailProps) {
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState("");

  async function handleEndEvent() {
    try {
      setEnding(true);
      setError("");

      await endEventSession(event.session_id);

      onEnded();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not end event.",
      );
    } finally {
      setEnding(false);
    }
  }

  return (
    <main className="active-event-detail">
      <header className="active-event-detail-header">
        <div>
          <span>ACTIVE EVENT</span>
          <h1>{event.name}</h1>
          <p>{event.event_number}</p>
        </div>

        <button
          type="button"
          className="active-event-detail-close"
          onClick={onCancel}
          aria-label="Close"
        >
          <X size={21} />
        </button>
      </header>

      <section className="active-event-detail-card">
        <div className="active-event-detail-row">
          <CalendarDays size={20} />

          <div>
            <span>Date</span>
            <strong>
              {formatEventDate(event.event_date)}
            </strong>
          </div>
        </div>

        {event.venue_name && (
          <div className="active-event-detail-row">
            <MapPin size={20} />

            <div>
              <span>Location</span>
              <strong>{event.venue_name}</strong>

              {event.venue_address && (
                <small>{event.venue_address}</small>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="active-event-status">
        <span className="active-event-status-dot" />

        <div>
          <strong>Event is active</strong>
          <span>
            New receipts and mileage will automatically
            attach to this event.
          </span>
        </div>
      </section>

      {error && (
        <p className="active-event-detail-error">
          {error}
        </p>
      )}

      <button
        type="button"
        className="active-event-end"
        disabled={ending}
        onClick={() => {
          void handleEndEvent();
        }}
      >
        <Square size={17} />
        {ending ? "Ending event…" : "End event"}
      </button>
    </main>
  );
}
