import { Router } from "express";
import { z } from "zod";
import { db } from "../db/index.js";

const router = Router();

const adminQuerySchema = z.object({
  requesting_user_id: z.string().uuid(),
});

const createUserSchema = z.object({
  requesting_user_id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(320),
  username: z.string().trim().min(1).max(120),
  password: z.string().min(4).max(500),
});

const setActiveSchema = z.object({
  requesting_user_id: z.string().uuid(),
  is_active: z.boolean(),
});

async function isActiveAdmin(userId: string) {
  const result = await db.query(
    `
      SELECT id
      FROM users
      WHERE id = $1
        AND role = 'admin'
        AND is_active = TRUE
    `,
    [userId],
  );

  return result.rows.length > 0;
}

router.get("/admin", async (req, res) => {
  const parsed = adminQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid admin request",
      details: parsed.error.flatten(),
    });
  }

  const { requesting_user_id } = parsed.data;

  if (!(await isActiveAdmin(requesting_user_id))) {
    return res.status(403).json({
      error: "Only an active admin can manage users",
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
        is_active,
        created_at
      FROM users
      ORDER BY is_active DESC, name ASC
    `,
  );

  return res.json(result.rows);
});

router.post("/admin", async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid user data",
      details: parsed.error.flatten(),
    });
  }

  const {
    requesting_user_id,
    name,
    email,
    username,
    password,
  } = parsed.data;

  const normalizedEmail = email.toLowerCase();

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
      [requesting_user_id],
    );

    if (adminResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        error: "Only an active admin can add users",
      });
    }

    const existingResult = await client.query(
      `
        SELECT id, name, email, username, role, is_active
        FROM users
        WHERE LOWER(email) = LOWER($1)
           OR LOWER(username) = LOWER($2)
        LIMIT 1
      `,
      [normalizedEmail, username],
    );

    if (existingResult.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: existingResult.rows[0].is_active
          ? "That email or username is already in use"
          : "This user already exists but is inactive. Reactivate them instead.",
        user: existingResult.rows[0],
      });
    }

    const userResult = await client.query(
      `
        INSERT INTO users (
          name,
          email,
          username,
          password_hash,
          role,
          is_active
        )
        VALUES ($1, $2, $3, crypt($4, gen_salt('bf', 12)), 'user', TRUE)
        RETURNING
          id,
          name,
          email,
          username,
          role,
          is_active,
          created_at
      `,
      [name, normalizedEmail, username, password],
    );

    const user = userResult.rows[0];

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
          'user',
          $1,
          'created',
          'is_active',
          NULL,
          'true',
          $2,
          NULL
        )
      `,
      [user.id, requesting_user_id],
    );

    await client.query("COMMIT");
    return res.status(201).json(user);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

router.patch("/:userId/active", async (req, res) => {
  const { userId } = req.params;
  const parsed = setActiveSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid user status data",
      details: parsed.error.flatten(),
    });
  }

  const {
    requesting_user_id,
    is_active,
  } = parsed.data;

  if (userId === requesting_user_id && !is_active) {
    return res.status(400).json({
      error: "You cannot deactivate your own admin account",
    });
  }

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
      [requesting_user_id],
    );

    if (adminResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        error: "Only an active admin can change user status",
      });
    }

    const existingResult = await client.query(
      `
        SELECT id, name, email, username, role, is_active, created_at
        FROM users
        WHERE id = $1
        FOR UPDATE
      `,
      [userId],
    );

    if (existingResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        error: "User not found",
      });
    }

    const existingUser = existingResult.rows[0];

    if (existingUser.is_active === is_active) {
      await client.query("COMMIT");
      return res.json(existingUser);
    }

    const userResult = await client.query(
      `
        UPDATE users
        SET
          is_active = $1,
          updated_at = NOW()
        WHERE id = $2
        RETURNING
          id,
          name,
          email,
          username,
          role,
          is_active,
          created_at
      `,
      [is_active, userId],
    );

    if (!is_active) {
      await client.query(
        `
          UPDATE event_sessions
          SET ended_at = NOW()
          WHERE user_id = $1
            AND ended_at IS NULL
        `,
        [userId],
      );
    }

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
          'user',
          $1,
          $2,
          'is_active',
          $3,
          $4,
          $5,
          NULL
        )
      `,
      [
        userId,
        is_active ? "reactivated" : "deactivated",
        String(existingUser.is_active),
        String(is_active),
        requesting_user_id,
      ],
    );

    await client.query("COMMIT");
    return res.json(userResult.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

export default router;
