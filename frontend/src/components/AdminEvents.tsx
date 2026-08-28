import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarPlus, ChevronRight, MapPin, Pencil, Search } from "lucide-react";
import { format } from "date-fns";
import {
  createAdminEvent,
  getAdminEvents,
  getAdminUsers,
  searchAdminEventLocations,
  updateAdminEvent,
  type AdminEvent,
  type AdminEventInput,
  type AdminLocationSuggestion,
  type AdminUser,
} from "../lib/api";
import AdminEventDashboard from "./AdminEventDashboard";
import { personDisplayName } from "../lib/demo-display";
import "./AdminEvents.css";

type Props = { adminUserId: string };

type FormState = {
  event_number: string;
  name: string;
  event_date: string;
  client_name: string;
  venue_name: string;
  venue_address: string;
  start_time: string;
  end_time: string;
  assigned_user_ids: string[];
};

const emptyForm: FormState = {
  event_number: "",
  name: "",
  event_date: "",
  client_name: "",
  venue_name: "",
  venue_address: "",
  start_time: "",
  end_time: "",
  assigned_user_ids: [],
};

const QUARTER_HOUR_OPTIONS = Array.from({ length: 96 }, (_, index) => {
  const hour = Math.floor(index / 4);
  const minute = (index % 4) * 15;
  const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const displayHour = hour % 12 || 12;
  const suffix = hour < 12 ? "AM" : "PM";
  return { value, label: `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}` };
});

function toForm(event: AdminEvent): FormState {
  return {
    event_number: event.event_number,
    name: event.name,
    event_date: event.event_date.slice(0, 10),
    client_name: event.client_name ?? "",
    venue_name: event.venue_name ?? "",
    venue_address: event.venue_address ?? "",
    start_time: event.start_time?.slice(0, 5) ?? "",
    end_time: event.end_time?.slice(0, 5) ?? "",
    assigned_user_ids: event.assigned_user_ids,
  };
}

function eventDate(value: string) {
  return format(new Date(`${value.slice(0, 10)}T12:00:00`), "MMM d, yyyy");
}


// STERLING EVENT TIME PICKER V4 20260828
function sterlingTimeParts(value: string) {
  const match = /^(\d{2}):(\d{2})/.exec(value || "");
  if (!match) {
    return { hour: "", minute: "00", period: "AM" as "AM" | "PM" };
  }

  const hour24 = Number(match[1]);
  const minute = match[2];
  const period: "AM" | "PM" = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;

  return { hour: String(hour12), minute, period };
}

function sterlingTimeValue(hour: string, minute: string, period: "AM" | "PM") {
  if (!hour) return "";

  const hour12 = Number(hour);
  let hour24 = hour12 % 12;
  if (period === "PM") hour24 += 12;

  return `${String(hour24).padStart(2, "0")}:${minute}`;
}

function SterlingEventTimeSelectV3({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  void QUARTER_HOUR_OPTIONS;
  const parts = sterlingTimeParts(value);
  const standardMinutes = ["00", "15", "30", "45"];
  const minuteOptions = standardMinutes.includes(parts.minute)
    ? standardMinutes
    : [parts.minute, ...standardMinutes];

  return (
    <div className="sterling-event-time-picker" role="group" aria-label={ariaLabel}>
      <select
        className="sterling-event-time-part sterling-event-time-hour"
        value={parts.hour}
        onChange={(event) =>
          onChange(sterlingTimeValue(event.target.value, parts.minute, parts.period))
        }
        aria-label={`${ariaLabel} hour`}
      >
        <option value="">Hour</option>
        {Array.from({ length: 12 }, (_, index) => String(index + 1)).map((hour) => (
          <option key={hour} value={hour}>{hour}</option>
        ))}
      </select>

      <span className="sterling-event-time-colon" aria-hidden="true">:</span>

      <select
        className="sterling-event-time-part sterling-event-time-minute"
        value={parts.minute}
        disabled={!parts.hour}
        onChange={(event) =>
          onChange(sterlingTimeValue(parts.hour, event.target.value, parts.period))
        }
        aria-label={`${ariaLabel} minutes`}
      >
        {minuteOptions.map((minute) => (
          <option key={minute} value={minute}>{minute}</option>
        ))}
      </select>

      <select
        className="sterling-event-time-part sterling-event-time-period"
        value={parts.period}
        disabled={!parts.hour}
        onChange={(event) =>
          onChange(
            sterlingTimeValue(
              parts.hour,
              parts.minute,
              event.target.value as "AM" | "PM",
            ),
          )
        }
        aria-label={`${ariaLabel} AM or PM`}
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
}

export default function AdminEvents({ adminUserId }: Props) {
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [locationQuery, setLocationQuery] = useState("");
  const [locationSuggestions, setLocationSuggestions] = useState<AdminLocationSuggestion[]>([]);
  const [locationSearching, setLocationSearching] = useState(false);
  const [manualLocation, setManualLocation] = useState(false);
  const formOpen = creating || editingId !== null;

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const [eventRows, userRows] = await Promise.all([
        getAdminEvents(adminUserId),
        getAdminUsers(adminUserId),
      ]);
      setEvents(eventRows);
      setUsers(userRows);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load events.");
    } finally {
      setLoading(false);
    }
  }, [adminUserId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!formOpen || manualLocation) return;
    const query = locationQuery.trim();
    const selectedLocationLabel = [form.venue_name, form.venue_address]
      .filter(Boolean)
      .join(" · ")
      .trim();
    if (selectedLocationLabel && query === selectedLocationLabel) {
      setLocationSuggestions([]);
      return;
    }
    if (query.length < 3) {
      setLocationSuggestions([]);
      return;
    }

    const timer = window.setTimeout(() => {
      setLocationSearching(true);
      void searchAdminEventLocations(adminUserId, query)
        .then(setLocationSuggestions)
        .catch(() => setLocationSuggestions([]))
        .finally(() => setLocationSearching(false));
    }, 280);

    return () => window.clearTimeout(timer);
  }, [adminUserId, formOpen, form.venue_address, form.venue_name, locationQuery, manualLocation]);

  const activeUsers = useMemo(() => users.filter((user) => user.is_active), [users]);
  const names = useMemo(() => new Map(users.map((user) => [user.id, personDisplayName(user)])), [users]);

  function cancel() {
    setCreating(false);
    setEditingId(null);
    setForm(emptyForm);
    setLocationQuery("");
    setLocationSuggestions([]);
    setManualLocation(false);
    setError("");
  }

  function edit(event: AdminEvent) {
    setCreating(false);
    setEditingId(event.id);
    setForm(toForm(event));
    setLocationQuery([event.venue_name, event.venue_address].filter(Boolean).join(" · "));
    setLocationSuggestions([]);
    setManualLocation(false);
    setError("");
  }

  function chooseLocation(location: AdminLocationSuggestion) {
    setForm((current) => ({
      ...current,
      venue_name: location.name || current.venue_name,
      venue_address: location.address || current.venue_address,
    }));
    setLocationQuery([location.name, location.address].filter(Boolean).join(" · "));
    setLocationSuggestions([]);
  }

  function toggleUser(userId: string) {
    setForm((current) => ({
      ...current,
      assigned_user_ids: current.assigned_user_ids.includes(userId)
        ? current.assigned_user_ids.filter((id) => id !== userId)
        : [...current.assigned_user_ids, userId],
    }));
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.event_number.trim() || !form.name.trim() || !form.event_date) {
      setError("Event number, event name, and date are required.");
      return;
    }

    const input: AdminEventInput = {
      event_number: form.event_number.trim(),
      name: form.name.trim(),
      event_date: form.event_date,
      client_name: form.client_name.trim() || null,
      venue_name: form.venue_name.trim() || null,
      venue_address: form.venue_address.trim() || null,
      start_time: form.start_time || null,
      end_time: form.end_time || null,
      assigned_user_ids: form.assigned_user_ids,
    };

    try {
      setSaving(true);
      setError("");
      if (editingId) {
        await updateAdminEvent(adminUserId, editingId, input);
      } else {
        await createAdminEvent(adminUserId, input);
      }
      cancel();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save event.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="admin-events-message">Loading events…</div>;

  if (selectedEventId) {
    return (
      <AdminEventDashboard
        adminUserId={adminUserId}
        eventId={selectedEventId}
        onBack={() => setSelectedEventId(null)}
      />
    );
  }

  return (
    <section className="admin-events">
      <div className="admin-events-toolbar">
        <div>
          <strong>{events.length} events</strong>
          <span>Create, edit, and assign employees.</span>
        </div>
        {!formOpen && (
          <button type="button" onClick={() => { setCreating(true); setEditingId(null); setForm(emptyForm); setLocationQuery(""); setLocationSuggestions([]); setManualLocation(false); }}>
            <CalendarPlus size={17} /> New event
          </button>
        )}
      </div>

      {formOpen && (
        <form className="admin-event-form" onSubmit={save}>
          <div className="admin-event-form-heading">
            <div>
              <span>{editingId ? "EDIT EVENT" : "NEW EVENT"}</span>
              <h2>{editingId ? form.name || "Event" : "Create event"}</h2>
            </div>
            <button type="button" onClick={cancel}>Cancel</button>
          </div>

          <div className="admin-event-fields">
            <label><span>Event number</span><input required value={form.event_number} onChange={(e) => setForm({ ...form, event_number: e.target.value })} /></label>
            <label><span>Event name</span><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label><span>Date</span><input required type="date" value={form.event_date} onChange={(e) => setForm({ ...form, event_date: e.target.value })} /></label>
            <label><span>Client</span><input value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} /></label>
            <div className="admin-event-location-field">
              <span>Location</span>
              {!manualLocation ? (
                <>
                  <label className="admin-event-location-search">
                    <Search size={15} />
                    <input
                      value={locationQuery}
                      onChange={(event) => {
                        setLocationQuery(event.target.value);
                        setLocationSuggestions([]);
                        setForm((current) => ({
                          ...current,
                          venue_name: "",
                          venue_address: "",
                        }));
                      }}
                      placeholder="Search venue or address"
                      autoComplete="off"
                    />
                    {locationSearching && <small>Searching…</small>}
                  </label>
                  {locationSuggestions.length > 0 && (
                    <div className="admin-event-location-results">
                      {locationSuggestions.map((location) => (
                        <button type="button" key={location.id ?? `${location.name}-${location.address}`} onClick={() => chooseLocation(location)}>
                          <MapPin size={14} />
                          <span><strong>{location.name || location.address}</strong>{location.address && <small>{location.address}</small>}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {(form.venue_name || form.venue_address) && (
                    <small className="admin-event-selected-location">{[form.venue_name, form.venue_address].filter(Boolean).join(" · ")}</small>
                  )}
                  <button type="button" className="admin-event-manual-location" onClick={() => setManualLocation(true)}>Enter manually</button>
                </>
              ) : (
                <div className="admin-event-manual-grid">
                  <label><span>Venue</span><input value={form.venue_name} onChange={(e) => setForm({ ...form, venue_name: e.target.value })} /></label>
                  <label><span>Address</span><input value={form.venue_address} onChange={(e) => setForm({ ...form, venue_address: e.target.value })} /></label>
                  <button type="button" onClick={() => { setManualLocation(false); setLocationQuery([form.venue_name, form.venue_address].filter(Boolean).join(" · ")); }}>Back to search</button>
                </div>
              )}
            </div>
            <label className="sterling-event-time-field">
              <span>Start time</span>
              <SterlingEventTimeSelectV3
                value={form.start_time}
                onChange={(value) => setForm({ ...form, start_time: value })}
                ariaLabel="Event start time"
              />
            </label>
            <label className="sterling-event-time-field">
              <span>End time</span>
              <SterlingEventTimeSelectV3
                value={form.end_time}
                onChange={(value) => setForm({ ...form, end_time: value })}
                ariaLabel="Event end time"
              />
            </label>
          </div>

          <fieldset className="admin-event-assignments">
            <legend>Assigned employees</legend>
            {activeUsers.map((user) => (
              <label key={user.id}>
                <input type="checkbox" checked={form.assigned_user_ids.includes(user.id)} onChange={() => toggleUser(user.id)} />
                <span><strong>{personDisplayName(user)}</strong><small>{user.role === "admin" ? "Admin" : user.email}</small></span>
              </label>
            ))}
          </fieldset>

          {error && <p className="admin-events-error">{error}</p>}
          <button className="admin-event-save" type="submit" disabled={saving}>
            {saving ? "Saving…" : editingId ? "Save event" : "Create event"}
          </button>
        </form>
      )}

      {!formOpen && error && <p className="admin-events-error">{error}</p>}

      {!formOpen && events.length === 0 ? (
        <div className="admin-events-message"><CalendarPlus size={26} /><strong>No events yet</strong></div>
      ) : !formOpen ? (
        <div className="admin-events-list">
          {events.map((event) => {
            const assigned = event.assigned_user_ids.map((id) => names.get(id)).filter((name): name is string => Boolean(name));
            return (
              <article className="admin-event-card" key={event.id}>
                <button
                  type="button"
                  className="admin-event-open"
                  onClick={() => setSelectedEventId(event.id)}
                >
                  <div className="admin-event-card-main">
                    <span>{event.event_number}</span>
                    <h2>{event.name}</h2>
                    <strong>{eventDate(event.event_date)}</strong>
                    {(event.venue_name || event.venue_address) && (
                      <p><MapPin size={14} />{[event.venue_name, event.venue_address].filter(Boolean).join(" · ")}</p>
                    )}
                    <small>{assigned.length ? `Assigned: ${assigned.join(", ")}` : "No employees assigned"}</small>
                  </div>
                  <ChevronRight size={19} />
                </button>
                <button type="button" className="admin-event-edit" onClick={() => edit(event)}><Pencil size={16} /> Edit</button>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
