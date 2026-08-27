import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarPlus, MapPin, Pencil } from "lucide-react";
import { format } from "date-fns";
import {
  createAdminEvent,
  getAdminEvents,
  getAdminUsers,
  updateAdminEvent,
  type AdminEvent,
  type AdminEventInput,
  type AdminUser,
} from "../lib/api";
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

export default function AdminEvents({ adminUserId }: Props) {
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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

  const activeUsers = useMemo(() => users.filter((user) => user.is_active), [users]);
  const names = useMemo(() => new Map(users.map((user) => [user.id, user.name])), [users]);
  const formOpen = creating || editingId !== null;

  function cancel() {
    setCreating(false);
    setEditingId(null);
    setForm(emptyForm);
    setError("");
  }

  function edit(event: AdminEvent) {
    setCreating(false);
    setEditingId(event.id);
    setForm(toForm(event));
    setError("");
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

  return (
    <section className="admin-events">
      <div className="admin-events-toolbar">
        <div>
          <strong>{events.length} events</strong>
          <span>Create, edit, and assign employees.</span>
        </div>
        {!formOpen && (
          <button type="button" onClick={() => { setCreating(true); setEditingId(null); setForm(emptyForm); }}>
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
            <label><span>Venue</span><input value={form.venue_name} onChange={(e) => setForm({ ...form, venue_name: e.target.value })} /></label>
            <label className="admin-event-address"><span>Venue address</span><input value={form.venue_address} onChange={(e) => setForm({ ...form, venue_address: e.target.value })} /></label>
            <label><span>Start time</span><input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} /></label>
            <label><span>End time</span><input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} /></label>
          </div>

          <fieldset className="admin-event-assignments">
            <legend>Assigned employees</legend>
            {activeUsers.map((user) => (
              <label key={user.id}>
                <input type="checkbox" checked={form.assigned_user_ids.includes(user.id)} onChange={() => toggleUser(user.id)} />
                <span><strong>{user.name}</strong><small>{user.role === "admin" ? "Admin" : user.email}</small></span>
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
                <div className="admin-event-card-main">
                  <span>{event.event_number}</span>
                  <h2>{event.name}</h2>
                  <strong>{eventDate(event.event_date)}</strong>
                  {(event.venue_name || event.venue_address) && (
                    <p><MapPin size={14} />{[event.venue_name, event.venue_address].filter(Boolean).join(" · ")}</p>
                  )}
                  <small>{assigned.length ? `Assigned: ${assigned.join(", ")}` : "No employees assigned"}</small>
                </div>
                <button type="button" onClick={() => edit(event)}><Pencil size={16} /> Edit</button>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
