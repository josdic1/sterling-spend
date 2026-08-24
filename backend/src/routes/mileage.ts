import { Router } from "express";
import { z } from "zod";
import { db } from "../db/index.js";

const router = Router();

const createMileageSchema = z.object({
  user_id: z.string().uuid(),
  event_id: z.string().uuid().optional(),
  trip_date: z.string(),
  source: z.enum(["automatic", "manual"]),
  claimed_miles: z.number().nonnegative(),
});

const adjustApprovedMilesSchema = z.object({
  approved_miles: z.number().nonnegative(),
  changed_by_user_id: z.string().uuid(),
});

router.get("/current/:userId", async (req, res) => {
  const { userId } = req.params;

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;

  const result = await db.query(
    `
      SELECT
        me.id AS mileage_id,
        me.trip_date,
        me.source,
        me.claimed_miles,
        me.approved_miles,
        mr.rate_per_mile,
        e.id AS event_id,
        e.event_number,
        e.name AS event_name,
        r.id AS reimbursement_id,
        r.status
      FROM reimbursements r
      JOIN mileage_entries me
        ON me.reimbursement_id = r.id
      JOIN mileage_rates mr
        ON mr.id = me.mileage_rate_id
      JOIN events e
        ON e.id = me.event_id
      WHERE r.user_id = $1
        AND r.year = $2
        AND r.month = $3
      ORDER BY me.trip_date DESC, me.created_at DESC
    `,
    [userId, year, month],
  );

  res.json(result.rows);
});

router.post("/", async (req, res) => {
  const parsed = createMileageSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid mileage data",
      details: parsed.error.flatten(),
    });
  }

  const { user_id, event_id, trip_date, source, claimed_miles } = parsed.data;

  const tripDate = new Date(`${trip_date}T12:00:00Z`);
  const year = tripDate.getUTCFullYear();
  const month = tripDate.getUTCMonth() + 1;

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const activeEventResult = await client.query(
      `
        SELECT event_id
        FROM event_sessions
        WHERE user_id = $1
          AND ended_at IS NULL
        ORDER BY started_at DESC
        LIMIT 1
      `,
      [user_id],
    );

    const resolvedEventId =
      activeEventResult.rows[0]?.event_id ?? event_id ?? null;

    if (!resolvedEventId) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error: "Mileage requires an event",
      });
    }

    await client.query(
      `
        INSERT INTO reimbursements (
          user_id,
          year,
          month
        )
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id, year, month)
        DO NOTHING
      `,
      [user_id, year, month],
    );

    const reimbursementResult = await client.query(
      `
        SELECT
          id,
          status
        FROM reimbursements
        WHERE user_id = $1
          AND year = $2
          AND month = $3
        FOR UPDATE
      `,
      [user_id, year, month],
    );

    if (reimbursementResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(500).json({
        error: "Could not find or create reimbursement",
      });
    }

    const reimbursement = reimbursementResult.rows[0];

    if (reimbursement.status !== "open") {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error: "Only open reimbursements can receive new mileage entries",
      });
    }

    const rateResult = await client.query(
      `
        SELECT id
        FROM mileage_rates
        WHERE effective_from <= $1
          AND (
            effective_to IS NULL
            OR effective_to >= $1
          )
        ORDER BY effective_from DESC
        LIMIT 1
      `,
      [trip_date],
    );

    if (rateResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error: "No mileage rate found for trip date",
      });
    }

    const result = await client.query(
      `
        INSERT INTO mileage_entries (
          reimbursement_id,
          event_id,
          trip_date,
          source,
          claimed_miles,
          approved_miles,
          mileage_rate_id
        )
        VALUES ($1, $2, $3, $4, $5, $5, $6)
        RETURNING *
      `,
      [
        reimbursement.id,
        resolvedEventId,
        trip_date,
        source,
        claimed_miles,
        rateResult.rows[0].id,
      ],
    );

    await client.query("COMMIT");

    res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

router.patch("/:mileageId/approved-miles", async (req, res) => {
  const { mileageId } = req.params;

  const parsed = adjustApprovedMilesSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid mileage adjustment",
      details: parsed.error.flatten(),
    });
  }

  const { approved_miles, changed_by_user_id } = parsed.data;

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const adminResult = await client.query(
      `
        SELECT id
        FROM users
        WHERE id = $1
          AND role = 'admin'
          AND is_active = TRUE
      `,
      [changed_by_user_id],
    );

    if (adminResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(403).json({
        error: "Only an active admin can adjust approved mileage",
      });
    }

    const existingResult = await client.query(
      `
        SELECT
          me.approved_miles,
          r.status
        FROM mileage_entries me
        JOIN reimbursements r
          ON r.id = me.reimbursement_id
        WHERE me.id = $1
      `,
      [mileageId],
    );

    if (existingResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        error: "Mileage entry does not exist",
      });
    }

    if (existingResult.rows[0].status === "paid") {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error: "Paid reimbursements cannot be changed",
      });
    }

    const oldApprovedMiles = existingResult.rows[0].approved_miles;

    const mileageResult = await client.query(
      `
        UPDATE mileage_entries
        SET
          approved_miles = $1,
          updated_at = NOW()
        WHERE id = $2
        RETURNING *
      `,
      [approved_miles, mileageId],
    );

    await client.query(
      `
        INSERT INTO audit_log (
          entity_type,
          entity_id,
          action,
          field_name,
          old_value,
          new_value,
          changed_by_user_id
        )
        VALUES (
          'mileage',
          $1,
          'updated',
          'approved_miles',
          $2,
          $3,
          $4
        )
      `,
      [mileageId, oldApprovedMiles, approved_miles, changed_by_user_id],
    );

    await client.query("COMMIT");

    res.json(mileageResult.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

export default router;
