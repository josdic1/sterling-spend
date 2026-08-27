import { useState } from "react";
import { LogIn } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import "./LoginScreen.css";

export default function LoginScreen() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [resetMessage, setResetMessage] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!username.trim() || !password) return;

    try {
      setSubmitting(true);
      setError("");
      setResetMessage("");
      const user = await login(username.trim(), password);
      navigate(user.role === "admin" ? "/admin" : "/", { replace: true });
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not sign in.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDevLogin(username: "Jill" | "Josh D") {
    try {
      setSubmitting(true);
      setError("");
      setResetMessage("");

      const response = await fetch("/api/auth/dev-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });

      const body = await response.json().catch(() => ({})) as {
        error?: string;
        role?: "user" | "admin";
      };

      if (!response.ok || !body.role) {
        throw new Error(body.error ?? "Could not use development sign in.");
      }

      window.location.assign(body.role === "admin" ? "/admin" : "/");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not use development sign in.",
      );
      setSubmitting(false);
    }
  }

  async function handleDevReset(mode: "keep_users" | "keep_users_events" | "full") {
    const message = mode === "keep_users_events"
      ? "DEVELOPMENT RESET: Delete all activity and receipt files, but keep users, Events, and Event assignments?"
      : mode === "keep_users"
        ? "DEVELOPMENT RESET: Delete all activity, receipt files, Events, and assignments, but keep users?"
        : "FULL DEVELOPMENT WIPE: Delete all activity, receipt files, Events, assignments, and all non-core users? Jill and Josh D are kept only so development quick login still works.";

    const confirmed = window.confirm(message);

    if (!confirmed) return;

    try {
      setSubmitting(true);
      setError("");
      setResetMessage("");

      const response = await fetch("/api/auth/dev-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, confirm: "RESET" }),
      });

      const body = await response.json().catch(() => ({})) as {
        error?: string;
        deleted_r2_objects?: number;
        counts?: {
          users: number;
          events: number;
          assignments: number;
          expenses: number;
          mileage: number;
          reimbursements: number;
          attachments: number;
          active_events: number;
          audits: number;
        };
      };

      if (!response.ok || !body.counts) {
        throw new Error(body.error ?? "Could not reset development data.");
      }

      setResetMessage(
        `Reset complete · ${body.counts.users} users · ${body.counts.events} events · ${body.counts.expenses} expenses · ${body.deleted_r2_objects ?? 0} R2 files deleted`,
      );
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not reset development data.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-screen">
      <div className="login-shell">
        {import.meta.env.DEV && (
          <div className="dev-login-buttons" aria-label="Development quick sign in">
            <button
              type="button"
              disabled={submitting}
              onClick={() => void handleDevLogin("Jill")}
            >
              JILL
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => void handleDevLogin("Josh D")}
            >
              JOSH
            </button>
          </div>
        )}

        <section className="login-card">
        <div className="login-brand">
          <strong>STERLING</strong>
          <span>Spend</span>
        </div>

        <div className="login-heading">
          <h1>Sign in</h1>
          <p>Expenses without the paperwork.</p>
        </div>

        <form onSubmit={(event) => void handleSubmit(event)}>
          <label>
            <span>Username</span>
            <input
              autoFocus
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>

          <label>
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          {error && <div className="login-error" role="alert">{error}</div>}

          <button
            type="submit"
            disabled={submitting || !username.trim() || !password}
          >
            <LogIn size={18} />
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
        </section>

        {import.meta.env.DEV && (
          <section className="dev-reset-panel" aria-label="Development reset controls">
            <span>DEVELOPMENT RESET</span>
            <button
              type="button"
              disabled={submitting}
              onClick={() => void handleDevReset("keep_users")}
            >
              CLEAR ALL DATA EXCEPT USERS
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => void handleDevReset("keep_users_events")}
            >
              CLEAR ALL DATA EXCEPT USERS AND EVENTS
            </button>
            <button
              type="button"
              className="dev-reset-full"
              disabled={submitting}
              onClick={() => void handleDevReset("full")}
            >
              FULL WIPE — KEEP JILL + JOSH
            </button>
            {resetMessage && <p className="dev-reset-success">{resetMessage}</p>}
          </section>
        )}
      </div>
    </main>
  );
}
