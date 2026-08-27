import express from "express";
import { db } from "./db/index.js";
import expensesRouter from "./routes/expenses.js";
import eventsRouter from "./routes/events.js";
import mileageRouter from "./routes/mileage.js";
import receiptAnalysisRouter from "./routes/receipt-analysis.js";
import reimbursementsRouter from "./routes/reimbursements.js";
import usersRouter from "./routes/users.js";
import authRouter from "./routes/auth.js";
import {
  attachmentsRouter,
  expenseAttachmentsRouter,
  reimbursementAttachmentsRouter,
} from "./routes/attachments.js";

const app = express();

const port = Number(process.env.PORT ?? 3001);

app.use(express.json());

app.use("/api/expenses", expensesRouter);
app.use("/api/expenses", expenseAttachmentsRouter);

app.use("/api/reimbursements", reimbursementsRouter);
app.use("/api/reimbursements", reimbursementAttachmentsRouter);

app.use("/api/attachments", attachmentsRouter);

app.use("/api/events", eventsRouter);
app.use("/api/mileage", mileageRouter);
app.use("/api/receipt-analysis", receiptAnalysisRouter);
app.use("/api/users", usersRouter);
app.use("/api/auth", authRouter);

app.get("/health", async (_req, res) => {
  const result = await db.query("SELECT NOW() AS now");

  res.json({
    ok: true,
    database: true,
    time: result.rows[0].now,
  });
});

app.get("/api/categories", async (_req, res) => {
  const result = await db.query(`
    SELECT id, name, is_active
    FROM expense_categories
    WHERE is_active = TRUE
    ORDER BY name
  `);

  res.json(result.rows);
});

app.listen(port, () => {
  console.log(`Sterling Spend backend running on http://localhost:${port}`);
});
