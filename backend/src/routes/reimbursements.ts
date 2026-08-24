import { Router } from "express";
import { z } from "zod";
import { db } from "../db/index.js";

const router = Router();

const requestingUserQuerySchema = z.object({
  requesting_user_id: z.string().uuid(),
});

router.get("/admin/queue", async (req, res) => {
  const parsed = requestingUserQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Valid requesting_user_id is required",
    });
  }

  const { requesting_user_id } = parsed.data;

  const adminResult = await db.query(
    `
      SELECT id
      FROM users
      WHERE id = $1
        AND role = 'admin'
        AND is_active = TRUE
    `,
    [requesting_user_id],
  );

  if (adminResult.rows.length === 0) {
    return res.status(403).json({
      error: "Only an active admin can view the reimbursement queue",
    });
  }

  const queueResult = await db.query(
    `
      SELECT
        r.id,
        r.user_id,
        u.name AS employee_name,
        u.email AS employee_email,
        r.year,
        r.month,
        r.status,
        r.submitted_at,
        r.reviewed_at,
        r.check_number,
        r.paid_at,

        (
          SELECT COUNT(*)
          FROM expenses e
          WHERE e.reimbursement_id = r.id
        ) AS expense_count,

        (
          SELECT COUNT(*)
          FROM mileage_entries me
          WHERE me.reimbursement_id = r.id
        ) AS mileage_count,

        COALESCE((
          SELECT SUM(e.claimed_amount)
          FROM expenses e
          WHERE e.reimbursement_id = r.id
        ), 0)
        +
        COALESCE((
          SELECT SUM(me.claimed_miles * mr.rate_per_mile)
          FROM mileage_entries me
          JOIN mileage_rates mr
            ON mr.id = me.mileage_rate_id
          WHERE me.reimbursement_id = r.id
        ), 0) AS claimed_total,

        COALESCE((
          SELECT SUM(e.approved_amount)
          FROM expenses e
          WHERE e.reimbursement_id = r.id
        ), 0)
        +
        COALESCE((
          SELECT SUM(me.approved_miles * mr.rate_per_mile)
          FROM mileage_entries me
          JOIN mileage_rates mr
            ON mr.id = me.mileage_rate_id
          WHERE me.reimbursement_id = r.id
        ), 0) AS approved_total

      FROM reimbursements r
      JOIN users u
        ON u.id = r.user_id
      WHERE r.status IN ('submitted', 'reviewed')
      ORDER BY
        CASE
          WHEN r.status = 'submitted' THEN 0
          ELSE 1
        END,
        COALESCE(r.submitted_at, r.created_at) ASC
    `,
  );

  return res.json(queueResult.rows);
});

router.get("/current/:userId", async (req, res) => {
  const { userId } = req.params;

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;

  const reimbursementResult = await db.query(
    `
      SELECT
        id,
        year,
        month,
        status,
        submitted_at,
        reviewed_at,
        check_number,
        paid_at
      FROM reimbursements
      WHERE user_id = $1
        AND year = $2
        AND month = $3
      LIMIT 1
    `,
    [userId, year, month],
  );

  if (reimbursementResult.rows.length === 0) {
    return res.json(null);
  }

  const reimbursement = reimbursementResult.rows[0];

  const expensesResult = await db.query(
    `
      SELECT
        e.id,
        e.expense_date,
        e.vendor,
        e.description,
        e.claimed_amount,
        e.approved_amount,
        c.name AS category_name,
        ev.id AS event_id,
        ev.event_number,
        ev.name AS event_name
      FROM expenses e
      JOIN expense_categories c
        ON c.id = e.category_id
      LEFT JOIN events ev
        ON ev.id = e.event_id
      WHERE e.reimbursement_id = $1
      ORDER BY e.expense_date DESC, e.created_at DESC
    `,
    [reimbursement.id],
  );

  const mileageResult = await db.query(
    `
      SELECT
        me.id,
        me.trip_date,
        me.source,
        me.claimed_miles,
        me.approved_miles,
        mr.rate_per_mile,
        ev.id AS event_id,
        ev.event_number,
        ev.name AS event_name
      FROM mileage_entries me
      JOIN mileage_rates mr
        ON mr.id = me.mileage_rate_id
      JOIN events ev
        ON ev.id = me.event_id
      WHERE me.reimbursement_id = $1
      ORDER BY me.trip_date DESC, me.created_at DESC
    `,
    [reimbursement.id],
  );

  const totalsResult = await db.query(
    `
      SELECT
        COALESCE((
          SELECT SUM(claimed_amount)
          FROM expenses
          WHERE reimbursement_id = $1
        ), 0)
        +
        COALESCE((
          SELECT SUM(me.claimed_miles * mr.rate_per_mile)
          FROM mileage_entries me
          JOIN mileage_rates mr
            ON mr.id = me.mileage_rate_id
          WHERE me.reimbursement_id = $1
        ), 0) AS claimed_total,

        COALESCE((
          SELECT SUM(approved_amount)
          FROM expenses
          WHERE reimbursement_id = $1
        ), 0)
        +
        COALESCE((
          SELECT SUM(me.approved_miles * mr.rate_per_mile)
          FROM mileage_entries me
          JOIN mileage_rates mr
            ON mr.id = me.mileage_rate_id
          WHERE me.reimbursement_id = $1
        ), 0) AS approved_total
    `,
    [reimbursement.id],
  );

  return res.json({
    ...reimbursement,
    totals: totalsResult.rows[0],
    expenses: expensesResult.rows,
    mileage: mileageResult.rows,
  });
});

router.get("/:reimbursementId", async (req, res) => {
  const { reimbursementId } = req.params;

  const parsed = requestingUserQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Valid requesting_user_id is required",
    });
  }

  const { requesting_user_id } = parsed.data;

  const reimbursementResult = await db.query(
    `
      SELECT
        r.id,
        r.user_id,
        u.name AS employee_name,
        u.email AS employee_email,
        r.year,
        r.month,
        r.status,
        r.submitted_at,
        r.reviewed_at,
        r.check_number,
        r.paid_at,
        requesting_user.role AS requesting_user_role,
        requesting_user.is_active AS requesting_user_is_active
      FROM reimbursements r
      JOIN users u
        ON u.id = r.user_id
      LEFT JOIN users requesting_user
        ON requesting_user.id = $2
      WHERE r.id = $1
    `,
    [reimbursementId, requesting_user_id],
  );

  if (reimbursementResult.rows.length === 0) {
    return res.status(404).json({
      error: "Reimbursement not found",
    });
  }

  const reimbursement = reimbursementResult.rows[0];

  if (!reimbursement.requesting_user_is_active) {
    return res.status(403).json({
      error: "Only an active user can view a reimbursement",
    });
  }

  const canView =
    reimbursement.user_id === requesting_user_id ||
    reimbursement.requesting_user_role === "admin";

  if (!canView) {
    return res.status(403).json({
      error: "You do not have access to this reimbursement",
    });
  }

  const expensesResult = await db.query(
    `
      SELECT
        e.id,
        e.expense_date,
        e.vendor,
        e.description,
        e.claimed_amount,
        e.approved_amount,
        c.id AS category_id,
        c.name AS category_name,
        ev.id AS event_id,
        ev.event_number,
        ev.name AS event_name
      FROM expenses e
      JOIN expense_categories c
        ON c.id = e.category_id
      LEFT JOIN events ev
        ON ev.id = e.event_id
      WHERE e.reimbursement_id = $1
      ORDER BY e.expense_date DESC, e.created_at DESC
    `,
    [reimbursementId],
  );

  const mileageResult = await db.query(
    `
      SELECT
        me.id,
        me.trip_date,
        me.source,
        me.claimed_miles,
        me.approved_miles,
        mr.id AS mileage_rate_id,
        mr.rate_per_mile,
        ev.id AS event_id,
        ev.event_number,
        ev.name AS event_name
      FROM mileage_entries me
      JOIN mileage_rates mr
        ON mr.id = me.mileage_rate_id
      JOIN events ev
        ON ev.id = me.event_id
      WHERE me.reimbursement_id = $1
      ORDER BY me.trip_date DESC, me.created_at DESC
    `,
    [reimbursementId],
  );

  const totalsResult = await db.query(
    `
      SELECT
        COALESCE((
          SELECT SUM(claimed_amount)
          FROM expenses
          WHERE reimbursement_id = $1
        ), 0)
        +
        COALESCE((
          SELECT SUM(me.claimed_miles * mr.rate_per_mile)
          FROM mileage_entries me
          JOIN mileage_rates mr
            ON mr.id = me.mileage_rate_id
          WHERE me.reimbursement_id = $1
        ), 0) AS claimed_total,

        COALESCE((
          SELECT SUM(approved_amount)
          FROM expenses
          WHERE reimbursement_id = $1
        ), 0)
        +
        COALESCE((
          SELECT SUM(me.approved_miles * mr.rate_per_mile)
          FROM mileage_entries me
          JOIN mileage_rates mr
            ON mr.id = me.mileage_rate_id
          WHERE me.reimbursement_id = $1
        ), 0) AS approved_total
    `,
    [reimbursementId],
  );

  const {
    requesting_user_role: _requestingUserRole,
    requesting_user_is_active: _requestingUserIsActive,
    ...publicReimbursement
  } = reimbursement;

  return res.json({
    ...publicReimbursement,
    totals: totalsResult.rows[0],
    expenses: expensesResult.rows,
    mileage: mileageResult.rows,
  });
});

router.post("/:reimbursementId/submit", async (req, res) => {
  const { reimbursementId } = req.params;
  const { submitted_by_user_id } = req.body;

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const userResult = await client.query(
      `
        SELECT id
        FROM users
        WHERE id = $1
          AND is_active = TRUE
      `,
      [submitted_by_user_id],
    );

    if (userResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(403).json({
        error: "Only an active user can submit a reimbursement",
      });
    }

    const reimbursementResult = await client.query(
      `
        UPDATE reimbursements
        SET
          status = 'submitted',
          submitted_at = NOW(),
          updated_at = NOW()
        WHERE id = $1
          AND user_id = $2
          AND status = 'open'
        RETURNING *
      `,
      [reimbursementId, submitted_by_user_id],
    );

    if (reimbursementResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error:
          "Reimbursement is not open, does not exist, or does not belong to this user",
      });
    }

    await client.query(
      `
        INSERT INTO audit_log (
          entity_type,
          entity_id,
          action,
          changed_by_user_id
        )
        VALUES (
          'reimbursement',
          $1,
          'submitted',
          $2
        )
      `,
      [reimbursementId, submitted_by_user_id],
    );

    await client.query("COMMIT");

    return res.json(reimbursementResult.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

router.post("/:reimbursementId/review", async (req, res) => {
  const { reimbursementId } = req.params;
  const { reviewed_by_user_id } = req.body;

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
      [reviewed_by_user_id],
    );

    if (adminResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(403).json({
        error: "Only an active admin can review a reimbursement",
      });
    }

    const reimbursementResult = await client.query(
      `
        UPDATE reimbursements
        SET
          status = 'reviewed',
          reviewed_at = NOW(),
          updated_at = NOW()
        WHERE id = $1
          AND status = 'submitted'
        RETURNING *
      `,
      [reimbursementId],
    );

    if (reimbursementResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error: "Reimbursement is not submitted or does not exist",
      });
    }

    await client.query(
      `
        INSERT INTO audit_log (
          entity_type,
          entity_id,
          action,
          changed_by_user_id
        )
        VALUES (
          'reimbursement',
          $1,
          'reviewed',
          $2
        )
      `,
      [reimbursementId, reviewed_by_user_id],
    );

    await client.query("COMMIT");

    return res.json(reimbursementResult.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

router.post("/:reimbursementId/pay", async (req, res) => {
  const { reimbursementId } = req.params;
  const { paid_by_user_id, check_number } = req.body;

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
      [paid_by_user_id],
    );

    if (adminResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(403).json({
        error: "Only an active admin can mark a reimbursement paid",
      });
    }

    const reimbursementResult = await client.query(
      `
        UPDATE reimbursements
        SET
          status = 'paid',
          check_number = $1,
          paid_at = NOW(),
          updated_at = NOW()
        WHERE id = $2
          AND status = 'reviewed'
        RETURNING *
      `,
      [check_number, reimbursementId],
    );

    if (reimbursementResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error: "Reimbursement is not reviewed or does not exist",
      });
    }

    await client.query(
      `
        INSERT INTO audit_log (
          entity_type,
          entity_id,
          action,
          field_name,
          new_value,
          changed_by_user_id
        )
        VALUES (
          'reimbursement',
          $1,
          'paid',
          'check_number',
          $2,
          $3
        )
      `,
      [reimbursementId, check_number, paid_by_user_id],
    );

    await client.query("COMMIT");

    return res.json(reimbursementResult.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

export default router;
