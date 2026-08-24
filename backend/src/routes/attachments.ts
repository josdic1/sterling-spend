import { randomUUID } from "node:crypto";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { db } from "../db/index.js";
import { r2, R2_BUCKET } from "../storage/r2.js";

export const expenseAttachmentsRouter = Router();
export const reimbursementAttachmentsRouter = Router();
export const attachmentsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (_req, file, callback) => {
    const allowedMimeTypes = new Set([
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf",
    ]);

    if (!allowedMimeTypes.has(file.mimetype)) {
      return callback(new Error("Unsupported file type"));
    }

    callback(null, true);
  },
});

const uploadBodySchema = z.object({
  uploaded_by_user_id: z.string().uuid(),
});

const reimbursementUploadBodySchema = z.object({
  uploaded_by_user_id: z.string().uuid(),
  purpose: z.enum(["ezpass_statement", "check_stub", "other"]),
});

const fileQuerySchema = z.object({
  requesting_user_id: z.string().uuid(),
});

type ReimbursementAttachmentPurpose =
  | "ezpass_statement"
  | "check_stub"
  | "other";

type ReimbursementStatus = "open" | "submitted" | "reviewed" | "paid";

type ActorRole = "user" | "admin";

function canAddReimbursementAttachment({
  purpose,
  status,
  actorUserId,
  ownerUserId,
  actorRole,
}: {
  purpose: ReimbursementAttachmentPurpose;
  status: ReimbursementStatus;
  actorUserId: string;
  ownerUserId: string;
  actorRole: ActorRole;
}): boolean {
  if (purpose === "ezpass_statement") {
    return status === "open" && actorUserId === ownerUserId;
  }

  if (purpose === "check_stub") {
    return status === "paid" && actorRole === "admin";
  }

  if (purpose === "other") {
    if (status === "open") {
      return actorUserId === ownerUserId;
    }

    if (status === "submitted" || status === "reviewed") {
      return actorRole === "admin";
    }

    return false;
  }

  return false;
}

function reimbursementAttachmentError(
  purpose: ReimbursementAttachmentPurpose,
  status: ReimbursementStatus,
): string {
  if (purpose === "ezpass_statement") {
    return "EZ-Pass statements can only be added by the reimbursement owner while the reimbursement is open";
  }

  if (purpose === "check_stub") {
    return "Check stubs can only be added by an admin after the reimbursement is paid";
  }

  if (purpose === "other") {
    if (status === "paid") {
      return "Paid reimbursements cannot receive supporting attachments other than check stubs";
    }

    return "Supporting attachments are not allowed for this reimbursement state and user";
  }

  return "Attachment is not allowed";
}

async function deleteR2Object(storageKey: string) {
  try {
    await r2.send(
      new DeleteObjectCommand({
        Bucket: R2_BUCKET,
        Key: storageKey,
      }),
    );
  } catch {
    // Preserve the original request failure.
  }
}

/*
 * EXPENSE ATTACHMENTS — LIST
 */

expenseAttachmentsRouter.get("/:expenseId/attachments", async (req, res) => {
  const { expenseId } = req.params;

  const parsed = fileQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Valid requesting_user_id is required",
    });
  }

  const { requesting_user_id } = parsed.data;

  const accessResult = await db.query(
    `
      SELECT
        r.user_id AS owner_user_id,
        u.role AS requesting_user_role,
        u.is_active AS requesting_user_is_active
      FROM expenses e
      JOIN reimbursements r
        ON r.id = e.reimbursement_id
      LEFT JOIN users u
        ON u.id = $2
      WHERE e.id = $1
    `,
    [expenseId, requesting_user_id],
  );

  if (accessResult.rows.length === 0) {
    return res.status(404).json({
      error: "Expense not found",
    });
  }

  const access = accessResult.rows[0];

  if (!access.requesting_user_is_active) {
    return res.status(403).json({
      error: "Only an active user can view attachments",
    });
  }

  const canView =
    access.owner_user_id === requesting_user_id ||
    access.requesting_user_role === "admin";

  if (!canView) {
    return res.status(403).json({
      error: "You do not have access to these attachments",
    });
  }

  const result = await db.query(
    `
      SELECT
        a.id,
        a.file_name,
        a.mime_type,
        a.file_size_bytes,
        a.created_at
      FROM expense_attachments ea
      JOIN attachments a
        ON a.id = ea.attachment_id
      WHERE ea.expense_id = $1
      ORDER BY a.created_at DESC
    `,
    [expenseId],
  );

  return res.json(result.rows);
});

/*
 * EXPENSE ATTACHMENTS — UPLOAD
 */

expenseAttachmentsRouter.post(
  "/:expenseId/attachments",
  upload.single("file"),
  async (req, res) => {
    const { expenseId } = req.params;

    const parsed = uploadBodySchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid attachment data",
        details: parsed.error.flatten(),
      });
    }

    if (!req.file) {
      return res.status(400).json({
        error: "File is required",
      });
    }

    const { uploaded_by_user_id } = parsed.data;

    const expenseResult = await db.query(
      `
        SELECT
          e.id,
          r.user_id,
          r.status
        FROM expenses e
        JOIN reimbursements r
          ON r.id = e.reimbursement_id
        WHERE e.id = $1
      `,
      [expenseId],
    );

    if (expenseResult.rows.length === 0) {
      return res.status(404).json({
        error: "Expense not found",
      });
    }

    const expense = expenseResult.rows[0];

    const userResult = await db.query(
      `
        SELECT id
        FROM users
        WHERE id = $1
          AND is_active = TRUE
      `,
      [uploaded_by_user_id],
    );

    if (userResult.rows.length === 0) {
      return res.status(403).json({
        error: "Only an active user can upload an attachment",
      });
    }

    if (expense.user_id !== uploaded_by_user_id) {
      return res.status(403).json({
        error: "Users can only upload attachments to their own expenses",
      });
    }

    if (expense.status !== "open") {
      return res.status(400).json({
        error: "Only open reimbursements can receive new expense attachments",
      });
    }

    const storageKey = `expenses/${expenseId}/${randomUUID()}`;

    await r2.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: storageKey,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      }),
    );

    const client = await db.connect();

    try {
      await client.query("BEGIN");

      const lockedExpenseResult = await client.query(
        `
          SELECT
            e.id,
            r.user_id,
            r.status
          FROM expenses e
          JOIN reimbursements r
            ON r.id = e.reimbursement_id
          WHERE e.id = $1
          FOR UPDATE OF e, r
        `,
        [expenseId],
      );

      if (lockedExpenseResult.rows.length === 0) {
        await client.query("ROLLBACK");
        await deleteR2Object(storageKey);

        return res.status(404).json({
          error: "Expense not found",
        });
      }

      const lockedExpense = lockedExpenseResult.rows[0];

      const lockedUserResult = await client.query(
        `
          SELECT id
          FROM users
          WHERE id = $1
            AND is_active = TRUE
        `,
        [uploaded_by_user_id],
      );

      if (lockedUserResult.rows.length === 0) {
        await client.query("ROLLBACK");
        await deleteR2Object(storageKey);

        return res.status(403).json({
          error: "Only an active user can upload an attachment",
        });
      }

      if (lockedExpense.user_id !== uploaded_by_user_id) {
        await client.query("ROLLBACK");
        await deleteR2Object(storageKey);

        return res.status(403).json({
          error: "Users can only upload attachments to their own expenses",
        });
      }

      if (lockedExpense.status !== "open") {
        await client.query("ROLLBACK");
        await deleteR2Object(storageKey);

        return res.status(400).json({
          error: "Only open reimbursements can receive new expense attachments",
        });
      }

      const attachmentResult = await client.query(
        `
          INSERT INTO attachments (
            uploaded_by_user_id,
            file_name,
            storage_key,
            mime_type,
            file_size_bytes
          )
          VALUES ($1, $2, $3, $4, $5)
          RETURNING *
        `,
        [
          uploaded_by_user_id,
          req.file.originalname,
          storageKey,
          req.file.mimetype,
          req.file.size,
        ],
      );

      const attachment = attachmentResult.rows[0];

      await client.query(
        `
          INSERT INTO expense_attachments (
            expense_id,
            attachment_id
          )
          VALUES ($1, $2)
        `,
        [expenseId, attachment.id],
      );

      await client.query("COMMIT");

      return res.status(201).json(attachment);
    } catch (error) {
      await client.query("ROLLBACK");
      await deleteR2Object(storageKey);
      throw error;
    } finally {
      client.release();
    }
  },
);

/*
 * REIMBURSEMENT ATTACHMENTS — LIST
 */

reimbursementAttachmentsRouter.get(
  "/:reimbursementId/attachments",
  async (req, res) => {
    const { reimbursementId } = req.params;

    const parsed = fileQuerySchema.safeParse(req.query);

    if (!parsed.success) {
      return res.status(400).json({
        error: "Valid requesting_user_id is required",
      });
    }

    const { requesting_user_id } = parsed.data;

    const accessResult = await db.query(
      `
        SELECT
          r.user_id AS owner_user_id,
          u.role AS requesting_user_role,
          u.is_active AS requesting_user_is_active
        FROM reimbursements r
        LEFT JOIN users u
          ON u.id = $2
        WHERE r.id = $1
      `,
      [reimbursementId, requesting_user_id],
    );

    if (accessResult.rows.length === 0) {
      return res.status(404).json({
        error: "Reimbursement not found",
      });
    }

    const access = accessResult.rows[0];

    if (!access.requesting_user_is_active) {
      return res.status(403).json({
        error: "Only an active user can view attachments",
      });
    }

    const canView =
      access.owner_user_id === requesting_user_id ||
      access.requesting_user_role === "admin";

    if (!canView) {
      return res.status(403).json({
        error: "You do not have access to these attachments",
      });
    }

    const result = await db.query(
      `
        SELECT
          a.id,
          a.file_name,
          a.mime_type,
          a.file_size_bytes,
          a.created_at,
          ra.purpose
        FROM reimbursement_attachments ra
        JOIN attachments a
          ON a.id = ra.attachment_id
        WHERE ra.reimbursement_id = $1
        ORDER BY a.created_at DESC
      `,
      [reimbursementId],
    );

    return res.json(result.rows);
  },
);

/*
 * REIMBURSEMENT ATTACHMENTS — UPLOAD
 */

reimbursementAttachmentsRouter.post(
  "/:reimbursementId/attachments",
  upload.single("file"),
  async (req, res) => {
    const { reimbursementId } = req.params;

    const parsed = reimbursementUploadBodySchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid reimbursement attachment data",
        details: parsed.error.flatten(),
      });
    }

    if (!req.file) {
      return res.status(400).json({
        error: "File is required",
      });
    }

    const { uploaded_by_user_id, purpose } = parsed.data;

    const precheckResult = await db.query(
      `
        SELECT
          r.id,
          r.user_id AS owner_user_id,
          r.status,
          u.id AS actor_user_id,
          u.role AS actor_role,
          u.is_active AS actor_is_active
        FROM reimbursements r
        LEFT JOIN users u
          ON u.id = $2
        WHERE r.id = $1
      `,
      [reimbursementId, uploaded_by_user_id],
    );

    if (precheckResult.rows.length === 0) {
      return res.status(404).json({
        error: "Reimbursement not found",
      });
    }

    const precheck = precheckResult.rows[0];

    if (!precheck.actor_user_id || !precheck.actor_is_active) {
      return res.status(403).json({
        error: "Only an active user can upload an attachment",
      });
    }

    const precheckAllowed = canAddReimbursementAttachment({
      purpose,
      status: precheck.status,
      actorUserId: uploaded_by_user_id,
      ownerUserId: precheck.owner_user_id,
      actorRole: precheck.actor_role,
    });

    if (!precheckAllowed) {
      return res.status(403).json({
        error: reimbursementAttachmentError(purpose, precheck.status),
      });
    }

    const storageKey = `reimbursements/${reimbursementId}/${purpose}/${randomUUID()}`;

    await r2.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: storageKey,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      }),
    );

    const client = await db.connect();

    try {
      await client.query("BEGIN");

      const lockedResult = await client.query(
        `
          SELECT
            r.id,
            r.user_id AS owner_user_id,
            r.status,
            u.id AS actor_user_id,
            u.role AS actor_role,
            u.is_active AS actor_is_active
          FROM reimbursements r
          LEFT JOIN users u
            ON u.id = $2
          WHERE r.id = $1
          FOR UPDATE OF r
        `,
        [reimbursementId, uploaded_by_user_id],
      );

      if (lockedResult.rows.length === 0) {
        await client.query("ROLLBACK");
        await deleteR2Object(storageKey);

        return res.status(404).json({
          error: "Reimbursement not found",
        });
      }

      const locked = lockedResult.rows[0];

      if (!locked.actor_user_id || !locked.actor_is_active) {
        await client.query("ROLLBACK");
        await deleteR2Object(storageKey);

        return res.status(403).json({
          error: "Only an active user can upload an attachment",
        });
      }

      const lockedAllowed = canAddReimbursementAttachment({
        purpose,
        status: locked.status,
        actorUserId: uploaded_by_user_id,
        ownerUserId: locked.owner_user_id,
        actorRole: locked.actor_role,
      });

      if (!lockedAllowed) {
        await client.query("ROLLBACK");
        await deleteR2Object(storageKey);

        return res.status(403).json({
          error: reimbursementAttachmentError(purpose, locked.status),
        });
      }

      const attachmentResult = await client.query(
        `
          INSERT INTO attachments (
            uploaded_by_user_id,
            file_name,
            storage_key,
            mime_type,
            file_size_bytes
          )
          VALUES ($1, $2, $3, $4, $5)
          RETURNING *
        `,
        [
          uploaded_by_user_id,
          req.file.originalname,
          storageKey,
          req.file.mimetype,
          req.file.size,
        ],
      );

      const attachment = attachmentResult.rows[0];

      await client.query(
        `
          INSERT INTO reimbursement_attachments (
            reimbursement_id,
            attachment_id,
            purpose
          )
          VALUES ($1, $2, $3)
        `,
        [reimbursementId, attachment.id, purpose],
      );

      await client.query("COMMIT");

      return res.status(201).json({
        ...attachment,
        purpose,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      await deleteR2Object(storageKey);
      throw error;
    } finally {
      client.release();
    }
  },
);

/*
 * GENERIC PRIVATE ATTACHMENT RETRIEVAL
 */

attachmentsRouter.get("/:attachmentId/file", async (req, res) => {
  const { attachmentId } = req.params;

  const parsed = fileQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Valid requesting_user_id is required",
    });
  }

  const { requesting_user_id } = parsed.data;

  const actorResult = await db.query(
    `
      SELECT
        id,
        role,
        is_active
      FROM users
      WHERE id = $1
    `,
    [requesting_user_id],
  );

  if (actorResult.rows.length === 0) {
    return res.status(403).json({
      error: "User does not exist",
    });
  }

  const actor = actorResult.rows[0];

  if (!actor.is_active) {
    return res.status(403).json({
      error: "Inactive users cannot view attachments",
    });
  }

  const attachmentResult = await db.query(
    `
      SELECT
        a.storage_key,
        a.file_name,
        a.mime_type,

        (
          EXISTS (
            SELECT 1
            FROM expense_attachments ea
            JOIN expenses e
              ON e.id = ea.expense_id
            JOIN reimbursements r
              ON r.id = e.reimbursement_id
            WHERE ea.attachment_id = a.id
              AND r.user_id = $2
          )
          OR
          EXISTS (
            SELECT 1
            FROM reimbursement_attachments ra
            JOIN reimbursements r
              ON r.id = ra.reimbursement_id
            WHERE ra.attachment_id = a.id
              AND r.user_id = $2
          )
        ) AS requesting_user_owns_attachment

      FROM attachments a
      WHERE a.id = $1
    `,
    [attachmentId, requesting_user_id],
  );

  if (attachmentResult.rows.length === 0) {
    return res.status(404).json({
      error: "Attachment not found",
    });
  }

  const attachment = attachmentResult.rows[0];

  const canView =
    attachment.requesting_user_owns_attachment || actor.role === "admin";

  if (!canView) {
    return res.status(403).json({
      error: "You do not have access to this attachment",
    });
  }

  const object = await r2.send(
    new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: attachment.storage_key,
    }),
  );

  if (!object.Body) {
    return res.status(404).json({
      error: "Stored file not found",
    });
  }

  const bytes = await object.Body.transformToByteArray();

  res.setHeader("Content-Type", attachment.mime_type);
  res.setHeader(
    "Content-Disposition",
    `inline; filename*=UTF-8''${encodeURIComponent(attachment.file_name)}`,
  );

  return res.send(Buffer.from(bytes));
});
