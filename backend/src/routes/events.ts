import { Router } from "express";
import { db } from "../db/index.js";

const router = Router();

router.get("/assigned/:userId", async (req, res) => {
  const { userId } = req.params;

  const result = await db.query(
    `
      SELECT
        e.id,
        e.event_number,
        e.name,
        e.event_date,
        e.event_type,
        e.venue_name,
        e.venue_address,
        e.client_name,
        e.start_time,
        e.end_time,
        e.status
      FROM event_assignments ea
      JOIN events e
        ON e.id = ea.event_id
      WHERE ea.user_id = $1
      ORDER BY e.event_date, e.start_time
    `,
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

    await client.query(
      `
        UPDATE event_sessions
        SET ended_at = NOW()
        WHERE user_id = $1
          AND ended_at IS NULL
      `,
      [user_id],
    );

    const result = await client.query(
      `
        INSERT INTO event_sessions (
          user_id,
          event_id
        )
        VALUES ($1, $2)
        RETURNING *
      `,
      [user_id, eventId],
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

router.get("/active/:userId", async (req, res) => {
  const { userId } = req.params;

  const result = await db.query(
    `
      SELECT
        es.id AS session_id,
        es.started_at,
        e.id AS event_id,
        e.event_number,
        e.name,
        e.event_date,
        e.venue_name,
        e.venue_address
      FROM event_sessions es
      JOIN events e
        ON e.id = es.event_id
      WHERE es.user_id = $1
        AND es.ended_at IS NULL
      ORDER BY es.started_at DESC
      LIMIT 1
    `,
    [userId],
  );

  res.json(result.rows[0] ?? null);
});

router.post("/sessions/:sessionId/end", async (req, res) => {
  const { sessionId } = req.params;

  const result = await db.query(
    `
      UPDATE event_sessions
      SET ended_at = NOW()
      WHERE id = $1
        AND ended_at IS NULL
      RETURNING *
    `,
    [sessionId],
  );

  if (result.rows.length === 0) {
    return res.status(404).json({
      error: "Active event session not found",
    });
  }

  res.json(result.rows[0]);
});

export default router;
