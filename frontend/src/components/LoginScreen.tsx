import { useEffect, useState } from "react";
import { LogIn } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import ThemeToggle from "./ThemeToggle";
import "./LoginScreen.css";

export default function LoginScreen() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [resetMessage, setResetMessage] = useState("");
  const [canLoadDemo, setCanLoadDemo] = useState(false);
  const [isDemo, setIsDemo] = useState(false);
  const [devUsers, setDevUsers] = useState<Array<{ username: string; role: "user" | "admin" }>>([]);

  async function loadDevUsers() {
    if (!import.meta.env.DEV) return;

    const response = await fetch("/api/auth/dev-users");
    if (!response.ok) return;

    const body = await response.json().catch(() => ({})) as {
      users?: Array<{ username: string; role: "user" | "admin" }>;
      can_load_demo?: boolean;
      is_demo?: boolean;
    };

    setDevUsers(body.users ?? []);
    setCanLoadDemo(Boolean(body.can_load_demo));
    setIsDemo(Boolean(body.is_demo));
  }

  useEffect(() => {
    void loadDevUsers();
  }, []);

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

  async function handleDevLogin(username: string) {
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

  async function handleDevReset() {
    const confirmed = window.confirm(
      "RESET APP: Delete all development activity, receipt files, Events, assignments, and non-admin users?",
    );

    if (!confirmed) return;

    try {
      setSubmitting(true);
      setError("");
      setResetMessage("");

      const response = await fetch("/api/auth/dev-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "full", confirm: "RESET" }),
      });

      const body = await response.json().catch(() => ({})) as {
        error?: string;
        deleted_r2_objects?: number;
      };

      if (!response.ok) {
        throw new Error(body.error ?? "Could not reset development data.");
      }

      setResetMessage("App reset.");
      await loadDevUsers();
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

  async function handleLoadDemo() {
    const confirmed = window.confirm(
      "LOAD DEMO DATA: Add 3 clearly labeled DEMO employees and 2 DEMO Events with sample expenses, mileage, tolls, and one flagged receipt? This only works on a clean workspace.",
    );

    if (!confirmed) return;

    try {
      setSubmitting(true);
      setError("");
      setResetMessage("");

      const response = await fetch("/api/auth/dev-demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "DEMO" }),
      });

      const body = await response.json().catch(() => ({})) as {
        error?: string;
        users?: number;
        events?: number;
      };

      if (!response.ok) {
        throw new Error(body.error ?? "Could not load demo data.");
      }

      setResetMessage(
        `Demo loaded · ${body.users ?? 3} employees · ${body.events ?? 2} Events`,
      );
      await loadDevUsers();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not load demo data.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-screen">
      <div className="login-shell">
        <div className="login-theme-toggle"><ThemeToggle /></div>
        {import.meta.env.DEV && isDemo && devUsers.length > 0 && (
          <div className="dev-login-buttons" aria-label="Development quick sign in">
            {devUsers.map((devUser) => (
              <button
                key={devUser.username}
                type="button"
                disabled={submitting}
                onClick={() => void handleDevLogin(devUser.username)}
              >
                <span className="dev-login-name">{devUser.username}</span>
                <span className="dev-login-role">
                  {devUser.role === "admin" ? "Admin" : "Employee"}
                </span>
              </button>
            ))}
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
          <section className="dev-reset-panel" aria-label="Development controls">
            <button
              type="button"
              className="dev-reset-full"
              disabled={submitting}
              onClick={() => void handleDevReset()}
            >
              RESET APP
            </button>
            <button
              type="button"
              className="dev-demo-load"
              disabled={submitting || !canLoadDemo}
              title={canLoadDemo ? "Load sample Sterling data" : "Reset app first to load demo data"}
              onClick={() => void handleLoadDemo()}
            >
              LOAD DEMO DATA
            </button>
            {resetMessage && <p className="dev-reset-success">{resetMessage}</p>}
          </section>
        )}
      </div>
    </main>
  );
}
