import { useCallback, useEffect, useMemo, useState } from "react";
import { UserPlus } from "lucide-react";
import {
  createAdminUser,
  getAdminUsers,
  setAdminUserActive,
  type AdminUser,
} from "../lib/api";
import "./AdminPeople.css";

type AdminPeopleProps = {
  adminUserId: string;
};

export default function AdminPeople({ adminUserId }: AdminPeopleProps) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changingUserId, setChangingUserId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const loadUsers = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      setUsers(await getAdminUsers(adminUserId));
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not load people.",
      );
    } finally {
      setLoading(false);
    }
  }, [adminUserId]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const activeCount = useMemo(
    () => users.filter((user) => user.is_active).length,
    [users],
  );

  const inactiveCount = users.length - activeCount;

  async function handleAddEmployee(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const trimmedUsername = username.trim();

    if (!trimmedName || !trimmedEmail || !trimmedUsername || !password) {
      return;
    }

    try {
      setSaving(true);
      setError("");

      await createAdminUser(adminUserId, {
        name: trimmedName,
        email: trimmedEmail,
        username: trimmedUsername,
        password,
      });

      setName("");
      setEmail("");
      setUsername("");
      setPassword("");
      await loadUsers();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not add employee.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(user: AdminUser) {
    try {
      setChangingUserId(user.id);
      setError("");

      const updated = await setAdminUserActive(
        adminUserId,
        user.id,
        !user.is_active,
      );

      setUsers((current) =>
        current
          .map((entry) =>
            entry.id === updated.id ? updated : entry,
          )
          .sort((a, b) => {
            if (a.is_active !== b.is_active) {
              return a.is_active ? -1 : 1;
            }

            return a.name.localeCompare(b.name);
          }),
      );
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not update employee.",
      );
    } finally {
      setChangingUserId(null);
    }
  }

  return (
    <section className="admin-people">
      <form
        className="admin-people-add"
        onSubmit={(event) => {
          void handleAddEmployee(event);
        }}
      >
        <div className="admin-people-add-heading">
          <div className="admin-people-add-icon">
            <UserPlus size={20} />
          </div>

          <div>
            <h2>Add employee</h2>
            <p>New employees are active immediately.</p>
          </div>
        </div>

        <div className="admin-people-fields">
          <label>
            <span>Name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Employee name"
              autoComplete="name"
            />
          </label>

          <label>
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="employee@sterling.com"
              autoComplete="email"
            />
          </label>

          <label>
            <span>Username</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Employee username"
              autoComplete="off"
            />
          </label>

          <label>
            <span>Temporary password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 4 characters"
              autoComplete="new-password"
            />
          </label>

          <button
            type="submit"
            disabled={saving || !name.trim() || !email.trim() || !username.trim() || password.length < 4}
          >
            {saving ? "Adding…" : "Add employee"}
          </button>
        </div>
      </form>

      <div className="admin-people-list-heading">
        <div>
          <h2>People</h2>
          <p>
            {activeCount} active
            {inactiveCount > 0 ? ` · ${inactiveCount} inactive` : ""}
          </p>
        </div>

        <span>History is never deleted.</span>
      </div>

      {error && (
        <div className="admin-people-error" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <div className="admin-people-message">Loading people…</div>
      ) : users.length === 0 ? (
        <div className="admin-people-message">No users yet.</div>
      ) : (
        <div className="admin-people-list">
          {users.map((user) => {
            const isCurrentAdmin = user.id === adminUserId;
            const changing = changingUserId === user.id;

            return (
              <article className="admin-person-row" key={user.id}>
                <div className="admin-person-main">
                  <div>
                    <strong>{user.name}</strong>
                    <span>{user.email}</span>
                    {user.username && <span>@{user.username}</span>}
                  </div>

                  <div className="admin-person-badges">
                    <span className={`admin-person-status ${user.is_active ? "active" : "inactive"}`}>
                      {user.is_active ? "Active" : "Inactive"}
                    </span>

                    {user.role === "admin" && (
                      <span className="admin-person-role">Admin</span>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  className={user.is_active ? "admin-person-deactivate" : "admin-person-reactivate"}
                  disabled={changing || isCurrentAdmin}
                  onClick={() => {
                    void handleStatusChange(user);
                  }}
                  title={
                    isCurrentAdmin
                      ? "The current admin cannot deactivate their own account"
                      : undefined
                  }
                >
                  {isCurrentAdmin
                    ? "Current admin"
                    : changing
                      ? "Saving…"
                      : user.is_active
                        ? "Deactivate"
                        : "Reactivate"}
                </button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
