import { createHash, randomBytes } from "node:crypto";
import { Router } from "express";
import { DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { z } from "zod";
import { db } from "../db/index.js";
import { r2, R2_BUCKET } from "../storage/r2.js";

const router = Router();

const loginSchema = z.object({
  username: z.string().trim().min(1).max(120),
  password: z.string().min(1).max(500),
});

const devLoginSchema = z.object({
  username: z.string().trim().min(1).max(120),
});

const devResetSchema = z.object({
  mode: z.enum(["keep_users", "keep_users_events", "full"]),
  confirm: z.literal("RESET"),
});

const SESSION_COOKIE = "sterling_session";
const SESSION_DAYS = 30;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function getCookie(req: { headers: { cookie?: string } }, name: string) {
  const cookie = req.headers.cookie;

  if (!cookie) {
    return null;
  }

  for (const part of cookie.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");

    if (rawKey === name) {
      return decodeURIComponent(rawValue.join("="));
    }
  }

  return null;
}

async function currentUserFromToken(token: string | null) {
  if (!token) {
    return null;
  }

  const tokenHash = hashToken(token);

  const result = await db.query(
    `
      SELECT
        u.id,
        u.name,
        u.email,
        u.username,
        u.role,
        u.is_active
      FROM auth_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.expires_at > NOW()
        AND u.is_active = TRUE
      LIMIT 1
    `,
    [tokenHash],
  );

  return result.rows[0] ?? null;
}


async function clearDevelopmentR2() {
  let continuationToken: string | undefined;
  let deleted = 0;

  do {
    const page = await r2.send(
      new ListObjectsV2Command({
        Bucket: R2_BUCKET,
        ContinuationToken: continuationToken,
      }),
    );

    const objects = (page.Contents ?? [])
      .map(({ Key }) => Key)
      .filter((key): key is string => Boolean(key))
      .map((Key) => ({ Key }));

    if (objects.length > 0) {
      await r2.send(
        new DeleteObjectsCommand({
          Bucket: R2_BUCKET,
          Delete: {
            Objects: objects,
            Quiet: true,
          },
        }),
      );
      deleted += objects.length;
    }

    continuationToken = page.IsTruncated
      ? page.NextContinuationToken
      : undefined;
  } while (continuationToken);

  return deleted;
}

router.post("/dev-reset", async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({ error: "Not found" });
  }

  const parsed = devResetSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid development reset request" });
  }

  const deletedR2Objects = await clearDevelopmentR2();
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const activityTables = [
      "expense_attachments",
      "reimbursement_attachments",
      "expenses",
      "mileage_entries",
      "event_sessions",
      "reimbursements",
      "attachments",
      "audit_log",
      "auth_sessions",
    ];

    if (parsed.data.mode === "keep_users" || parsed.data.mode === "full") {
      activityTables.push("event_assignments", "events");
    }

    await client.query(
      `TRUNCATE TABLE ${activityTables.join(", ")} RESTART IDENTITY CASCADE`,
    );

    if (parsed.data.mode === "full") {
      // Keep only the two development identities so the app remains usable
      // after a destructive demo reset. Everything else is removed.
      await client.query(
        `
          DELETE FROM users
          WHERE LOWER(COALESCE(username, '')) NOT IN ('jill', 'josh d')
        `,
      );

      await client.query(
        `
          UPDATE users
          SET is_active = TRUE, updated_at = NOW()
          WHERE LOWER(COALESCE(username, '')) IN ('jill', 'josh d')
        `,
      );
    }

    await client.query("COMMIT");

    const counts = await db.query(`
      SELECT
        (SELECT COUNT(*)::int FROM users) AS users,
        (SELECT COUNT(*)::int FROM events) AS events,
        (SELECT COUNT(*)::int FROM event_assignments) AS assignments,
        (SELECT COUNT(*)::int FROM expenses) AS expenses,
        (SELECT COUNT(*)::int FROM mileage_entries) AS mileage,
        (SELECT COUNT(*)::int FROM reimbursements) AS reimbursements,
        (SELECT COUNT(*)::int FROM attachments) AS attachments,
        (SELECT COUNT(*)::int FROM event_sessions WHERE ended_at IS NULL) AS active_events,
        (SELECT COUNT(*)::int FROM audit_log) AS audits
    `);

    return res.json({
      ok: true,
      mode: parsed.data.mode,
      deleted_r2_objects: deletedR2Objects,
      counts: counts.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

router.post("/dev-login", async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({ error: "Not found" });
  }

  const parsed = devLoginSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: "Username is required" });
  }

  const allowed = new Set(["jill", "josh d"]);
  const username = parsed.data.username.trim();

  if (!allowed.has(username.toLowerCase())) {
    return res.status(403).json({ error: "Development quick login is not allowed for this user" });
  }

  const result = await db.query(
    `
      SELECT
        id,
        name,
        email,
        username,
        role,
        is_active
      FROM users
      WHERE LOWER(username) = LOWER($1)
        AND is_active = TRUE
      LIMIT 1
    `,
    [username],
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Development user not found" });
  }

  const user = result.rows[0];
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);

  await db.query(`DELETE FROM auth_sessions WHERE expires_at <= NOW()`);

  await db.query(
    `
      INSERT INTO auth_sessions (
        user_id,
        token_hash,
        expires_at
      )
      VALUES (
        $1,
        $2,
        NOW() + INTERVAL '${SESSION_DAYS} days'
      )
    `,
    [user.id, tokenHash],
  );

  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: "/",
  });

  return res.json(user);
});

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: "Username and password are required" });
  }

  const { username, password } = parsed.data;

  const result = await db.query(
    `
      SELECT
        id,
        name,
        email,
        username,
        role,
        is_active
      FROM users
      WHERE LOWER(username) = LOWER($1)
        AND password_hash IS NOT NULL
        AND password_hash = crypt($2, password_hash)
      LIMIT 1
    `,
    [username, password],
  );

  if (result.rows.length === 0) {
    return res.status(401).json({ error: "Incorrect username or password" });
  }

  const user = result.rows[0];

  if (!user.is_active) {
    return res.status(403).json({ error: "This account is inactive" });
  }

  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);

  await db.query(
    `
      DELETE FROM auth_sessions
      WHERE expires_at <= NOW()
    `,
  );

  await db.query(
    `
      INSERT INTO auth_sessions (
        user_id,
        token_hash,
        expires_at
      )
      VALUES (
        $1,
        $2,
        NOW() + INTERVAL '${SESSION_DAYS} days'
      )
    `,
    [user.id, tokenHash],
  );

  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: "/",
  });

  return res.json(user);
});

router.get("/me", async (req, res) => {
  const user = await currentUserFromToken(
    getCookie(req, SESSION_COOKIE),
  );

  if (!user) {
    return res.status(401).json({ error: "Not signed in" });
  }

  return res.json(user);
});

router.post("/logout", async (req, res) => {
  const token = getCookie(req, SESSION_COOKIE);

  if (token) {
    await db.query(
      `DELETE FROM auth_sessions WHERE token_hash = $1`,
      [hashToken(token)],
    );
  }

  res.clearCookie(SESSION_COOKIE, { path: "/" });
  return res.status(204).send();
});

export default router;
