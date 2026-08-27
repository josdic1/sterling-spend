import { Router } from "express";
import { z } from "zod";
import { db } from "../db/index.js";

const router = Router();

type SubmissionBlocker =
  | {
      type: "active_event";
      event_id: string;
      event_name: string;
    }
  | {
      type: "unassigned_expense";
      expense_id: string;
      vendor: string | null;
      claimed_amount: number;
    };

type KnownIssueResolution = {
  resolved: boolean;
  resolution_reason: string | null;
  resolved_by_name: string | null;
  resolved_at: string | null;
};

type KnownIssue =
  | ({
      issue_key: string;
      type: "toll_mismatch";
      event_id: string;
      event_name: string;
      planned_amount: number;
      evidence_amount: number;
      difference: number;
    } & KnownIssueResolution)
  | ({
      issue_key: string;
      type: "possible_duplicate";
      event_id: string | null;
      event_name: string | null;
      vendor: string;
      expense_date: string;
      claimed_amount: number;
      count: number;
      expense_ids: string[];
    } & KnownIssueResolution);

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function knownIssueTitle(issue: KnownIssue) {
  if (issue.type === "toll_mismatch") {
    return `${issue.evidence_amount === 0 ? "Toll evidence missing" : "Toll mismatch"} · ${issue.event_name}`;
  }

  return `Possible duplicate · ${issue.vendor}${
    issue.event_name ? ` · ${issue.event_name}` : ""
  }`;
}

function resolutionFor(
  resolutionMap: Map<
    string,
    {
      reason: string | null;
      changed_at: string;
      changed_by_name: string;
    }
  >,
  issueKey: string,
): KnownIssueResolution {
  const resolution = resolutionMap.get(issueKey);

  return {
    resolved: Boolean(resolution),
    resolution_reason: resolution?.reason ?? null,
    resolved_by_name: resolution?.changed_by_name ?? null,
    resolved_at: resolution?.changed_at ?? null,
  };
}

async function getReimbursementAnalysis(
  reimbursementId: string,
) {
  const reimbursementContextResult = await db.query(
    `
      SELECT
        r.user_id,
        r.status,
        active_event.id AS active_event_id,
        active_event.name AS active_event_name
      FROM reimbursements r
      LEFT JOIN LATERAL (
        SELECT e.id, e.name
        FROM event_sessions es
        JOIN events e
          ON e.id = es.event_id
        WHERE es.user_id = r.user_id
          AND es.ended_at IS NULL
        ORDER BY es.started_at DESC
        LIMIT 1
      ) active_event ON TRUE
      WHERE r.id = $1
    `,
    [reimbursementId],
  );

  if (reimbursementContextResult.rows.length === 0) {
    return {
      issue_count: 0,
      unresolved_issue_count: 0,
      known_issues: [] as KnownIssue[],
      blocker_count: 0,
      submission_blockers: [] as SubmissionBlocker[],
    };
  }

  const reimbursementContext =
    reimbursementContextResult.rows[0];

  const tollResult = await db.query(
    `
      SELECT
        me.event_id,
        ev.name AS event_name,
        me.planned_tolls_amount,
        COALESCE(SUM(
          CASE
            WHEN c.name = 'Tolls' THEN e.claimed_amount
            ELSE 0
          END
        ), 0) AS toll_evidence_amount
      FROM mileage_entries me
      JOIN events ev
        ON ev.id = me.event_id
      LEFT JOIN expenses e
        ON e.reimbursement_id = me.reimbursement_id
        AND e.event_id = me.event_id
      LEFT JOIN expense_categories c
        ON c.id = e.category_id
      WHERE me.reimbursement_id = $1
        AND me.planned_tolls_amount IS NOT NULL
      GROUP BY
        me.event_id,
        ev.name,
        me.planned_tolls_amount
    `,
    [reimbursementId],
  );

  const duplicateResult = await db.query(
    `
      SELECT
        e.event_id,
        ev.name AS event_name,
        MIN(e.vendor) AS vendor,
        e.expense_date,
        e.claimed_amount,
        COUNT(*)::int AS duplicate_count,
        ARRAY_AGG(e.id ORDER BY e.created_at) AS expense_ids
      FROM expenses e
      LEFT JOIN events ev
        ON ev.id = e.event_id
      WHERE e.reimbursement_id = $1
        AND e.vendor IS NOT NULL
        AND BTRIM(e.vendor) <> ''
      GROUP BY
        e.event_id,
        ev.name,
        LOWER(BTRIM(e.vendor)),
        e.expense_date,
        e.claimed_amount,
        e.category_id
      HAVING COUNT(*) > 1
    `,
    [reimbursementId],
  );

  const resolutionResult = await db.query(
    `
      SELECT DISTINCT ON (al.old_value)
        al.old_value AS issue_key,
        al.reason,
        al.changed_at,
        u.name AS changed_by_name
      FROM audit_log al
      JOIN users u
        ON u.id = al.changed_by_user_id
      WHERE al.entity_type = 'reimbursement'
        AND al.entity_id = $1
        AND al.action = 'resolved_issue'
        AND al.field_name = 'analysis_issue'
        AND al.old_value IS NOT NULL
      ORDER BY al.old_value, al.changed_at DESC
    `,
    [reimbursementId],
  );

  const resolutionMap = new Map<
    string,
    {
      reason: string | null;
      changed_at: string;
      changed_by_name: string;
    }
  >(
    resolutionResult.rows.map((row) => [
      String(row.issue_key),
      {
        reason: row.reason,
        changed_at: row.changed_at,
        changed_by_name: row.changed_by_name,
      },
    ]),
  );

  const knownIssues: KnownIssue[] = [];

  for (const row of tollResult.rows) {
    const planned = Number(row.planned_tolls_amount);
    const evidence = Number(row.toll_evidence_amount);
    const difference = roundMoney(evidence - planned);

    if (Math.abs(difference) >= 0.01) {
      const issueKey = [
        "toll_mismatch",
        row.event_id,
        planned.toFixed(2),
        evidence.toFixed(2),
      ].join(":");

      knownIssues.push({
        issue_key: issueKey,
        type: "toll_mismatch",
        event_id: row.event_id,
        event_name: row.event_name,
        planned_amount: planned,
        evidence_amount: evidence,
        difference,
        ...resolutionFor(resolutionMap, issueKey),
      });
    }
  }

  for (const row of duplicateResult.rows) {
    const expenseIds = [...row.expense_ids].sort();
    const issueKey = `possible_duplicate:${expenseIds.join(",")}`;

    knownIssues.push({
      issue_key: issueKey,
      type: "possible_duplicate",
      event_id: row.event_id,
      event_name: row.event_name,
      vendor: row.vendor,
      expense_date: row.expense_date,
      claimed_amount: Number(row.claimed_amount),
      count: Number(row.duplicate_count),
      expense_ids: expenseIds,
      ...resolutionFor(resolutionMap, issueKey),
    });
  }

  const submissionBlockers: SubmissionBlocker[] = [];

  if (
    reimbursementContext.status === "open" &&
    reimbursementContext.active_event_id
  ) {
    submissionBlockers.push({
      type: "active_event",
      event_id: reimbursementContext.active_event_id,
      event_name: reimbursementContext.active_event_name,
    });
  }

  const unassignedExpensesResult = await db.query(
    `
      SELECT id, vendor, claimed_amount
      FROM expenses
      WHERE reimbursement_id = $1
        AND event_id IS NULL
      ORDER BY created_at
    `,
    [reimbursementId],
  );

  for (const row of unassignedExpensesResult.rows) {
    submissionBlockers.push({
      type: "unassigned_expense",
      expense_id: row.id,
      vendor: row.vendor,
      claimed_amount: Number(row.claimed_amount),
    });
  }

  const unresolvedIssueCount = knownIssues.filter(
    (issue) => !issue.resolved,
  ).length;

  return {
    issue_count: knownIssues.length,
    unresolved_issue_count: unresolvedIssueCount,
    known_issues: knownIssues,
    blocker_count: submissionBlockers.length,
    submission_blockers: submissionBlockers,
  };
}

const requestingUserQuerySchema = z.object({
  requesting_user_id: z.string().uuid(),
});

const resolveIssueSchema = z.object({
  resolved_by_user_id: z.string().uuid(),
  issue_key: z.string().trim().min(1).max(2000),
  reason: z.string().trim().min(1).max(500),
});

const addNoteSchema = z.object({
  added_by_user_id: z.string().uuid(),
  note: z.string().trim().min(1).max(1000),
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

  const queueWithAnalysis = await Promise.all(
    queueResult.rows.map(async (row) => {
      const analysis = await getReimbursementAnalysis(row.id);

      return {
        ...row,
        issue_count: analysis.unresolved_issue_count,
        issue_summaries: analysis.known_issues
          .filter((issue) => !issue.resolved)
          .map(knownIssueTitle),
      };
    }),
  );

  return res.json(queueWithAnalysis);
});

router.get("/admin/paid", async (req, res) => {
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
      error: "Only an active admin can view paid reimbursements",
    });
  }

  const paidResult = await db.query(
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
      WHERE r.status = 'paid'
      ORDER BY r.paid_at DESC, r.created_at DESC
    `,
  );

  return res.json(paidResult.rows);
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
        me.event_session_id,
        me.trip_date,
        me.source,
        me.claimed_miles,
        me.approved_miles,
        me.planned_tolls_amount,
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

  const analysis = await getReimbursementAnalysis(
    reimbursement.id,
  );

  return res.json({
    ...reimbursement,
    totals: totalsResult.rows[0],
    expenses: expensesResult.rows,
    mileage: mileageResult.rows,
    analysis,
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
        me.event_session_id,
        me.trip_date,
        me.source,
        me.claimed_miles,
        me.approved_miles,
        me.planned_tolls_amount,
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

  const adjustmentsResult = await db.query(
    `
      SELECT
        al.id,
        al.entity_type,
        al.entity_id,
        al.field_name,
        al.old_value,
        al.new_value,
        al.reason,
        al.changed_at,
        u.name AS changed_by_name,
        CASE
          WHEN al.entity_type = 'expense'
            THEN COALESCE(e.vendor, c.name, 'Expense')
          WHEN al.entity_type = 'mileage'
            THEN COALESCE(ev.name, 'Mileage')
          ELSE al.entity_type
        END AS item_name
      FROM audit_log al
      JOIN users u
        ON u.id = al.changed_by_user_id
      LEFT JOIN expenses e
        ON al.entity_type = 'expense'
        AND e.id = al.entity_id
        AND e.reimbursement_id = $1
      LEFT JOIN expense_categories c
        ON c.id = e.category_id
      LEFT JOIN mileage_entries me
        ON al.entity_type = 'mileage'
        AND me.id = al.entity_id
        AND me.reimbursement_id = $1
      LEFT JOIN events ev
        ON ev.id = me.event_id
      WHERE al.action = 'updated'
        AND al.field_name IN ('approved_amount', 'approved_miles')
        AND (e.id IS NOT NULL OR me.id IS NOT NULL)
      ORDER BY al.changed_at DESC
    `,
    [reimbursementId],
  );

  const notesResult = await db.query(
    `
      SELECT
        al.id,
        al.new_value AS note,
        al.changed_at,
        u.name AS changed_by_name
      FROM audit_log al
      JOIN users u
        ON u.id = al.changed_by_user_id
      WHERE al.entity_type = 'reimbursement'
        AND al.entity_id = $1
        AND al.action = 'note_added'
        AND al.field_name = 'admin_note'
      ORDER BY al.changed_at DESC
    `,
    [reimbursementId],
  );

  const {
    requesting_user_role: _requestingUserRole,
    requesting_user_is_active: _requestingUserIsActive,
    ...publicReimbursement
  } = reimbursement;

  const analysis = await getReimbursementAnalysis(
    reimbursementId,
  );

  return res.json({
    ...publicReimbursement,
    totals: totalsResult.rows[0],
    expenses: expensesResult.rows,
    mileage: mileageResult.rows,
    adjustments: adjustmentsResult.rows,
    notes: notesResult.rows,
    analysis,
  });
});

router.post("/:reimbursementId/submit", async (req, res) => {
  const { reimbursementId } = req.params;
  const {
    submitted_by_user_id,
    acknowledge_known_issues = false,
  } = req.body;

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

    const analysis = await getReimbursementAnalysis(
      reimbursementId,
    );

    if (analysis.blocker_count > 0) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        error:
          "Finish the active event and fix required items before submitting",
        analysis,
      });
    }

    if (
      analysis.issue_count > 0 &&
      acknowledge_known_issues !== true
    ) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        error:
          "Known issues must be acknowledged before submission",
        analysis,
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

    if (analysis.issue_count > 0) {
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
            'acknowledged_known_issues',
            'known_issues',
            $2,
            $3
          )
        `,
        [
          reimbursementId,
          JSON.stringify(analysis.known_issues),
          submitted_by_user_id,
        ],
      );
    }

    await client.query("COMMIT");

    return res.json(reimbursementResult.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

router.post("/:reimbursementId/issues/resolve", async (req, res) => {
  const { reimbursementId } = req.params;
  const parsed = resolveIssueSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Issue and resolution reason are required",
    });
  }

  const {
    resolved_by_user_id,
    issue_key,
    reason,
  } = parsed.data;

  const adminResult = await db.query(
    `
      SELECT id
      FROM users
      WHERE id = $1
        AND role = 'admin'
        AND is_active = TRUE
    `,
    [resolved_by_user_id],
  );

  if (adminResult.rows.length === 0) {
    return res.status(403).json({
      error: "Only an active admin can resolve issues",
    });
  }

  const reimbursementResult = await db.query(
    `
      SELECT id, status
      FROM reimbursements
      WHERE id = $1
    `,
    [reimbursementId],
  );

  if (reimbursementResult.rows.length === 0) {
    return res.status(404).json({
      error: "Reimbursement not found",
    });
  }

  if (reimbursementResult.rows[0].status !== "submitted") {
    return res.status(400).json({
      error: "Issues can only be resolved during submitted review",
    });
  }

  const analysis = await getReimbursementAnalysis(
    reimbursementId,
  );

  const issue = analysis.known_issues.find(
    (candidate) => candidate.issue_key === issue_key,
  );

  if (!issue) {
    return res.status(404).json({
      error: "That issue is no longer present",
    });
  }

  if (issue.resolved) {
    return res.status(409).json({
      error: "That issue is already resolved",
    });
  }

  await db.query(
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
        'reimbursement',
        $1,
        'resolved_issue',
        'analysis_issue',
        $2,
        $3,
        $4,
        $5
      )
    `,
    [
      reimbursementId,
      issue_key,
      JSON.stringify(issue),
      resolved_by_user_id,
      reason,
    ],
  );

  return res.json(
    await getReimbursementAnalysis(reimbursementId),
  );
});

router.post("/:reimbursementId/notes", async (req, res) => {
  const { reimbursementId } = req.params;
  const parsed = addNoteSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "A note is required",
    });
  }

  const { added_by_user_id, note } = parsed.data;

  const adminResult = await db.query(
    `
      SELECT id
      FROM users
      WHERE id = $1
        AND role = 'admin'
        AND is_active = TRUE
    `,
    [added_by_user_id],
  );

  if (adminResult.rows.length === 0) {
    return res.status(403).json({
      error: "Only an active admin can add review notes",
    });
  }

  const reimbursementResult = await db.query(
    `SELECT id FROM reimbursements WHERE id = $1`,
    [reimbursementId],
  );

  if (reimbursementResult.rows.length === 0) {
    return res.status(404).json({
      error: "Reimbursement not found",
    });
  }

  const noteResult = await db.query(
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
        'note_added',
        'admin_note',
        $2,
        $3
      )
      RETURNING id, new_value AS note, changed_at
    `,
    [reimbursementId, note, added_by_user_id],
  );

  return res.status(201).json(noteResult.rows[0]);
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

    const analysis = await getReimbursementAnalysis(
      reimbursementId,
    );

    if (
      analysis.blocker_count > 0 ||
      analysis.unresolved_issue_count > 0
    ) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        error:
          "Resolve required items and known issues before marking this reimbursement reviewed",
        analysis,
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
