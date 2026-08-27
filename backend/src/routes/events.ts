import { Router } from "express";
import { z } from "zod";
import type { PoolClient } from "pg";
import { db } from "../db/index.js";

const router = Router();

const adminQuerySchema = z.object({
  requesting_user_id: z.string().uuid(),
});

const eventInputSchema = z.object({
  requesting_user_id: z.string().uuid(),
  event_number: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(200),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  client_name: z.string().trim().max(200).nullable().optional(),
  venue_name: z.string().trim().max(200).nullable().optional(),
  venue_address: z.string().trim().max(500).nullable().optional(),
  start_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  end_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  assigned_user_ids: z.array(z.string().uuid()).default([]),
});

async function isActiveAdmin(userId: string) {
  const result = await db.query(
    `SELECT id FROM users WHERE id = $1 AND role = 'admin' AND is_active = TRUE`,
    [userId],
  );
  return result.rows.length > 0;
}

function nullableText(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

async function assignmentsAreActive(client: PoolClient, userIds: string[]) {
  if (userIds.length === 0) return true;
  const uniqueIds = [...new Set(userIds)];
  const result = await client.query(
    `SELECT id FROM users WHERE id = ANY($1::uuid[]) AND is_active = TRUE`,
    [uniqueIds],
  );
  return result.rows.length === uniqueIds.length;
}

router.get("/admin", async (req, res) => {
  const parsed = adminQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Invalid admin request" });
  const { requesting_user_id } = parsed.data;
  if (!(await isActiveAdmin(requesting_user_id))) {
    return res.status(403).json({ error: "Only an active admin can manage events" });
  }

  const result = await db.query(`
    SELECT
      e.id, e.event_number, e.name, e.event_date, e.event_type,
      e.venue_name, e.venue_address, e.client_name,
      e.start_time, e.end_time, e.status,
      COALESCE(
        array_agg(ea.user_id::text ORDER BY u.name)
          FILTER (WHERE ea.user_id IS NOT NULL),
        ARRAY[]::text[]
      ) AS assigned_user_ids
    FROM events e
    LEFT JOIN event_assignments ea ON ea.event_id = e.id
    LEFT JOIN users u ON u.id = ea.user_id
    GROUP BY e.id
    ORDER BY e.event_date DESC, e.start_time NULLS LAST, e.name
  `);

  return res.json(result.rows);
});

router.post("/admin", async (req, res) => {
  const parsed = eventInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid event data", details: parsed.error.flatten() });
  }

  const input = parsed.data;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    if (!(await isActiveAdmin(input.requesting_user_id))) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Only an active admin can create events" });
    }
    if (!(await assignmentsAreActive(client, input.assigned_user_ids))) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Events can only be assigned to active users" });
    }

    const duplicate = await client.query(
      `SELECT id FROM events WHERE event_number = $1 LIMIT 1`,
      [input.event_number],
    );
    if (duplicate.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "That event number already exists" });
    }

    const eventResult = await client.query(
      `INSERT INTO events (
        event_number, name, event_date, client_name,
        venue_name, venue_address, start_time, end_time
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *`,
      [
        input.event_number,
        input.name,
        input.event_date,
        nullableText(input.client_name),
        nullableText(input.venue_name),
        nullableText(input.venue_address),
        input.start_time ?? null,
        input.end_time ?? null,
      ],
    );
    const event = eventResult.rows[0];

    for (const userId of [...new Set(input.assigned_user_ids)]) {
      await client.query(
        `INSERT INTO event_assignments (event_id, user_id) VALUES ($1, $2)`,
        [event.id, userId],
      );
    }

    await client.query(
      `INSERT INTO audit_log (
        entity_type, entity_id, action, field_name,
        old_value, new_value, changed_by_user_id, reason
      ) VALUES ('event', $1, 'created', NULL, NULL, $2, $3, NULL)`,
      [event.id, JSON.stringify(event), input.requesting_user_id],
    );

    await client.query("COMMIT");
    return res.status(201).json({ ...event, assigned_user_ids: input.assigned_user_ids });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

router.put("/admin/:eventId", async (req, res) => {
  const { eventId } = req.params;
  const parsed = eventInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid event data", details: parsed.error.flatten() });
  }

  const input = parsed.data;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    if (!(await isActiveAdmin(input.requesting_user_id))) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Only an active admin can update events" });
    }
    if (!(await assignmentsAreActive(client, input.assigned_user_ids))) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Events can only be assigned to active users" });
    }

    const existingResult = await client.query(`SELECT * FROM events WHERE id = $1 FOR UPDATE`, [eventId]);
    if (existingResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Event not found" });
    }

    const duplicate = await client.query(
      `SELECT id FROM events WHERE event_number = $1 AND id <> $2 LIMIT 1`,
      [input.event_number, eventId],
    );
    if (duplicate.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "That event number already exists" });
    }

    const oldAssignments = await client.query(
      `SELECT user_id::text FROM event_assignments WHERE event_id = $1 ORDER BY user_id`,
      [eventId],
    );
    const oldValue = {
      ...existingResult.rows[0],
      assigned_user_ids: oldAssignments.rows.map((row) => row.user_id),
    };

    const eventResult = await client.query(
      `UPDATE events SET
        event_number = $1, name = $2, event_date = $3,
        client_name = $4, venue_name = $5, venue_address = $6,
        start_time = $7, end_time = $8, updated_at = NOW()
      WHERE id = $9 RETURNING *`,
      [
        input.event_number,
        input.name,
        input.event_date,
        nullableText(input.client_name),
        nullableText(input.venue_name),
        nullableText(input.venue_address),
        input.start_time ?? null,
        input.end_time ?? null,
        eventId,
      ],
    );

    await client.query(`DELETE FROM event_assignments WHERE event_id = $1`, [eventId]);
    for (const userId of [...new Set(input.assigned_user_ids)]) {
      await client.query(
        `INSERT INTO event_assignments (event_id, user_id) VALUES ($1, $2)`,
        [eventId, userId],
      );
    }

    const newValue = { ...eventResult.rows[0], assigned_user_ids: input.assigned_user_ids };
    await client.query(
      `INSERT INTO audit_log (
        entity_type, entity_id, action, field_name,
        old_value, new_value, changed_by_user_id, reason
      ) VALUES ('event', $1, 'updated', NULL, $2, $3, $4, NULL)`,
      [eventId, JSON.stringify(oldValue), JSON.stringify(newValue), input.requesting_user_id],
    );

    await client.query("COMMIT");
    return res.json(newValue);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

router.get("/assigned/:userId", async (req, res) => {
  const { userId } = req.params;
  const result = await db.query(
    `SELECT
      e.id, e.event_number, e.name, e.event_date, e.event_type,
      e.venue_name, e.venue_address, e.client_name,
      e.start_time, e.end_time, e.status
    FROM event_assignments ea
    JOIN users u ON u.id = ea.user_id
    JOIN events e ON e.id = ea.event_id
    WHERE ea.user_id = $1 AND u.is_active = TRUE
    ORDER BY e.event_date, e.start_time`,
    [userId],
  );
  res.json(result.rows);
});

router.post("/:eventId/activate", async (req, res) => {
  const { eventId } = req.params;
  const { user_id } = req.body;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const assignmentResult = await client.query(
      `SELECT ea.event_id
       FROM event_assignments ea
       JOIN users u ON u.id = ea.user_id
       WHERE ea.event_id = $1 AND ea.user_id = $2 AND u.is_active = TRUE`,
      [eventId, user_id],
    );
    if (assignmentResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "This event is not assigned to this active employee" });
    }

    const activeResult = await client.query(
      `SELECT * FROM event_sessions
       WHERE user_id = $1 AND ended_at IS NULL
       ORDER BY started_at DESC LIMIT 1 FOR UPDATE`,
      [user_id],
    );
    if (activeResult.rows.length > 0) {
      const activeSession = activeResult.rows[0];
      if (activeSession.event_id === eventId) {
        await client.query("COMMIT");
        return res.json(activeSession);
      }
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "Another event is already active. End it before activating a different event.",
      });
    }

    const result = await client.query(
      `INSERT INTO event_sessions (user_id, event_id) VALUES ($1, $2) RETURNING *`,
      [user_id, eventId],
    );
    await client.query("COMMIT");
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

router.get("/admin/activation-status", async (req, res) => {
  const requestingUserId = typeof req.query.requesting_user_id === "string"
    ? req.query.requesting_user_id
    : "";
  if (!(await isActiveAdmin(requestingUserId))) {
    return res.status(403).json({ error: "Only an active admin can view activation status" });
  }

  const result = await db.query(`
    SELECT
      u.id AS user_id,
      u.name AS employee_name,
      u.email AS employee_email,
      (es.id IS NOT NULL) AS is_activated,
      es.id AS session_id,
      active_event.id AS event_id,
      active_event.event_number,
      active_event.name AS event_name,
      active_event.venue_name,
      COALESCE(assignments.assigned_events, '[]'::json) AS assigned_events
    FROM users u
    LEFT JOIN LATERAL (
      SELECT id, event_id
      FROM event_sessions
      WHERE user_id = u.id AND ended_at IS NULL
      ORDER BY started_at DESC
      LIMIT 1
    ) es ON TRUE
    LEFT JOIN events active_event ON active_event.id = es.event_id
    LEFT JOIN LATERAL (
      SELECT json_agg(
        json_build_object(
          'id', e.id,
          'event_number', e.event_number,
          'name', e.name,
          'event_date', e.event_date,
          'venue_name', e.venue_name
        )
        ORDER BY e.start_time NULLS LAST, e.name
      ) AS assigned_events
      FROM event_assignments ea
      JOIN events e ON e.id = ea.event_id
      WHERE ea.user_id = u.id
        AND (
          e.event_date = CURRENT_DATE
          OR e.id = es.event_id
        )
    ) assignments ON TRUE
    WHERE u.is_active = TRUE
    ORDER BY u.name
  `);
  return res.json(result.rows);
});

router.get("/admin/today/:userId", async (req, res) => {
  const { userId } = req.params;
  const requestingUserId = typeof req.query.requesting_user_id === "string"
    ? req.query.requesting_user_id
    : "";

  if (!(await isActiveAdmin(requestingUserId))) {
    return res.status(403).json({ error: "Only an active admin can view Today details" });
  }

  const userResult = await db.query(
    `SELECT id, name, email, role, is_active FROM users WHERE id = $1`,
    [userId],
  );

  if (userResult.rows.length === 0) {
    return res.status(404).json({ error: "Employee not found" });
  }

  const assignmentResult = await db.query(
    `SELECT
      e.id,
      e.event_number,
      e.name,
      e.event_date,
      e.venue_name,
      e.venue_address,
      e.start_time,
      e.end_time
    FROM event_assignments ea
    JOIN events e ON e.id = ea.event_id
    WHERE ea.user_id = $1
      AND (
        e.event_date = CURRENT_DATE
        OR e.id IN (
          SELECT event_id
          FROM event_sessions
          WHERE user_id = $1 AND ended_at IS NULL
        )
      )
    ORDER BY e.start_time NULLS LAST, e.name`,
    [userId],
  );

  const activeResult = await db.query(
    `SELECT
      es.id AS session_id,
      es.started_at,
      es.planned_miles,
      es.planned_tolls_amount,
      es.planned_mileage_amount,
      es.travel_calculated_at,
      mr.rate_per_mile,
      e.id AS event_id,
      e.event_number,
      e.name AS event_name,
      e.event_date,
      e.venue_name,
      e.venue_address
    FROM event_sessions es
    JOIN events e ON e.id = es.event_id
    LEFT JOIN mileage_rates mr ON mr.id = es.mileage_rate_id
    WHERE es.user_id = $1 AND es.ended_at IS NULL
    ORDER BY es.started_at DESC
    LIMIT 1`,
    [userId],
  );

  const assignedIds = assignmentResult.rows.map((row) => row.id);

  const expensesResult = assignedIds.length === 0
    ? { rows: [] }
    : await db.query(
        `SELECT
          ex.id,
          ex.expense_date,
          ex.vendor,
          ex.description,
          ex.claimed_amount,
          c.name AS category_name,
          e.id AS event_id,
          e.event_number,
          e.name AS event_name
        FROM expenses ex
        JOIN reimbursements r ON r.id = ex.reimbursement_id
        JOIN expense_categories c ON c.id = ex.category_id
        JOIN events e ON e.id = ex.event_id
        WHERE r.user_id = $1
          AND ex.event_id = ANY($2::uuid[])
        ORDER BY ex.created_at DESC`,
        [userId, assignedIds],
      );

  const mileageResult = assignedIds.length === 0
    ? { rows: [] }
    : await db.query(
        `SELECT
          me.id,
          me.event_session_id,
          me.trip_date,
          me.claimed_miles,
          me.approved_miles,
          me.planned_tolls_amount,
          mr.rate_per_mile,
          e.id AS event_id,
          e.event_number,
          e.name AS event_name,
          COALESCE((
            SELECT SUM(ex.claimed_amount)
            FROM expenses ex
            JOIN reimbursements er ON er.id = ex.reimbursement_id
            JOIN expense_categories c ON c.id = ex.category_id
            WHERE er.user_id = $1
              AND ex.event_id = me.event_id
              AND c.name = 'Tolls'
          ), 0) AS toll_evidence_amount
        FROM mileage_entries me
        JOIN reimbursements r ON r.id = me.reimbursement_id
        JOIN mileage_rates mr ON mr.id = me.mileage_rate_id
        JOIN events e ON e.id = me.event_id
        WHERE r.user_id = $1
          AND me.event_id = ANY($2::uuid[])
        ORDER BY me.created_at DESC`,
        [userId, assignedIds],
      );

  const unassignedResult = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM expenses ex
     JOIN reimbursements r ON r.id = ex.reimbursement_id
     WHERE r.user_id = $1
       AND ex.event_id IS NULL
       AND ex.created_at::date = CURRENT_DATE`,
    [userId],
  );

  const expenses = expensesResult.rows.map((row) => ({
    ...row,
    claimed_amount: Number(row.claimed_amount),
  }));

  const mileage = mileageResult.rows.map((row) => {
    const claimedMiles = Number(row.claimed_miles);
    const rate = Number(row.rate_per_mile);
    const plannedTolls = row.planned_tolls_amount === null
      ? null
      : Number(row.planned_tolls_amount);
    const tollEvidence = Number(row.toll_evidence_amount);

    return {
      ...row,
      claimed_miles: claimedMiles,
      approved_miles: Number(row.approved_miles),
      rate_per_mile: rate,
      mileage_amount: Math.round(claimedMiles * rate * 100) / 100,
      planned_tolls_amount: plannedTolls,
      toll_evidence_amount: tollEvidence,
      toll_difference: plannedTolls === null
        ? null
        : Math.round((tollEvidence - plannedTolls) * 100) / 100,
    };
  });

  const expenseTotal = expenses.reduce(
    (total, expense) => total + expense.claimed_amount,
    0,
  );
  const mileageTotal = mileage.reduce(
    (total, entry) => total + entry.mileage_amount,
    0,
  );

  const issues = [] as Array<{
    type: string;
    event_id?: string;
    event_name?: string;
    message: string;
  }>;

  for (const entry of mileage) {
    if (
      entry.planned_tolls_amount !== null &&
      entry.toll_difference !== null &&
      Math.abs(entry.toll_difference) >= 0.01
    ) {
      issues.push({
        type: "toll_mismatch",
        event_id: entry.event_id,
        event_name: entry.event_name,
        message: `Tolls: expected $${entry.planned_tolls_amount.toFixed(2)}, evidence $${entry.toll_evidence_amount.toFixed(2)}`,
      });
    }
  }

  const unassignedCount = Number(unassignedResult.rows[0]?.count ?? 0);
  if (unassignedCount > 0) {
    issues.push({
      type: "unassigned_expense",
      message: `${unassignedCount} receipt${unassignedCount === 1 ? "" : "s"} saved today without an Event`,
    });
  }

  return res.json({
    employee: userResult.rows[0],
    assigned_events: assignmentResult.rows,
    active_event: activeResult.rows[0] ?? null,
    expenses,
    mileage,
    issues,
    totals: {
      expenses: Math.round(expenseTotal * 100) / 100,
      mileage: Math.round(mileageTotal * 100) / 100,
      running: Math.round((expenseTotal + mileageTotal) * 100) / 100,
    },
  });
});

router.get("/active/:userId", async (req, res) => {
  const { userId } = req.params;
  const result = await db.query(
    `SELECT
      es.id AS session_id,
      es.started_at,
      es.planned_miles,
      es.planned_tolls_amount,
      es.planned_mileage_amount,
      es.travel_calculated_at,
      mr.rate_per_mile,
      e.id AS event_id,
      e.event_number,
      e.name,
      e.event_date,
      e.venue_name,
      e.venue_address
    FROM event_sessions es
    JOIN events e ON e.id = es.event_id
    LEFT JOIN mileage_rates mr ON mr.id = es.mileage_rate_id
    WHERE es.user_id = $1 AND es.ended_at IS NULL
    ORDER BY es.started_at DESC LIMIT 1`,
    [userId],
  );
  res.json(result.rows[0] ?? null);
});

router.post("/sessions/:sessionId/end", async (req, res) => {
  const { sessionId } = req.params;
  const result = await db.query(
    `UPDATE event_sessions SET ended_at = NOW()
     WHERE id = $1 AND ended_at IS NULL RETURNING *`,
    [sessionId],
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Active event session not found" });
  }
  return res.json(result.rows[0]);
});

export default router;
