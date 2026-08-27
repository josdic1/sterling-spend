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


router.get("/admin/:eventId/detail", async (req, res) => {
  const { eventId } = req.params;
  const parsed = adminQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid admin request" });
  }

  const { requesting_user_id } = parsed.data;

  if (!(await isActiveAdmin(requesting_user_id))) {
    return res.status(403).json({ error: "Only an active admin can view event details" });
  }

  const eventResult = await db.query(
    `SELECT
      id, event_number, name, event_date, event_type,
      venue_name, venue_address, client_name,
      start_time, end_time, status, created_at, updated_at
    FROM events
    WHERE id = $1`,
    [eventId],
  );

  if (eventResult.rows.length === 0) {
    return res.status(404).json({ error: "Event not found" });
  }

  const [employeeResult, expenseResult, mileageResult, sessionResult, duplicateResult] =
    await Promise.all([
      db.query(
        `SELECT
          u.id,
          u.name,
          u.email,
          u.role,
          u.is_active,
          EXISTS (
            SELECT 1
            FROM event_sessions es
            WHERE es.event_id = $1
              AND es.user_id = u.id
              AND es.ended_at IS NULL
          ) AS active_now
        FROM event_assignments ea
        JOIN users u ON u.id = ea.user_id
        WHERE ea.event_id = $1
        ORDER BY u.name`,
        [eventId],
      ),
      db.query(
        `SELECT
          ex.id,
          ex.expense_date,
          ex.vendor,
          ex.description,
          ex.claimed_amount,
          ex.approved_amount,
          ex.created_at,
          c.name AS category_name,
          u.id AS employee_id,
          u.name AS employee_name,
          COALESCE(
            json_agg(
              json_build_object(
                'id', a.id,
                'file_name', a.file_name,
                'mime_type', a.mime_type,
                'file_size_bytes', a.file_size_bytes,
                'created_at', a.created_at
              ) ORDER BY a.created_at
            ) FILTER (WHERE a.id IS NOT NULL),
            '[]'::json
          ) AS attachments
        FROM expenses ex
        JOIN reimbursements r ON r.id = ex.reimbursement_id
        JOIN users u ON u.id = r.user_id
        JOIN expense_categories c ON c.id = ex.category_id
        LEFT JOIN expense_attachments ea ON ea.expense_id = ex.id
        LEFT JOIN attachments a ON a.id = ea.attachment_id
        WHERE ex.event_id = $1
        GROUP BY ex.id, c.name, u.id, u.name
        ORDER BY ex.created_at DESC`,
        [eventId],
      ),
      db.query(
        `SELECT
          me.id,
          me.event_session_id,
          me.trip_date,
          me.source,
          me.claimed_miles,
          me.approved_miles,
          me.planned_tolls_amount,
          me.created_at,
          mr.rate_per_mile,
          u.id AS employee_id,
          u.name AS employee_name
        FROM mileage_entries me
        JOIN reimbursements r ON r.id = me.reimbursement_id
        JOIN users u ON u.id = r.user_id
        JOIN mileage_rates mr ON mr.id = me.mileage_rate_id
        WHERE me.event_id = $1
        ORDER BY me.created_at DESC`,
        [eventId],
      ),
      db.query(
        `SELECT
          es.id,
          es.user_id AS employee_id,
          u.name AS employee_name,
          es.started_at,
          es.ended_at,
          es.planned_miles,
          es.planned_tolls_amount,
          es.planned_mileage_amount,
          es.travel_calculated_at
        FROM event_sessions es
        JOIN users u ON u.id = es.user_id
        WHERE es.event_id = $1
        ORDER BY es.started_at DESC`,
        [eventId],
      ),
      db.query(
        `SELECT
          r.user_id AS employee_id,
          u.name AS employee_name,
          COALESCE(ex.vendor, '') AS vendor,
          ex.expense_date,
          ex.claimed_amount,
          COUNT(*)::int AS count
        FROM expenses ex
        JOIN reimbursements r ON r.id = ex.reimbursement_id
        JOIN users u ON u.id = r.user_id
        WHERE ex.event_id = $1
        GROUP BY r.user_id, u.name, COALESCE(ex.vendor, ''), ex.expense_date, ex.claimed_amount
        HAVING COUNT(*) > 1
        ORDER BY ex.expense_date DESC, u.name`,
        [eventId],
      ),
    ]);

  const expenses = expenseResult.rows.map((row) => ({
    ...row,
    claimed_amount: Number(row.claimed_amount),
    approved_amount: Number(row.approved_amount),
    attachments: (row.attachments ?? []).map((attachment: Record<string, unknown>) => ({
      ...attachment,
      file_size_bytes: String(attachment.file_size_bytes ?? "0"),
    })),
  }));

  const mileage = mileageResult.rows.map((row) => {
    const claimedMiles = Number(row.claimed_miles);
    const approvedMiles = Number(row.approved_miles);
    const rate = Number(row.rate_per_mile);
    const plannedTolls = row.planned_tolls_amount === null
      ? null
      : Number(row.planned_tolls_amount);

    return {
      ...row,
      claimed_miles: claimedMiles,
      approved_miles: approvedMiles,
      rate_per_mile: rate,
      claimed_mileage_amount: Math.round(claimedMiles * rate * 100) / 100,
      approved_mileage_amount: Math.round(approvedMiles * rate * 100) / 100,
      planned_tolls_amount: plannedTolls,
    };
  });

  const receiptExpenses = expenses.filter((expense) => expense.category_name !== "Tolls");
  const tollExpenses = expenses.filter((expense) => expense.category_name === "Tolls");
  const receiptTotal = receiptExpenses.reduce((sum, expense) => sum + expense.approved_amount, 0);
  const tollTotal = tollExpenses.reduce((sum, expense) => sum + expense.approved_amount, 0);
  const mileageTotal = mileage.reduce((sum, entry) => sum + entry.approved_mileage_amount, 0);

  const tollEvidenceByEmployee = new Map<string, number>();
  for (const expense of tollExpenses) {
    tollEvidenceByEmployee.set(
      expense.employee_id,
      (tollEvidenceByEmployee.get(expense.employee_id) ?? 0) + expense.approved_amount,
    );
  }

  const travelByEmployee = employeeResult.rows
    .map((employee) => {
      const entries = mileage.filter((entry) => entry.employee_id === employee.id);
      if (entries.length === 0) return null;

      const plannedValues = entries
        .map((entry) => entry.planned_tolls_amount)
        .filter((value): value is number => value !== null);
      const plannedTolls = plannedValues.length === 0
        ? null
        : plannedValues.reduce((sum, value) => sum + value, 0);
      const tollEvidence = tollEvidenceByEmployee.get(employee.id) ?? 0;
      const approvedMiles = entries.reduce((sum, entry) => sum + entry.approved_miles, 0);
      const mileageAmount = entries.reduce((sum, entry) => sum + entry.approved_mileage_amount, 0);

      return {
        employee_id: employee.id,
        employee_name: employee.name,
        trip_count: entries.length,
        approved_miles: Math.round(approvedMiles * 100) / 100,
        mileage_amount: Math.round(mileageAmount * 100) / 100,
        planned_tolls_amount: plannedTolls === null ? null : Math.round(plannedTolls * 100) / 100,
        toll_evidence_amount: Math.round(tollEvidence * 100) / 100,
        toll_difference: plannedTolls === null
          ? null
          : Math.round((tollEvidence - plannedTolls) * 100) / 100,
      };
    })
    .filter((entry) => entry !== null);

  const issues: Array<{
    type: string;
    message: string;
    employee_id?: string;
    employee_name?: string;
    expense_id?: string;
  }> = [];

  for (const travel of travelByEmployee) {
    if (
      travel.planned_tolls_amount !== null &&
      travel.toll_difference !== null &&
      Math.abs(travel.toll_difference) >= 0.01
    ) {
      issues.push({
        type: "toll_mismatch",
        employee_id: travel.employee_id,
        employee_name: travel.employee_name,
        message: travel.toll_evidence_amount === 0
          ? `Toll evidence missing — Planned $${travel.planned_tolls_amount.toFixed(2)} · Evidence $0.00`
          : `Toll difference — Planned $${travel.planned_tolls_amount.toFixed(2)} · Evidence $${travel.toll_evidence_amount.toFixed(2)}`,
      });
    }
  }

  for (const row of duplicateResult.rows) {
    issues.push({
      type: "possible_duplicate",
      employee_id: row.employee_id,
      employee_name: row.employee_name,
      message: `Possible duplicate — ${row.vendor || "Expense"} · $${Number(row.claimed_amount).toFixed(2)} · ${row.expense_date} · ${row.count} entries`,
    });
  }

  const eventDateKey = String(eventResult.rows[0].event_date).slice(0, 10);
  for (const expense of expenses) {
    const expenseDateKey = String(expense.expense_date).slice(0, 10);
    if (expenseDateKey !== eventDateKey) {
      issues.push({
        type: "date_mismatch",
        expense_id: expense.id,
        employee_id: expense.employee_id,
        employee_name: expense.employee_name,
        message: `Date mismatch — ${expense.vendor || expense.category_name} · Receipt ${expenseDateKey} · Event ${eventDateKey}`,
      });
    }
  }

  const employees = employeeResult.rows.map((employee) => {
    const employeeExpenses = expenses.filter((expense) => expense.employee_id === employee.id);
    const employeeMileage = mileage.filter((entry) => entry.employee_id === employee.id);
    const employeeReceipts = employeeExpenses.filter((expense) => expense.category_name !== "Tolls");
    const employeeTolls = employeeExpenses.filter((expense) => expense.category_name === "Tolls");
    const receiptsTotal = employeeReceipts.reduce((sum, expense) => sum + expense.approved_amount, 0);
    const tollsTotal = employeeTolls.reduce((sum, expense) => sum + expense.approved_amount, 0);
    const employeeMileageTotal = employeeMileage.reduce((sum, entry) => sum + entry.approved_mileage_amount, 0);
    const miles = employeeMileage.reduce((sum, entry) => sum + entry.approved_miles, 0);

    return {
      ...employee,
      receipt_count: employeeReceipts.length,
      toll_count: employeeTolls.length,
      mileage_count: employeeMileage.length,
      miles: Math.round(miles * 100) / 100,
      receipts_total: Math.round(receiptsTotal * 100) / 100,
      tolls_total: Math.round(tollsTotal * 100) / 100,
      mileage_total: Math.round(employeeMileageTotal * 100) / 100,
      total: Math.round((receiptsTotal + tollsTotal + employeeMileageTotal) * 100) / 100,
    };
  });

  const categoryMap = new Map<string, number>();
  for (const expense of expenses) {
    categoryMap.set(
      expense.category_name,
      (categoryMap.get(expense.category_name) ?? 0) + expense.approved_amount,
    );
  }
  if (mileageTotal > 0) {
    categoryMap.set("Mileage", (categoryMap.get("Mileage") ?? 0) + mileageTotal);
  }

  const activity = [
    {
      type: "event_created",
      occurred_at: eventResult.rows[0].created_at,
      employee_name: "",
      label: "Event created",
      detail: eventResult.rows[0].event_number,
    },
    ...sessionResult.rows.flatMap((session) => {
      const rows = [{
        type: "event_started",
        occurred_at: session.started_at,
        employee_name: session.employee_name,
        label: "Event started",
        detail: session.employee_name,
      }];
      if (session.ended_at) {
        rows.push({
          type: "event_finished",
          occurred_at: session.ended_at,
          employee_name: session.employee_name,
          label: "Event finished",
          detail: session.employee_name,
        });
      }
      return rows;
    }),
    ...expenses.map((expense) => ({
      type: "expense_saved",
      occurred_at: expense.created_at,
      employee_name: expense.employee_name,
      label: expense.category_name === "Tolls" ? "Toll saved" : "Receipt saved",
      detail: `${expense.employee_name} · ${expense.vendor || expense.category_name} · $${expense.approved_amount.toFixed(2)}`,
    })),
    ...mileage.map((entry) => ({
      type: "mileage_recorded",
      occurred_at: entry.created_at,
      employee_name: entry.employee_name,
      label: "Mileage recorded",
      detail: `${entry.employee_name} · ${entry.approved_miles.toFixed(2)} mi`,
    })),
  ].sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());

  const documents = expenses.flatMap((expense) =>
    expense.attachments.map((attachment: Record<string, unknown>) => ({
      ...attachment,
      expense_id: expense.id,
      employee_id: expense.employee_id,
      employee_name: expense.employee_name,
      vendor: expense.vendor,
      category_name: expense.category_name,
    })),
  );

  return res.json({
    event: eventResult.rows[0],
    totals: {
      total: Math.round((receiptTotal + tollTotal + mileageTotal) * 100) / 100,
      receipts: Math.round(receiptTotal * 100) / 100,
      mileage: Math.round(mileageTotal * 100) / 100,
      tolls: Math.round(tollTotal * 100) / 100,
      receipt_count: receiptExpenses.length,
      mileage_count: mileage.length,
      toll_count: tollExpenses.length,
    },
    employees,
    expenses,
    mileage,
    travel_by_employee: travelByEmployee,
    sessions: sessionResult.rows,
    issues,
    category_breakdown: [...categoryMap.entries()]
      .map(([name, amount]) => ({ name, amount: Math.round(amount * 100) / 100 }))
      .sort((a, b) => b.amount - a.amount),
    activity,
    documents,
  });
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
