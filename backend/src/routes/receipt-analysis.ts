import { Router } from "express";
import multer from "multer";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { db } from "../db/index.js";

const router = Router();
const openai = new OpenAI();

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
    ]);

    if (!allowedMimeTypes.has(file.mimetype)) {
      return callback(
        new Error(
          "Receipt analysis supports JPEG, PNG, or WebP images",
        ),
      );
    }

    callback(null, true);
  },
});

const analyzeBodySchema = z.object({
  user_id: z.string().uuid(),
});

const nearbyVendorSchema = z.object({
  user_id: z.string().uuid(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy_meters: z.number().nonnegative().nullable().optional(),
});

const receiptExtractionSchema = z.object({
  vendor: z.string().nullable(),
  expense_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  amount: z.number().nonnegative().nullable(),
  category_name: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

router.post(
  "/",
  upload.single("file"),
  async (req, res) => {
    const parsed = analyzeBodySchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: "Valid user_id is required",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        error: "Receipt image is required",
      });
    }

    const { user_id } = parsed.data;

    const userResult = await db.query(
      `
        SELECT id
        FROM users
        WHERE id = $1
          AND is_active = TRUE
      `,
      [user_id],
    );

    if (userResult.rows.length === 0) {
      return res.status(403).json({
        error: "Only an active user can analyze a receipt",
      });
    }

    const categoriesResult = await db.query(
      `
        SELECT id, name
        FROM expense_categories
        WHERE is_active = TRUE
        ORDER BY name
      `,
    );

    const categories = categoriesResult.rows as Array<{
      id: string;
      name: string;
    }>;

    if (categories.length === 0) {
      return res.status(500).json({
        error: "No active expense categories are configured",
      });
    }

    const activeEventResult = await db.query(
      `
        SELECT
          e.id,
          e.event_number,
          e.name
        FROM event_sessions es
        JOIN events e
          ON e.id = es.event_id
        WHERE es.user_id = $1
          AND es.ended_at IS NULL
        ORDER BY es.started_at DESC
        LIMIT 1
      `,
      [user_id],
    );

    const categoryNames = categories
      .map((category) => category.name)
      .join(", ");

    const imageDataUrl =
      `data:${req.file.mimetype};base64,` +
      req.file.buffer.toString("base64");

    const response = await openai.responses.parse({
      model: "gpt-5.6-terra",
      store: false,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `
Analyze this expense receipt.

Extract:
- vendor: merchant/business name
- expense_date: transaction date as YYYY-MM-DD
- amount: FINAL amount actually charged/paid
- category_name: best matching Sterling expense category
- confidence: overall confidence from 0 to 1

Allowed categories:
${categoryNames}

Rules:
- Use the final total, not subtotal.
- Include tax/tip only when they are part of the final charged total.
- category_name must exactly match one of the allowed category names.
- If a value cannot be determined reliably, return null for that value.
- Do not invent information that is not visible or reasonably inferable from the receipt.
              `.trim(),
            },
            {
              type: "input_image",
              image_url: imageDataUrl,
              detail: "high",
            },
          ],
        },
      ],
      text: {
        format: zodTextFormat(
          receiptExtractionSchema,
          "receipt_extraction",
        ),
      },
    });

    const extraction = response.output_parsed;

    if (!extraction) {
      return res.status(502).json({
        error: "Receipt could not be analyzed",
      });
    }

    const matchedCategory = extraction.category_name
      ? categories.find(
          (category) =>
            category.name.toLowerCase() ===
            extraction.category_name?.toLowerCase(),
        ) ?? null
      : null;

    const activeEvent =
      activeEventResult.rows.length > 0
        ? {
            id: activeEventResult.rows[0].id,
            event_number:
              activeEventResult.rows[0].event_number,
            name: activeEventResult.rows[0].name,
          }
        : null;

    return res.json({
      vendor: extraction.vendor,
      expense_date: extraction.expense_date,
      amount: extraction.amount,
      category_id: matchedCategory?.id ?? null,
      category_name: matchedCategory?.name ?? null,
      confidence: extraction.confidence,
      active_event: activeEvent,
    });
  },
);


router.post("/vendor-suggestions", async (req, res) => {
  const parsed = nearbyVendorSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Valid user and location are required",
    });
  }

  const {
    user_id,
    latitude,
    longitude,
    accuracy_meters,
  } = parsed.data;

  const userResult = await db.query(
    `SELECT id FROM users WHERE id = $1 AND is_active = TRUE`,
    [user_id],
  );

  if (userResult.rows.length === 0) {
    return res.status(403).json({
      error: "Only an active user can request vendor suggestions",
    });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;

  if (!apiKey) {
    return res.status(503).json({
      error: "Nearby vendor suggestions are not configured",
    });
  }

  // Keep this deliberately local: location is only a suggestion signal,
  // never financial truth. The employee must choose a result before save.
  const radiusMeters = Math.min(
    300,
    Math.max(75, (accuracy_meters ?? 50) * 2),
  );

  const placesResponse = await fetch(
    "https://places.googleapis.com/v1/places:searchNearby",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress",
      },
      body: JSON.stringify({
        maxResultCount: 5,
        rankPreference: "DISTANCE",
        locationRestriction: {
          circle: {
            center: {
              latitude,
              longitude,
            },
            radius: radiusMeters,
          },
        },
      }),
    },
  );

  if (!placesResponse.ok) {
    const detail = await placesResponse.text();
    console.error(
      "Google Places vendor suggestion failed",
      placesResponse.status,
      detail,
    );

    return res.status(502).json({
      error: "Nearby vendor suggestions are unavailable",
    });
  }

  const payload = (await placesResponse.json()) as {
    places?: Array<{
      id?: string;
      displayName?: { text?: string };
      formattedAddress?: string;
    }>;
  };

  const suggestions = (payload.places ?? [])
    .map((place) => ({
      id: place.id ?? null,
      name: place.displayName?.text?.trim() ?? "",
      address: place.formattedAddress?.trim() ?? null,
    }))
    .filter((place) => place.name.length > 0);

  return res.json({ suggestions });
});

export default router;
