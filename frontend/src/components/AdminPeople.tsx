import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Save, UserPlus, X } from "lucide-react";
import {
  createAdminUser,
  getAdminUsers,
  setAdminUserActive,
  updateAdminUser,
  type AdminUser,
} from "../lib/api";
import { personDisplayName } from "../lib/demo-display";
import "./AdminPeople.css";

type AdminPeopleProps = {
  adminUserId: string;
};

type EditDraft = {
  name: string;
  jobRole: string;
  email: string;
  username: string;
  password: string;
};

function splitPersonName(value: string) {
  const [namePart, ...roleParts] = value.split(" · ");
  return {
    name: namePart.trim(),
    jobRole: roleParts.join(" · ").trim(),
  };
}

function composePersonName(name: string, jobRole: string) {
  const cleanName = name.trim();
  const cleanRole = jobRole.trim();
  return cleanRole ? `${cleanName} · ${cleanRole}` : cleanName;
}

export default function AdminPeople({ adminUserId }: AdminPeopleProps) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [name, setName] = useState("");
  const [jobRole, setJobRole] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changingUserId, setChangingUserId] = useState<string | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [error, setError] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);

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
    const trimmedJobRole = jobRole.trim();
    const trimmedEmail = email.trim();
    const trimmedUsername = username.trim();

    if (!trimmedName || !trimmedJobRole || !trimmedEmail || !trimmedUsername || !password) {
      return;
    }

    try {
      setSaving(true);
      setError("");

      await createAdminUser(adminUserId, {
        name: composePersonName(trimmedName, trimmedJobRole),
        email: trimmedEmail,
        username: trimmedUsername,
        password,
      });

      setName("");
      setJobRole("");
      setEmail("");
      setUsername("");
      setPassword("");
      setShowAddForm(false);
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

  function beginEdit(user: AdminUser) {
    const parsedName = splitPersonName(personDisplayName(user));
    setEditingUserId(user.id);
    setEditDraft({
      name: parsedName.name,
      jobRole: parsedName.jobRole,
      email: user.email,
      username: user.username ?? "",
      password: "",
    });
    setError("");
  }

  function cancelEdit() {
    setEditingUserId(null);
    setEditDraft(null);
  }

  async function saveEdit(user: AdminUser) {
    if (!editDraft) return;

    const trimmedName = editDraft.name.trim();
    const trimmedJobRole = editDraft.jobRole.trim();
    const trimmedEmail = editDraft.email.trim();
    const trimmedUsername = editDraft.username.trim();

    if (!trimmedName || !trimmedEmail || !trimmedUsername) return;
    if (editDraft.password && editDraft.password.length < 4) return;

    try {
      setChangingUserId(user.id);
      setError("");

      const updated = await updateAdminUser(adminUserId, user.id, {
        name: composePersonName(trimmedName, trimmedJobRole),
        email: trimmedEmail,
        username: trimmedUsername,
        ...(editDraft.password ? { password: editDraft.password } : {}),
      });

      setUsers((current) =>
        current.map((entry) =>
          entry.id === updated.id ? updated : entry,
        ),
      );
      cancelEdit();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not save employee.",
      );
    } finally {
      setChangingUserId(null);
    }
  }

  return (
    <section className="admin-people">
      <div className="admin-people-toolbar">
        <div>
          <strong>{activeCount} active{inactiveCount > 0 ? ` · ${inactiveCount} inactive` : ""}</strong>
          <span>Employees</span>
        </div>
        {!showAddForm && (
          <button type="button" onClick={() => setShowAddForm(true)}>
            <UserPlus size={16} /> Add employee
          </button>
        )}
      </div>

      {showAddForm && (
        <form
          className="admin-people-add"
          onSubmit={(event) => { void handleAddEmployee(event); }}
        >
          <div className="admin-people-add-heading">
            <div>
              <h2>Add employee</h2>
              <p>New employees are active immediately.</p>
            </div>
            <button type="button" className="admin-people-add-close" onClick={() => setShowAddForm(false)} aria-label="Close add employee">
              <X size={18} />
            </button>
          </div>

          <div className="admin-people-fields">
            <label><span>Name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Employee name" autoComplete="name" /></label>
            <label><span>Role</span><input value={jobRole} onChange={(event) => setJobRole(event.target.value)} placeholder="Waitstaff, Kitchen, Manager…" autoComplete="off" /></label>
            <label><span>Email</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="employee@sterling.com" autoComplete="email" /></label>
            <label><span>Username</span><input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Employee username" autoComplete="off" /></label>
            <label><span>Temporary password</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 4 characters" autoComplete="new-password" /></label>
            <button type="submit" disabled={saving || !name.trim() || !jobRole.trim() || !email.trim() || !username.trim() || password.length < 4}>
              {saving ? "Adding…" : "Add employee"}
            </button>
          </div>
        </form>
      )}

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
            const editing = editingUserId === user.id && editDraft !== null;

            return (
              <article className={`admin-person-row ${editing ? "editing" : ""}`} key={user.id}>
                {editing ? (
                  <div className="admin-person-edit-grid">
                    <label>
                      <span>Name</span>
                      <input
                        value={editDraft.name}
                        onChange={(event) => setEditDraft({ ...editDraft, name: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>Role</span>
                      <input
                        value={editDraft.jobRole}
                        placeholder="Waitstaff, Kitchen, Manager…"
                        onChange={(event) => setEditDraft({ ...editDraft, jobRole: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>Email</span>
                      <input
                        type="email"
                        value={editDraft.email}
                        onChange={(event) => setEditDraft({ ...editDraft, email: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>Username</span>
                      <input
                        value={editDraft.username}
                        onChange={(event) => setEditDraft({ ...editDraft, username: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>New password <em>optional</em></span>
                      <input
                        type="password"
                        value={editDraft.password}
                        placeholder="Leave blank to keep current"
                        autoComplete="new-password"
                        onChange={(event) => setEditDraft({ ...editDraft, password: event.target.value })}
                      />
                    </label>

                    <div className="admin-person-edit-actions">
                      <button
                        type="button"
                        className="admin-person-save"
                        disabled={
                          changing ||
                          !editDraft.name.trim() ||
                          !editDraft.email.trim() ||
                          !editDraft.username.trim() ||
                          Boolean(editDraft.password && editDraft.password.length < 4)
                        }
                        onClick={() => void saveEdit(user)}
                      >
                        <Save size={15} />
                        {changing ? "Saving…" : "Save"}
                      </button>
                      <button
                        type="button"
                        className="admin-person-cancel"
                        disabled={changing}
                        onClick={cancelEdit}
                      >
                        <X size={15} />
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="admin-person-main">
                      <div>
                        <strong>{personDisplayName(user)}</strong>
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

                    <div className="admin-person-actions">
                      <button
                        type="button"
                        className="admin-person-edit"
                        disabled={changing}
                        onClick={() => beginEdit(user)}
                      >
                        <Pencil size={14} />
                        Edit
                      </button>
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
                    </div>
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
