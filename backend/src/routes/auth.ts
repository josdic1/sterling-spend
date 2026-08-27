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

const devDemoSchema = z.object({
  confirm: z.literal("DEMO"),
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

async function isDevelopmentDemoMode() {
  const result = await db.query(`
    SELECT EXISTS (
      SELECT 1
      FROM audit_log
      WHERE action IN ('demo_loaded', 'demo_mode_enabled')
    ) AS enabled
  `);

  return Boolean(result.rows[0]?.enabled);
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

  if (parsed.data.mode === "full") {
    const adminCountResult = await db.query(
      `SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin'`,
    );

    if (Number(adminCountResult.rows[0]?.count ?? 0) === 0) {
      return res.status(409).json({
        error: "Full wipe blocked because Sterling Spend has no admin account",
      });
    }
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
      // Full wipe removes every non-admin identity. Admins are structural:
      // the app must never be left without a controller who can manage it.
      await client.query(
        `DELETE FROM users WHERE role <> 'admin'`,
      );

      // Preserve existing admin state. If legacy/dev data somehow has no
      // active admin, reactivate the oldest admin rather than locking the app.
      await client.query(
        `
          UPDATE users
          SET is_active = TRUE, updated_at = NOW()
          WHERE id = (
            SELECT id
            FROM users
            WHERE role = 'admin'
            ORDER BY created_at, id
            LIMIT 1
          )
          AND NOT EXISTS (
            SELECT 1
            FROM users
            WHERE role = 'admin'
              AND is_active = TRUE
          )
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

router.post("/dev-demo", async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({ error: "Not found" });
  }

  const parsed = devDemoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid demo data request" });
  }

  const existing = await db.query(`
    SELECT
      (SELECT COUNT(*)::int FROM users WHERE role <> 'admin') AS non_admin_users,
      (SELECT COUNT(*)::int FROM events) AS events,
      (SELECT COUNT(*)::int FROM event_assignments) AS assignments,
      (SELECT COUNT(*)::int FROM expenses) AS expenses,
      (SELECT COUNT(*)::int FROM mileage_entries) AS mileage,
      (SELECT COUNT(*)::int FROM reimbursements) AS reimbursements,
      (SELECT COUNT(*)::int FROM attachments) AS attachments,
      (SELECT COUNT(*)::int FROM event_sessions) AS sessions
  `);

  const state = existing.rows[0];
  const isClean = Object.values(state).every((value) => Number(value ?? 0) === 0);

  if (!isClean) {
    return res.status(409).json({
      error: "Demo data only loads into a clean workspace. Use FULL WIPE first.",
    });
  }

  const adminResult = await db.query(`
    SELECT id
    FROM users
    WHERE role = 'admin'
      AND is_active = TRUE
    ORDER BY created_at, id
    LIMIT 1
  `);

  if (adminResult.rows.length === 0) {
    return res.status(409).json({ error: "Demo data needs an active admin account" });
  }

  const rateResult = await db.query(`
    SELECT id, rate_per_mile
    FROM mileage_rates
    WHERE effective_from <= CURRENT_DATE
      AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
    ORDER BY effective_from DESC
    LIMIT 1
  `);

  if (rateResult.rows.length === 0) {
    return res.status(409).json({ error: "No active mileage rate is configured" });
  }

  const categoryResult = await db.query(`
    SELECT id, name
    FROM expense_categories
    WHERE is_active = TRUE
  `);
  const categoryIds = new Map<string, string>(
    categoryResult.rows.map((row) => [row.name, row.id]),
  );
  const requiredCategories = ["Catering Supplies", "Staff Meals", "Parking", "Tolls"];
  const missingCategory = requiredCategories.find((name) => !categoryIds.has(name));
  if (missingCategory) {
    return res.status(409).json({ error: `Missing demo category: ${missingCategory}` });
  }

  const adminId = adminResult.rows[0].id as string;
  const mileageRateId = rateResult.rows[0].id as string;
  const mileageRate = Number(rateResult.rows[0].rate_per_mile);
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    async function createDemoUser(name: string, username: string, email: string) {
      const result = await client.query(
        `INSERT INTO users (
          name, email, username, password_hash, role, is_active
        ) VALUES (
          $1, $2, $3, crypt('demo', gen_salt('bf', 12)), 'user', TRUE
        )
        RETURNING id, name`,
        [name, email, username],
      );
      return result.rows[0] as { id: string; name: string };
    }

    async function createReimbursement(userId: string, status: "open" | "submitted") {
      const result = await client.query(
        `INSERT INTO reimbursements (
          user_id, year, month, status, submitted_at
        ) VALUES (
          $1,
          EXTRACT(YEAR FROM CURRENT_DATE)::int,
          EXTRACT(MONTH FROM CURRENT_DATE)::int,
          $2,
          CASE WHEN $2::reimbursement_status = 'submitted' THEN NOW() ELSE NULL END
        )
        RETURNING id`,
        [userId, status],
      );
      return result.rows[0].id as string;
    }

    async function addExpense(args: {
      reimbursementId: string;
      eventId: string;
      category: string;
      dateOffset?: number;
      vendor: string;
      description: string;
      amount: number;
      createdOffsetMinutes: number;
    }) {
      const result = await client.query(
        `INSERT INTO expenses (
          reimbursement_id, event_id, category_id, expense_date,
          vendor, description, claimed_amount, approved_amount, created_at, updated_at
        ) VALUES (
          $1, $2, $3,
          CURRENT_DATE + ($4::int * INTERVAL '1 day'),
          $5, $6, $7, $7,
          NOW() + ($8::int * INTERVAL '1 minute'),
          NOW() + ($8::int * INTERVAL '1 minute')
        )
        RETURNING id`,
        [
          args.reimbursementId,
          args.eventId,
          categoryIds.get(args.category),
          args.dateOffset ?? 0,
          args.vendor,
          args.description,
          args.amount,
          args.createdOffsetMinutes,
        ],
      );
      return result.rows[0].id as string;
    }

    async function addTravel(args: {
      reimbursementId: string;
      eventId: string;
      userId: string;
      dateOffset?: number;
      miles: number;
      plannedTolls: number;
      startedOffsetMinutes: number;
      endedOffsetMinutes: number | null;
    }) {
      const mileageAmount = Math.round(args.miles * mileageRate * 100) / 100;
      const sessionResult = await client.query(
        `INSERT INTO event_sessions (
          user_id, event_id, started_at, ended_at,
          planned_miles, planned_tolls_amount, mileage_rate_id,
          planned_mileage_amount, travel_calculated_at
        ) VALUES (
          $1, $2,
          NOW() + ($3::int * INTERVAL '1 minute'),
          CASE WHEN $4::int IS NULL THEN NULL ELSE NOW() + ($4::int * INTERVAL '1 minute') END,
          $5, $6, $7, $8, NOW()
        )
        RETURNING id`,
        [
          args.userId,
          args.eventId,
          args.startedOffsetMinutes,
          args.endedOffsetMinutes,
          args.miles,
          args.plannedTolls,
          mileageRateId,
          mileageAmount,
        ],
      );
      const sessionId = sessionResult.rows[0].id as string;

      await client.query(
        `INSERT INTO mileage_entries (
          reimbursement_id, event_id, trip_date, source,
          claimed_miles, approved_miles, mileage_rate_id,
          planned_tolls_amount, event_session_id, created_at, updated_at
        ) VALUES (
          $1, $2,
          CURRENT_DATE + ($3::int * INTERVAL '1 day'),
          'automatic', $4, $4, $5, $6, $7,
          NOW() + ($8::int * INTERVAL '1 minute'),
          NOW() + ($8::int * INTERVAL '1 minute')
        )`,
        [
          args.reimbursementId,
          args.eventId,
          args.dateOffset ?? 0,
          args.miles,
          mileageRateId,
          args.plannedTolls,
          sessionId,
          args.endedOffsetMinutes ?? -5,
        ],
      );
    }

    const avery = await createDemoUser(
      "DEMO — Avery Cole",
      "Demo Avery",
      "avery@demo.sterling.local",
    );
    const maya = await createDemoUser(
      "DEMO — Maya Chen",
      "Demo Maya",
      "maya@demo.sterling.local",
    );
    const luis = await createDemoUser(
      "DEMO — Luis Romero",
      "Demo Luis",
      "luis@demo.sterling.local",
    );

    const todayEventResult = await client.query(`
      INSERT INTO events (
        event_number, name, event_date, event_type,
        venue_name, venue_address, client_name,
        start_time, end_time, status
      ) VALUES (
        'DEMO-TODAY-001', 'DEMO — Harborview Wedding', CURRENT_DATE, 'Wedding',
        'DEMO — Harborview Hall', 'Jersey City, NJ', 'DEMO Client',
        '08:00', '18:00', 'active'
      ) RETURNING id
    `);
    const completedEventResult = await client.query(`
      INSERT INTO events (
        event_number, name, event_date, event_type,
        venue_name, venue_address, client_name,
        start_time, end_time, status
      ) VALUES (
        'DEMO-PRIOR-001', 'DEMO — Riverside Gala', CURRENT_DATE - 1, 'Gala',
        'DEMO — Riverside Pavilion', 'New Brunswick, NJ', 'DEMO Client',
        '15:00', '22:00', 'completed'
      ) RETURNING id
    `);
    const todayEventId = todayEventResult.rows[0].id as string;
    const completedEventId = completedEventResult.rows[0].id as string;

    for (const userId of [avery.id, maya.id]) {
      await client.query(
        `INSERT INTO event_assignments (event_id, user_id) VALUES ($1, $2)`,
        [todayEventId, userId],
      );
    }
    await client.query(
      `INSERT INTO event_assignments (event_id, user_id) VALUES ($1, $2)`,
      [completedEventId, luis.id],
    );

    const averyReimbursement = await createReimbursement(avery.id, "open");
    const mayaReimbursement = await createReimbursement(maya.id, "open");
    const luisReimbursement = await createReimbursement(luis.id, "submitted");

    await addTravel({
      reimbursementId: averyReimbursement,
      eventId: todayEventId,
      userId: avery.id,
      miles: 42.6,
      plannedTolls: 12.75,
      startedOffsetMinutes: -120,
      endedOffsetMinutes: null,
    });
    await addTravel({
      reimbursementId: mayaReimbursement,
      eventId: todayEventId,
      userId: maya.id,
      miles: 36.2,
      plannedTolls: 9.5,
      startedOffsetMinutes: -180,
      endedOffsetMinutes: -45,
    });
    await addTravel({
      reimbursementId: luisReimbursement,
      eventId: completedEventId,
      userId: luis.id,
      dateOffset: -1,
      miles: 51.4,
      plannedTolls: 8.25,
      startedOffsetMinutes: -1620,
      endedOffsetMinutes: -1260,
    });

    await addExpense({
      reimbursementId: averyReimbursement,
      eventId: todayEventId,
      category: "Catering Supplies",
      vendor: "DEMO — Restaurant Supply",
      description: "Disposable serving supplies",
      amount: 84.36,
      createdOffsetMinutes: -105,
    });
    await addExpense({
      reimbursementId: averyReimbursement,
      eventId: todayEventId,
      category: "Staff Meals",
      vendor: "DEMO — Corner Market",
      description: "Crew breakfast",
      amount: 18.45,
      createdOffsetMinutes: -85,
    });
    await addExpense({
      reimbursementId: averyReimbursement,
      eventId: todayEventId,
      category: "Tolls",
      vendor: "DEMO — NJ Toll",
      description: "E-ZPass toll evidence",
      amount: 12.75,
      createdOffsetMinutes: -70,
    });
    await addExpense({
      reimbursementId: mayaReimbursement,
      eventId: todayEventId,
      category: "Parking",
      vendor: "DEMO — Event Parking",
      description: "Event parking",
      amount: 22.0,
      createdOffsetMinutes: -50,
    });
    await addExpense({
      reimbursementId: mayaReimbursement,
      eventId: todayEventId,
      category: "Tolls",
      vendor: "DEMO — NJ Toll",
      description: "E-ZPass toll evidence",
      amount: 9.5,
      createdOffsetMinutes: -35,
    });

    const flaggedExpenseId = await addExpense({
      reimbursementId: luisReimbursement,
      eventId: completedEventId,
      category: "Catering Supplies",
      dateOffset: -1,
      vendor: "DEMO — Kitchen Supply",
      description: "Serving trays and utensils",
      amount: 127.8,
      createdOffsetMinutes: -1500,
    });
    await addExpense({
      reimbursementId: luisReimbursement,
      eventId: completedEventId,
      category: "Staff Meals",
      dateOffset: -1,
      vendor: "DEMO — Deli",
      description: "Crew dinner",
      amount: 24.6,
      createdOffsetMinutes: -1400,
    });
    await addExpense({
      reimbursementId: luisReimbursement,
      eventId: completedEventId,
      category: "Tolls",
      dateOffset: -1,
      vendor: "DEMO — NJ Toll",
      description: "E-ZPass toll evidence",
      amount: 8.25,
      createdOffsetMinutes: -1300,
    });

    await client.query(
      `INSERT INTO audit_log (
        entity_type, entity_id, action, field_name,
        old_value, new_value, changed_by_user_id, reason, changed_at
      ) VALUES (
        'expense', $1, 'employee_flagged', 'receipt_issue',
        NULL, 'flagged', $2,
        'Receipt includes a personal item — remove $18.00.',
        NOW() - INTERVAL '20 hours'
      )`,
      [flaggedExpenseId, luis.id],
    );

    await client.query(
      `INSERT INTO audit_log (
        entity_type, entity_id, action, field_name,
        old_value, new_value, changed_by_user_id, reason
      ) VALUES (
        'event', $1, 'demo_loaded', NULL,
        NULL, 'DEMO', $2, 'Development sample data'
      )`,
      [todayEventId, adminId],
    );

    await client.query("COMMIT");

    return res.status(201).json({
      ok: true,
      users: 3,
      events: 2,
      message: "Demo data loaded",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

router.get("/dev-users", async (_req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({ error: "Not found" });
  }

  const isDemo = await isDevelopmentDemoMode();
  const demoState = await db.query(`
    SELECT
      (SELECT COUNT(*)::int FROM users WHERE role <> 'admin') AS non_admin_users,
      (SELECT COUNT(*)::int FROM events) AS events,
      (SELECT COUNT(*)::int FROM event_assignments) AS assignments,
      (SELECT COUNT(*)::int FROM expenses) AS expenses,
      (SELECT COUNT(*)::int FROM mileage_entries) AS mileage,
      (SELECT COUNT(*)::int FROM reimbursements) AS reimbursements,
      (SELECT COUNT(*)::int FROM attachments) AS attachments,
      (SELECT COUNT(*)::int FROM event_sessions) AS sessions
  `);

  const canLoadDemo = Object.values(demoState.rows[0]).every(
    (value) => Number(value ?? 0) === 0,
  );

  if (!isDemo) {
    return res.json({ users: [], can_load_demo: canLoadDemo, is_demo: false });
  }

  const result = await db.query(
    `
      SELECT username, role
      FROM users
      WHERE is_active = TRUE
        AND username IS NOT NULL
        AND BTRIM(username) <> ''
      ORDER BY
        CASE WHEN role = 'admin' THEN 0 ELSE 1 END,
        name ASC,
        username ASC
    `,
  );

  return res.json({
    users: result.rows,
    can_load_demo: canLoadDemo,
    is_demo: true,
  });
});

router.post("/dev-login", async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({ error: "Not found" });
  }

  const parsed = devLoginSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: "Username is required" });
  }

  const username = parsed.data.username.trim();

  if (!(await isDevelopmentDemoMode())) {
    return res.status(403).json({
      error: "Development quick sign in is only available in demo mode",
    });
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
