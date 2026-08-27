import { Router } from "express";
import { z } from "zod";
import { db } from "../db/index.js";

const router = Router();

const createExpenseSchema = z.object({
  user_id: z.string().uuid(),
  event_id: z.string().uuid().nullable().optional(),
  category_id: z.string().uuid(),
  expense_date: z.string(),
  vendor: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  claimed_amount: z.number().nonnegative(),
});

const adjustExpenseSchema = z.object({
  approved_amount: z.number().nonnegative(),
  changed_by_user_id: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
});

router.get("/current/:userId", async (req, res) => {
  const { userId } = req.params;

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;

  const result = await db.query(
    `
      SELECT
        r.id AS reimbursement_id,
        r.year,
        r.month,
        r.status,
        e.id AS expense_id,
        e.expense_date,
        e.vendor,
        e.description,
        e.claimed_amount,
        e.approved_amount,
        c.id AS category_id,
        c.name AS category_name,
        e.event_id
      FROM reimbursements r
      LEFT JOIN expenses e
        ON e.reimbursement_id = r.id
      LEFT JOIN expense_categories c
        ON c.id = e.category_id
      WHERE r.user_id = $1
        AND r.year = $2
        AND r.month = $3
      ORDER BY e.expense_date DESC, e.created_at DESC
    `,
    [userId, year, month],
  );

  res.json(result.rows);
});

router.post("/", async (req, res) => {
  const parsed = createExpenseSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid expense data",
      details: parsed.error.flatten(),
    });
  }

  const {
    user_id,
    event_id,
    category_id,
    expense_date,
    vendor,
    description,
    claimed_amount,
  } = parsed.data;

  const expenseDate = new Date(`${expense_date}T12:00:00Z`);
  const year = expenseDate.getUTCFullYear();
  const month = expenseDate.getUTCMonth() + 1;

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
      [user_id],
    );

    if (userResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        error: "Inactive users cannot add expenses",
      });
    }

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

    const activeEventId =
      activeEventResult.rows[0]?.event_id ?? null;

    if (!activeEventId && event_id) {
      const assignmentResult = await client.query(
        `
          SELECT 1
          FROM event_assignments
          WHERE user_id = $1
            AND event_id = $2
        `,
        [user_id, event_id],
      );

      if (assignmentResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(403).json({
          error: "Choose an event assigned to this employee",
        });
      }
    }

    const resolvedEventId =
      activeEventId ?? event_id ?? null;

    let reimbursementResult = await client.query(
      `
        SELECT id, status
        FROM reimbursements
        WHERE user_id = $1
          AND year = $2
          AND month = $3
          AND status = 'open'
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE
      `,
      [user_id, year, month],
    );

    if (reimbursementResult.rows.length === 0) {
      reimbursementResult = await client.query(
        `
          INSERT INTO reimbursements (
            user_id,
            year,
            month
          )
          VALUES ($1, $2, $3)
          ON CONFLICT (user_id, year, month)
            WHERE status = 'open'
          DO NOTHING
          RETURNING id, status
        `,
        [user_id, year, month],
      );

      if (reimbursementResult.rows.length === 0) {
        reimbursementResult = await client.query(
          `
            SELECT id, status
            FROM reimbursements
            WHERE user_id = $1
              AND year = $2
              AND month = $3
              AND status = 'open'
            ORDER BY created_at DESC
            LIMIT 1
            FOR UPDATE
          `,
          [user_id, year, month],
        );
      }
    }

    if (reimbursementResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(500).json({
        error: "Could not create a working expense record",
      });
    }

    const reimbursement = reimbursementResult.rows[0];

    const expenseResult = await client.query(
      `
        INSERT INTO expenses (
          reimbursement_id,
          event_id,
          category_id,
          expense_date,
          vendor,
          description,
          claimed_amount,
          approved_amount
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
        RETURNING *
      `,
      [
        reimbursement.id,
        resolvedEventId,
        category_id,
        expense_date,
        vendor ?? null,
        description ?? null,
        claimed_amount,
      ],
    );

    await client.query("COMMIT");

    res.status(201).json(expenseResult.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

router.patch("/:expenseId/approved-amount", async (req, res) => {
  const { expenseId } = req.params;

  const parsed = adjustExpenseSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid adjustment data",
      details: parsed.error.flatten(),
    });
  }

  const { approved_amount, changed_by_user_id, reason } = parsed.data;

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
        error: "Only an active admin can adjust an expense",
      });
    }

    const existingResult = await client.query(
      `
        SELECT
          e.approved_amount,
          r.status
        FROM expenses e
        JOIN reimbursements r
          ON r.id = e.reimbursement_id
        WHERE e.id = $1
      `,
      [expenseId],
    );

    if (existingResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        error: "Expense not found",
      });
    }

    if (existingResult.rows[0].status === "paid") {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error: "Paid reimbursements cannot be changed",
      });
    }

    const oldValue = existingResult.rows[0].approved_amount;

    const expenseResult = await client.query(
      `
        UPDATE expenses
        SET
          approved_amount = $1,
          updated_at = NOW()
        WHERE id = $2
        RETURNING *
      `,
      [approved_amount, expenseId],
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
          changed_by_user_id,
          reason
        )
        VALUES (
          'expense',
          $1,
          'updated',
          'approved_amount',
          $2,
          $3,
          $4,
          $5
        )
      `,
      [
        expenseId,
        String(oldValue),
        String(approved_amount),
        changed_by_user_id,
        reason,
      ],
    );

    await client.query("COMMIT");

    res.json(expenseResult.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

export default router;
