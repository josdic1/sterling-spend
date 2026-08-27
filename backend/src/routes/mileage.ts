import { Router } from "express";
import { z } from "zod";
import { db } from "../db/index.js";

const router = Router();

const STERLING_CARLSTADT_ADDRESS =
  "100 Commerce Road, Carlstadt, NJ 07072";

const METERS_PER_MILE = 1609.344;

const createMileageSchema = z.object({
  user_id: z.string().uuid(),
  event_id: z.string().uuid().optional(),
  trip_date: z.string(),
  source: z.enum(["automatic", "manual"]),
  claimed_miles: z.number().nonnegative(),
  planned_tolls_amount: z.number().nonnegative().nullable().optional(),
});

const automaticMileageQuoteSchema = z.object({
  user_id: z.string().uuid(),
});

const saveAutomaticTravelSchema = z.object({
  user_id: z.string().uuid(),
  event_id: z.string().uuid(),
  trip_date: z.string(),
  planned_miles: z.number().nonnegative(),
  planned_tolls_amount: z.number().nonnegative().nullable(),
});

const adjustApprovedMilesSchema = z.object({
  approved_miles: z.number().nonnegative(),
  changed_by_user_id: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
});

type GoogleMoney = {
  currencyCode?: string;
  units?: string;
  nanos?: number;
};

type GoogleTollInfo = {
  estimatedPrice?: GoogleMoney[];
};

function metersToMiles(meters: number) {
  return Math.round((meters / METERS_PER_MILE) * 10) / 10;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function googleMoneyToNumber(
  money: GoogleMoney | undefined,
): number | null {
  if (!money) {
    return null;
  }

  const units = Number(money.units ?? "0");
  const nanos = Number(money.nanos ?? 0);

  if (
    !Number.isFinite(units) ||
    !Number.isFinite(nanos)
  ) {
    return null;
  }

  return roundMoney(
    units + nanos / 1_000_000_000,
  );
}

function readTollInfo(
  tollInfo: GoogleTollInfo | undefined,
) {
  if (!tollInfo) {
    return {
      has_tolls: false,
      estimated_amount: null,
      currency_code: null,
    };
  }

  const price =
    tollInfo.estimatedPrice?.find(
      (entry) => entry.currencyCode === "USD",
    ) ??
    tollInfo.estimatedPrice?.[0];

  return {
    has_tolls: true,
    estimated_amount:
      googleMoneyToNumber(price),
    currency_code:
      price?.currencyCode ?? null,
  };
}

router.get("/current/:userId", async (req, res) => {
  const { userId } = req.params;

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;

  const result = await db.query(
    `
      SELECT
        me.id AS mileage_id,
        me.event_session_id,
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

router.post("/automatic-quote", async (req, res) => {
  const parsed =
    automaticMileageQuoteSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid mileage quote request",
      details: parsed.error.flatten(),
    });
  }

  const { user_id } = parsed.data;

  const googleMapsApiKey =
    process.env.GOOGLE_MAPS_API_KEY;

  if (!googleMapsApiKey) {
    return res.status(503).json({
      error: "Google Maps routing is not configured",
    });
  }

  const activeEventResult = await db.query(
    `
      SELECT
        es.id AS session_id,
        es.planned_miles,
        es.planned_tolls_amount,
        es.planned_mileage_amount,
        es.mileage_rate_id,
        mr.rate_per_mile AS stored_rate_per_mile,
        e.id AS event_id,
        e.event_number,
        e.name,
        e.event_date,
        e.venue_name,
        e.venue_address
      FROM event_sessions es
      JOIN users u
        ON u.id = es.user_id
      JOIN events e
        ON e.id = es.event_id
      LEFT JOIN mileage_rates mr
        ON mr.id = es.mileage_rate_id
      WHERE es.user_id = $1
        AND es.ended_at IS NULL
        AND u.is_active = TRUE
      ORDER BY es.started_at DESC
      LIMIT 1
    `,
    [user_id],
  );

  if (activeEventResult.rows.length === 0) {
    return res.status(400).json({
      error: "Automatic mileage requires an active event",
    });
  }

  const activeEvent =
    activeEventResult.rows[0];

  if (!activeEvent.venue_address) {
    return res.status(400).json({
      error:
        "Active event does not have a venue address",
    });
  }

  if (
    activeEvent.planned_miles !== null &&
    activeEvent.planned_miles !== undefined &&
    activeEvent.stored_rate_per_mile !== null &&
    activeEvent.stored_rate_per_mile !== undefined
  ) {
    const plannedMiles = Number(activeEvent.planned_miles);
    const ratePerMile = Number(activeEvent.stored_rate_per_mile);

    return res.json({
      already_saved: true,
      event: {
        id: activeEvent.event_id,
        event_number: activeEvent.event_number,
        name: activeEvent.name,
        event_date: activeEvent.event_date,
        venue_name: activeEvent.venue_name,
        venue_address: activeEvent.venue_address,
      },
      travel: {
        session_id: activeEvent.session_id,
        planned_miles: plannedMiles,
        planned_tolls_amount:
          activeEvent.planned_tolls_amount === null
            ? null
            : Number(activeEvent.planned_tolls_amount),
        rate_per_mile: ratePerMile,
        planned_mileage_amount:
          activeEvent.planned_mileage_amount === null
            ? roundMoney(plannedMiles * ratePerMile)
            : Number(activeEvent.planned_mileage_amount),
      },
    });
  }

  const rateResult = await db.query(
    `
      SELECT
        id,
        rate_per_mile
      FROM mileage_rates
      WHERE effective_from <= $1
        AND (
          effective_to IS NULL
          OR effective_to >= $1
        )
      ORDER BY effective_from DESC
      LIMIT 1
    `,
    [activeEvent.event_date],
  );

  if (rateResult.rows.length === 0) {
    return res.status(400).json({
      error:
        "No mileage rate found for event date",
    });
  }

  const routeResponse = await fetch(
    "https://routes.googleapis.com/directions/v2:computeRoutes",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key":
          googleMapsApiKey,
        "X-Goog-FieldMask": [
          "routes.distanceMeters",
          "routes.legs.distanceMeters",
          "routes.travelAdvisory.tollInfo",
          "routes.legs.travelAdvisory.tollInfo",
        ].join(","),
      },
      body: JSON.stringify({
        origin: {
          address:
            STERLING_CARLSTADT_ADDRESS,
        },
        destination: {
          address:
            STERLING_CARLSTADT_ADDRESS,
        },
        intermediates: [
          {
            address:
              activeEvent.venue_address,
          },
        ],
        travelMode: "DRIVE",
        routingPreference:
          "TRAFFIC_UNAWARE",
        computeAlternativeRoutes: false,
        extraComputations: ["TOLLS"],
        routeModifiers: {
          vehicleInfo: {
            emissionType: "GASOLINE",
          },
        },
      }),
    },
  );

  const routeBody =
    (await routeResponse.json()) as {
      routes?: Array<{
        distanceMeters?: number;
        travelAdvisory?: {
          tollInfo?: GoogleTollInfo;
        };
        legs?: Array<{
          distanceMeters?: number;
          travelAdvisory?: {
            tollInfo?: GoogleTollInfo;
          };
        }>;
      }>;
      error?: {
        message?: string;
      };
    };

  if (!routeResponse.ok) {
    return res.status(502).json({
      error:
        routeBody.error?.message ??
        "Google Maps could not calculate route",
    });
  }

  const route =
    routeBody.routes?.[0];

  if (
    !route ||
    typeof route.distanceMeters !==
      "number"
  ) {
    return res.status(502).json({
      error:
        "Google Maps did not return a usable route",
    });
  }

  const outboundMeters =
    route.legs?.[0]?.distanceMeters ?? 0;

  const returnMeters =
    route.legs?.[1]?.distanceMeters ?? 0;

  const roundTripMiles =
    metersToMiles(route.distanceMeters);

  const ratePerMile = Number(
    rateResult.rows[0].rate_per_mile,
  );

  const routeTolls = readTollInfo(
    route.travelAdvisory?.tollInfo,
  );

  const outboundTolls = readTollInfo(
    route.legs?.[0]?.travelAdvisory
      ?.tollInfo,
  );

  const returnTolls = readTollInfo(
    route.legs?.[1]?.travelAdvisory
      ?.tollInfo,
  );

  res.json({
    already_saved: false,
    event: {
      id: activeEvent.event_id,
      event_number:
        activeEvent.event_number,
      name: activeEvent.name,
      event_date:
        activeEvent.event_date,
      venue_name:
        activeEvent.venue_name,
      venue_address:
        activeEvent.venue_address,
    },
    route: {
      origin:
        STERLING_CARLSTADT_ADDRESS,
      destination:
        activeEvent.venue_address,
      outbound_miles:
        metersToMiles(outboundMeters),
      return_miles:
        metersToMiles(returnMeters),
      round_trip_miles:
        roundTripMiles,
    },
    tolls: {
      has_tolls:
        routeTolls.has_tolls,
      estimated_round_trip_amount:
        routeTolls.estimated_amount,
      currency_code:
        routeTolls.currency_code,
      outbound: {
        has_tolls:
          outboundTolls.has_tolls,
        estimated_amount:
          outboundTolls.estimated_amount,
      },
      return: {
        has_tolls:
          returnTolls.has_tolls,
        estimated_amount:
          returnTolls.estimated_amount,
      },
    },
    mileage_rate: {
      id: rateResult.rows[0].id,
      rate_per_mile: ratePerMile,
    },
    reimbursement_amount:
      roundMoney(
        roundTripMiles * ratePerMile,
      ),
  });
});

router.post("/automatic-travel", async (req, res) => {
  const parsed = saveAutomaticTravelSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid automatic travel data",
      details: parsed.error.flatten(),
    });
  }

  const {
    user_id,
    event_id,
    trip_date,
    planned_miles,
    planned_tolls_amount,
  } = parsed.data;

  const tripDate = new Date(`${trip_date}T12:00:00Z`);
  const year = tripDate.getUTCFullYear();
  const month = tripDate.getUTCMonth() + 1;
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const sessionResult = await client.query(
      `
        SELECT es.id
        FROM event_sessions es
        JOIN users u ON u.id = es.user_id
        WHERE es.user_id = $1
          AND es.event_id = $2
          AND es.ended_at IS NULL
          AND u.is_active = TRUE
        ORDER BY es.started_at DESC
        LIMIT 1
        FOR UPDATE OF es
      `,
      [user_id, event_id],
    );

    if (sessionResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Automatic travel requires the active event",
      });
    }

    const sessionId = sessionResult.rows[0].id;

    const rateResult = await client.query(
      `
        SELECT id, rate_per_mile
        FROM mileage_rates
        WHERE effective_from <= $1
          AND (effective_to IS NULL OR effective_to >= $1)
        ORDER BY effective_from DESC
        LIMIT 1
      `,
      [trip_date],
    );

    if (rateResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "No mileage rate found for event date",
      });
    }

    const mileageRateId = rateResult.rows[0].id;
    const ratePerMile = Number(rateResult.rows[0].rate_per_mile);
    const plannedMileageAmount = roundMoney(planned_miles * ratePerMile);

    const travelResult = await client.query(
      `
        UPDATE event_sessions
        SET
          planned_miles = $1,
          planned_tolls_amount = $2,
          mileage_rate_id = $3,
          planned_mileage_amount = $4,
          travel_calculated_at = NOW()
        WHERE id = $5
        RETURNING
          id AS session_id,
          planned_miles,
          planned_tolls_amount,
          planned_mileage_amount,
          travel_calculated_at
      `,
      [
        planned_miles,
        planned_tolls_amount,
        mileageRateId,
        plannedMileageAmount,
        sessionId,
      ],
    );

    // Active travel is independent of any closed historical reimbursement.
    // Reuse the current OPEN working record or create a new one. Never reopen
    // or modify a submitted/reviewed/paid record.
    let openReimbursementResult = await client.query(
      `
        SELECT id
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

    if (openReimbursementResult.rows.length === 0) {
      openReimbursementResult = await client.query(
        `
          INSERT INTO reimbursements (user_id, year, month)
          VALUES ($1, $2, $3)
          ON CONFLICT (user_id, year, month)
            WHERE status = 'open'
          DO NOTHING
          RETURNING id
        `,
        [user_id, year, month],
      );

      if (openReimbursementResult.rows.length === 0) {
        openReimbursementResult = await client.query(
          `
            SELECT id
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

    let mileageEntryId: string | null = null;

    if (openReimbursementResult.rows.length > 0) {
      const reimbursementId = openReimbursementResult.rows[0].id;

      const existingResult = await client.query(
        `
          SELECT id
          FROM mileage_entries
          WHERE event_session_id = $1
          LIMIT 1
        `,
        [sessionId],
      );

      if (existingResult.rows.length > 0) {
        const updateResult = await client.query(
          `
            UPDATE mileage_entries
            SET
              reimbursement_id = $1,
              event_id = $2,
              trip_date = $3,
              claimed_miles = $4,
              approved_miles = $4,
              mileage_rate_id = $5,
              planned_tolls_amount = $6,
              updated_at = NOW()
            WHERE id = $7
            RETURNING id
          `,
          [
            reimbursementId,
            event_id,
            trip_date,
            planned_miles,
            mileageRateId,
            planned_tolls_amount,
            existingResult.rows[0].id,
          ],
        );
        mileageEntryId = updateResult.rows[0].id;
      } else {
        const legacyResult = await client.query(
          `
            SELECT id
            FROM mileage_entries
            WHERE reimbursement_id = $1
              AND event_id = $2
              AND trip_date = $3
              AND event_session_id IS NULL
            ORDER BY created_at DESC
            LIMIT 1
          `,
          [reimbursementId, event_id, trip_date],
        );

        if (legacyResult.rows.length > 0) {
          const updateResult = await client.query(
            `
              UPDATE mileage_entries
              SET
                event_session_id = $1,
                claimed_miles = $2,
                approved_miles = $2,
                mileage_rate_id = $3,
                planned_tolls_amount = $4,
                updated_at = NOW()
              WHERE id = $5
              RETURNING id
            `,
            [
              sessionId,
              planned_miles,
              mileageRateId,
              planned_tolls_amount,
              legacyResult.rows[0].id,
            ],
          );
          mileageEntryId = updateResult.rows[0].id;
        } else {
          const insertResult = await client.query(
            `
              INSERT INTO mileage_entries (
                reimbursement_id,
                event_id,
                event_session_id,
                trip_date,
                source,
                claimed_miles,
                approved_miles,
                mileage_rate_id,
                planned_tolls_amount
              )
              VALUES ($1, $2, $3, $4, 'automatic', $5, $5, $6, $7)
              RETURNING id
            `,
            [
              reimbursementId,
              event_id,
              sessionId,
              trip_date,
              planned_miles,
              mileageRateId,
              planned_tolls_amount,
            ],
          );
          mileageEntryId = insertResult.rows[0].id;
        }
      }
    }

    await client.query("COMMIT");

    return res.status(201).json({
      travel: {
        ...travelResult.rows[0],
        rate_per_mile: ratePerMile,
      },
      mileage_entry_id: mileageEntryId,
      reimbursement_linked: mileageEntryId !== null,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

router.post("/", async (req, res) => {
  const parsed =
    createMileageSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid mileage data",
      details: parsed.error.flatten(),
    });
  }

  const {
    user_id,
    event_id,
    trip_date,
    source,
    claimed_miles,
    planned_tolls_amount,
  } = parsed.data;

  const tripDate =
    new Date(`${trip_date}T12:00:00Z`);

  const year =
    tripDate.getUTCFullYear();

  const month =
    tripDate.getUTCMonth() + 1;

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
        error: "Inactive users cannot add mileage",
      });
    }

    const activeEventResult =
      await client.query(
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
      activeEventResult.rows[0]
        ?.event_id ??
      event_id ??
      null;

    if (!resolvedEventId) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error:
          "Mileage requires an event",
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
        ON CONFLICT (
          user_id,
          year,
          month
        )
        DO NOTHING
      `,
      [user_id, year, month],
    );

    const reimbursementResult =
      await client.query(
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

    if (
      reimbursementResult.rows.length === 0
    ) {
      await client.query("ROLLBACK");

      return res.status(500).json({
        error:
          "Could not find or create reimbursement",
      });
    }

    const reimbursement =
      reimbursementResult.rows[0];

    if (
      reimbursement.status !== "open"
    ) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error:
          "Only open reimbursements can receive new mileage entries",
      });
    }

    const rateResult =
      await client.query(
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

    if (
      rateResult.rows.length === 0
    ) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error:
          "No mileage rate found for trip date",
      });
    }

    const result =
      await client.query(
        `
          INSERT INTO mileage_entries (
            reimbursement_id,
            event_id,
            trip_date,
            source,
            claimed_miles,
            approved_miles,
            mileage_rate_id,
            planned_tolls_amount
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $5,
            $6,
            $7
          )
          ON CONFLICT (
            reimbursement_id,
            event_id,
            trip_date
          )
          DO UPDATE SET
            planned_tolls_amount = EXCLUDED.planned_tolls_amount,
            updated_at = NOW()
          WHERE EXCLUDED.source = 'automatic'
            AND mileage_entries.source = 'automatic'
            AND mileage_entries.planned_tolls_amount IS NULL
          RETURNING *
        `,
        [
          reimbursement.id,
          resolvedEventId,
          trip_date,
          source,
          claimed_miles,
          rateResult.rows[0].id,
          planned_tolls_amount ?? null,
        ],
      );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        error:
          "Mileage has already been saved for this event",
      });
    }

    await client.query("COMMIT");

    res.status(201).json(
      result.rows[0],
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

router.patch(
  "/:mileageId/approved-miles",
  async (req, res) => {
    const { mileageId } =
      req.params;

    const parsed =
      adjustApprovedMilesSchema.safeParse(
        req.body,
      );

    if (!parsed.success) {
      return res.status(400).json({
        error:
          "Invalid mileage adjustment",
        details:
          parsed.error.flatten(),
      });
    }

    const {
      approved_miles,
      changed_by_user_id,
      reason,
    } = parsed.data;

    const client =
      await db.connect();

    try {
      await client.query("BEGIN");

      const adminResult =
        await client.query(
          `
            SELECT id
            FROM users
            WHERE id = $1
              AND role = 'admin'
              AND is_active = TRUE
          `,
          [changed_by_user_id],
        );

      if (
        adminResult.rows.length === 0
      ) {
        await client.query(
          "ROLLBACK",
        );

        return res.status(403).json({
          error:
            "Only an active admin can adjust approved mileage",
        });
      }

      const existingResult =
        await client.query(
          `
            SELECT
              me.approved_miles,
              r.status
            FROM mileage_entries me
            JOIN reimbursements r
              ON r.id =
                me.reimbursement_id
            WHERE me.id = $1
          `,
          [mileageId],
        );

      if (
        existingResult.rows.length === 0
      ) {
        await client.query(
          "ROLLBACK",
        );

        return res.status(404).json({
          error:
            "Mileage entry does not exist",
        });
      }

      if (
        existingResult.rows[0]
          .status === "paid"
      ) {
        await client.query(
          "ROLLBACK",
        );

        return res.status(400).json({
          error:
            "Paid reimbursements cannot be changed",
        });
      }

      const oldApprovedMiles =
        existingResult.rows[0]
          .approved_miles;

      const mileageResult =
        await client.query(
          `
            UPDATE mileage_entries
            SET
              approved_miles = $1,
              updated_at = NOW()
            WHERE id = $2
            RETURNING *
          `,
          [
            approved_miles,
            mileageId,
          ],
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
            'mileage',
            $1,
            'updated',
            'approved_miles',
            $2,
            $3,
            $4,
            $5
          )
        `,
        [
          mileageId,
          oldApprovedMiles,
          approved_miles,
          changed_by_user_id,
          reason,
        ],
      );

      await client.query("COMMIT");

      res.json(
        mileageResult.rows[0],
      );
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
);

export default router;
