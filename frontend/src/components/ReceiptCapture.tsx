import { useEffect, useState } from "react";
import { Camera, Route as RouteIcon, X } from "lucide-react";
import {
  createExpense,
  getExpenseCategories,
  TEST_EMPLOYEE_ID,
  uploadExpenseReceipt,
  type ExpenseCategory,
} from "../lib/api";
import "./ReceiptCapture.css";

type ReceiptCaptureProps = {
  file: File;
  onCancel: () => void;
  onSaved: () => void;
  mode?: "receipt" | "toll";
};

export default function ReceiptCapture({
  file,
  onCancel,
  onSaved,
  mode = "receipt",
}: ReceiptCaptureProps) {
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [vendor, setVendor] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isToll = mode === "toll";

  useEffect(() => {
    async function loadCategories() {
      try {
        const result = await getExpenseCategories();
        const active = result.filter((category) => category.is_active);

        setCategories(active);

        if (active.length === 0) {
          return;
        }

        if (isToll) {
          const tollCategory = active.find(
            (category) => category.name === "Tolls",
          );

          if (tollCategory) {
            setCategoryId(tollCategory.id);
            return;
          }
        }

        setCategoryId(active[0].id);
      } catch {
        setError("Could not load expense categories.");
      }
    }

    void loadCategories();
  }, [isToll]);

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!categoryId || !amount) {
      setError("Amount and category are required.");
      return;
    }

    try {
      setSaving(true);
      setError("");

      const expense = await createExpense({
        user_id: TEST_EMPLOYEE_ID,
        category_id: categoryId,
        expense_date: new Date().toISOString().slice(0, 10),
        claimed_amount: amount,
        vendor: vendor.trim() || undefined,
        description: description.trim() || undefined,
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
          <span>{isToll ? "NEW TOLL" : "NEW EXPENSE"}</span>
          <h1>{isToll ? "Toll" : "Receipt"}</h1>
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
          <strong>
            {isToll ? "Toll receipt captured" : "Receipt captured"}
          </strong>
          <span>{file.name}</span>
        </div>
      </div>

      <form className="receipt-form" onSubmit={handleSubmit}>
        <label className="receipt-field">
          <span>Amount</span>

          <div className="money-input">
            <span>$</span>

            <input
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              required
              autoFocus
            />
          </div>
        </label>

        <label className="receipt-field">
          <span>{isToll ? "Road / Agency" : "Vendor"}</span>

          <input
            type="text"
            placeholder={
              isToll ? "NJ Turnpike" : "Restaurant Depot"
            }
            value={vendor}
            onChange={(event) => setVendor(event.target.value)}
          />
        </label>

        {!isToll && (
          <label className="receipt-field">
            <span>Category</span>

            <select
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              required
            >
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="receipt-field">
          <span>Note</span>

          <textarea
            rows={3}
            placeholder="Optional"
            value={description}
            onChange={(event) =>
              setDescription(event.target.value)
            }
          />
        </label>

        {error && <p className="receipt-error">{error}</p>}

        <button
          type="submit"
          className="receipt-save"
          disabled={saving || !categoryId}
        >
          {saving
            ? "Saving…"
            : isToll
              ? "Save toll"
              : "Save expense"}
        </button>
      </form>
    </main>
  );
}
