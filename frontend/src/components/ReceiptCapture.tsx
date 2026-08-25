import { useEffect, useState } from "react";
import {
  Camera,
  CheckCircle2,
  CircleAlert,
  LoaderCircle,
  Route as RouteIcon,
  X,
} from "lucide-react";
import { format } from "date-fns";
import {
  analyzeReceipt,
  createExpense,
  getExpenseCategories,
  TEST_EMPLOYEE_ID,
  uploadExpenseReceipt,
  type ExpenseCategory,
  type ReceiptAnalysis,
} from "../lib/api";
import "./ReceiptCapture.css";

type ReceiptCaptureProps = {
  file: File;
  onCancel: () => void;
  onSaved: () => void;
  mode?: "receipt" | "toll";
};

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function formatExpenseDate(value: string) {
  return format(
    new Date(`${value}T12:00:00`),
    "MMM d, yyyy",
  );
}

export default function ReceiptCapture({
  file,
  onCancel,
  onSaved,
  mode = "receipt",
}: ReceiptCaptureProps) {
  const [analysis, setAnalysis] =
    useState<ReceiptAnalysis | null>(null);

  const [categories, setCategories] = useState<
    ExpenseCategory[]
  >([]);

  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState("");
  const [categoryId, setCategoryId] = useState("");

  const [analyzing, setAnalyzing] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isToll = mode === "toll";

  useEffect(() => {
    let cancelled = false;

    async function runAnalysis() {
      try {
        setAnalyzing(true);
        setError("");

        const [result, categoryResult] =
          await Promise.all([
            analyzeReceipt(
              TEST_EMPLOYEE_ID,
              file,
            ),
            getExpenseCategories(),
          ]);

        if (cancelled) {
          return;
        }

        setAnalysis(result);
        setCategories(
          categoryResult.filter(
            (category) => category.is_active,
          ),
        );

        setAmount(
          result.amount !== null
            ? String(result.amount)
            : "",
        );

        setExpenseDate(
          result.expense_date ?? "",
        );

        setCategoryId(
          result.category_id ?? "",
        );
      } catch (caughtError) {
        if (!cancelled) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "Could not read receipt.",
          );
        }
      } finally {
        if (!cancelled) {
          setAnalyzing(false);
        }
      }
    }

    void runAnalysis();

    return () => {
      cancelled = true;
    };
  }, [file]);

  const needsAmount =
    analysis?.amount === null;

  const needsDate =
    analysis?.expense_date === null;

  const needsCategory =
    analysis?.category_id === null;

  const missingCount =
    Number(needsAmount) +
    Number(needsDate) +
    Number(needsCategory);

  const numericAmount = Number(amount);

  const canSave =
    analysis !== null &&
    amount.trim() !== "" &&
    Number.isFinite(numericAmount) &&
    numericAmount > 0 &&
    expenseDate !== "" &&
    categoryId !== "";

  async function handleSave() {
    if (!analysis || !canSave) {
      return;
    }

    try {
      setSaving(true);
      setError("");

      const expense = await createExpense({
        user_id: TEST_EMPLOYEE_ID,
        category_id: categoryId,
        expense_date: expenseDate,
        claimed_amount: amount,
        vendor: analysis.vendor ?? undefined,
      });

      await uploadExpenseReceipt(
        expense.id,
        TEST_EMPLOYEE_ID,
        file,
      );

      onSaved();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not save expense.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="receipt-capture">
      <header className="receipt-capture-header">
        <div>
          <span>
            {isToll ? "NEW TOLL" : "NEW EXPENSE"}
          </span>

          <h1>
            {analyzing
              ? "Reading…"
              : "Confirm receipt"}
          </h1>
        </div>

        <button
          type="button"
          className="receipt-close"
          onClick={onCancel}
          aria-label="Close"
        >
          <X size={21} />
        </button>
      </header>

      <div className="receipt-file-card">
        <div className="receipt-file-icon">
          {isToll ? (
            <RouteIcon size={24} />
          ) : (
            <Camera size={24} />
          )}
        </div>

        <div>
          <strong>Receipt captured</strong>
          <span>{file.name}</span>
        </div>
      </div>

      {analyzing ? (
        <section className="receipt-analyzing">
          <LoaderCircle
            className="receipt-spinner"
            size={28}
          />

          <div>
            <strong>Reading your receipt</strong>
            <span>
              Finding the total, vendor, date,
              category, and event.
            </span>
          </div>
        </section>
      ) : analysis ? (
        <>
          <section className="receipt-confirm-card">
            <div
              className={`receipt-confirm-status ${
                missingCount > 0
                  ? "needs-check"
                  : ""
              }`}
            >
              {missingCount > 0 ? (
                <CircleAlert size={19} />
              ) : (
                <CheckCircle2 size={19} />
              )}

              <strong>
                {missingCount > 0
                  ? `Check ${missingCount} detail${
                      missingCount === 1 ? "" : "s"
                    }`
                  : "Receipt read"}
              </strong>
            </div>

            <div className="receipt-confirm-amount">
              <span>AMOUNT</span>

              {needsAmount ? (
                <div className="money-input">
                  <span>$</span>

                  <input
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="0.01"
                    placeholder="0.00"
                    value={amount}
                    onChange={(event) =>
                      setAmount(event.target.value)
                    }
                    autoFocus
                  />
                </div>
              ) : (
                <strong>
                  {formatMoney(numericAmount)}
                </strong>
              )}
            </div>

            <div className="receipt-confirm-details">
              <div>
                <span>Vendor</span>
                <strong>
                  {analysis.vendor ||
                    "Couldn’t read"}
                </strong>
              </div>

              <div>
                <span>Date</span>

                {needsDate ? (
                  <input
                    className="receipt-confirm-input"
                    type="date"
                    value={expenseDate}
                    onChange={(event) =>
                      setExpenseDate(
                        event.target.value,
                      )
                    }
                  />
                ) : (
                  <strong>
                    {formatExpenseDate(expenseDate)}
                  </strong>
                )}
              </div>

              <div>
                <span>Category</span>

                {needsCategory ? (
                  <select
                    className="receipt-confirm-input"
                    value={categoryId}
                    onChange={(event) =>
                      setCategoryId(
                        event.target.value,
                      )
                    }
                  >
                    <option value="">
                      Choose category
                    </option>

                    {categories.map((category) => (
                      <option
                        key={category.id}
                        value={category.id}
                      >
                        {category.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <strong>
                    {analysis.category_name}
                  </strong>
                )}
              </div>

              <div>
                <span>Event</span>
                <strong>
                  {analysis.active_event
                    ? `${analysis.active_event.name} · ${analysis.active_event.event_number}`
                    : "No active event"}
                </strong>
              </div>
            </div>
          </section>

          {missingCount > 0 && (
            <p className="receipt-check-note">
              Check the highlighted detail, then save.
            </p>
          )}

          {error && (
            <p className="receipt-error">{error}</p>
          )}

          <button
            type="button"
            className="receipt-save"
            disabled={!canSave || saving}
            onClick={() => {
              void handleSave();
            }}
          >
            {saving
              ? "Saving…"
              : "Confirm & Save"}
          </button>

          <button
            type="button"
            className="receipt-retake"
            onClick={onCancel}
          >
            Retake photo
          </button>
        </>
      ) : (
        <p className="receipt-error">
          {error || "Could not read receipt."}
        </p>
      )}
    </main>
  );
}
