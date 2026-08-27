import { useEffect, useState } from "react";
import {
  Camera,
  CheckCircle2,
  CircleAlert,
  LoaderCircle,
  MapPin,
  Route as RouteIcon,
  X,
} from "lucide-react";
import { format } from "date-fns";
import {
  analyzeReceipt,
  createExpense,
  getAssignedEvents,
  getExpenseCategories,
  getNearbyVendorSuggestions,
  uploadExpenseReceipt,
  type AssignedEvent,
  type ExpenseCategory,
  type ReceiptAnalysis,
} from "../lib/api";
import "./ReceiptCapture.css";

type ReceiptCaptureProps = {
  userId: string;
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
  userId,
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

  const [assignedEvents, setAssignedEvents] = useState<
    AssignedEvent[]
  >([]);

  const [eventId, setEventId] = useState("");
  const [vendor, setVendor] = useState("");
  const [vendorSuggestions, setVendorSuggestions] = useState<
    Array<{ id: string | null; name: string; address: string | null }>
  >([]);
  const [findingVendor, setFindingVendor] = useState(false);
  const [vendorSuggestionError, setVendorSuggestionError] = useState("");
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

        const [result, categoryResult, eventResult] =
          await Promise.all([
            analyzeReceipt(
              userId,
              file,
            ),
            getExpenseCategories(),
            getAssignedEvents(userId),
          ]);

        if (cancelled) {
          return;
        }

        const activeCategories =
          categoryResult.filter(
            (category) => category.is_active,
          );

        setAnalysis(result);
        setCategories(activeCategories);
        setAssignedEvents(eventResult);
        setEventId(result.active_event?.id ?? "");
        setVendor(result.vendor ?? "");
        setVendorSuggestions([]);
        setVendorSuggestionError("");

        setAmount(
          result.amount !== null
            ? String(result.amount)
            : "",
        );

        setExpenseDate(result.expense_date ?? "");

        if (isToll) {
          const tollCategory =
            activeCategories.find(
              (category) =>
                category.name.trim().toLowerCase() ===
                "tolls",
            );

          if (!tollCategory) {
            setCategoryId("");
            setError(
              "The Tolls category is not configured.",
            );
          } else {
            setCategoryId(tollCategory.id);
          }
        } else {
          setCategoryId(
            result.category_id ?? "",
          );
        }
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
  }, [file, isToll]);

  const needsAmount =
    analysis?.amount === null;

  const needsVendor =
    !isToll &&
    analysis?.vendor === null;

  const hasActiveEvent = Boolean(analysis?.active_event);
  const selectedAssignedEvent = assignedEvents.find(
    (event) => event.id === eventId,
  );
  const selectedEventDate =
    analysis?.active_event?.event_date ??
    selectedAssignedEvent?.event_date ??
    null;
  const selectedEventName =
    analysis?.active_event?.name ??
    selectedAssignedEvent?.name ??
    null;
  const selectedEventDateKey = selectedEventDate
    ? selectedEventDate.slice(0, 10)
    : null;

  // Receipt date is financial truth. Capture date is only metadata.
  // For Event expenses, compare the receipt date to the Event date.
  const needsDate = Boolean(analysis) && expenseDate === "";
  const receiptDateDiffersFromEvent =
    Boolean(selectedEventDateKey) &&
    expenseDate !== "" &&
    expenseDate !== selectedEventDateKey;

  // Active Event receipts stay frictionless when the date agrees with the
  // Event. Historical/manual entries keep the date visible.
  const showDateField =
    Boolean(analysis) &&
    (!hasActiveEvent || needsDate || receiptDateDiffersFromEvent);

  const needsCategory =
    !isToll &&
    analysis?.category_id === null;

  const receiptIssues = [
    needsAmount ? "Amount not found" : null,
    needsVendor ? "Vendor not found" : null,
    needsDate ? "Date not found" : null,
    needsCategory ? "Category not determined" : null,
    receiptDateDiffersFromEvent && selectedEventDateKey
      ? `Check date — receipt says ${formatExpenseDate(expenseDate)} · Event is ${formatExpenseDate(selectedEventDateKey)}`
      : null,
  ].filter((issue): issue is string => issue !== null);

  const missingCount = receiptIssues.length;

  const numericAmount = Number(amount);

  const needsEvent =
    analysis !== null &&
    analysis.active_event === null;

  const canSave =
    analysis !== null &&
    amount.trim() !== "" &&
    Number.isFinite(numericAmount) &&
    numericAmount > 0 &&
    (isToll || vendor.trim() !== "") &&
    expenseDate !== "" &&
    categoryId !== "" &&
    (!needsEvent || eventId !== "");

  async function handleFindNearbyVendor() {
    if (!analysis || analysis.vendor !== null) {
      return;
    }

    if (!("geolocation" in navigator)) {
      setVendorSuggestionError(
        "Location is not available on this device.",
      );
      return;
    }

    try {
      setFindingVendor(true);
      setVendorSuggestionError("");
      setVendorSuggestions([]);

      const position = await new Promise<GeolocationPosition>(
        (resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            resolve,
            reject,
            {
              enableHighAccuracy: false,
              timeout: 8000,
              maximumAge: 60000,
            },
          );
        },
      );

      const suggestions = await getNearbyVendorSuggestions({
        user_id: userId,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy_meters: position.coords.accuracy,
      });

      setVendorSuggestions(suggestions);

      if (suggestions.length === 0) {
        setVendorSuggestionError(
          "No nearby vendor suggestion found.",
        );
      }
    } catch (caughtError) {
      setVendorSuggestionError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not suggest a nearby vendor.",
      );
    } finally {
      setFindingVendor(false);
    }
  }

  async function handleSave() {
    if (!analysis || !canSave) {
      return;
    }

    try {
      setSaving(true);
      setError("");

      const expense = await createExpense({
        user_id: userId,
        event_id: eventId || undefined,
        category_id: categoryId,
        expense_date: expenseDate,
        claimed_amount: amount,
        vendor: vendor.trim() || undefined,
      });

      await uploadExpenseReceipt(
        expense.id,
        userId,
        file,
      );

      onSaved();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : isToll
            ? "Could not save toll."
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
              : isToll
                ? "Confirm toll"
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
          <strong>
            {isToll
              ? "Toll receipt captured"
              : "Receipt captured"}
          </strong>
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
            <strong>
              {isToll
                ? "Reading your toll receipt"
                : "Reading your receipt"}
            </strong>

            <span>
              {isToll
                ? "Finding the total, vendor, and event."
                : "Finding the total, vendor, category, and event."}
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

              {missingCount > 0 ? (
                <div className="receipt-issue-summary">
                  {receiptIssues.map((issue) => (
                    <strong key={issue}>{issue}</strong>
                  ))}
                </div>
              ) : (
                <strong>{isToll ? "Toll read" : "Receipt read"}</strong>
              )}
            </div>

            <div className={`receipt-confirm-amount ${needsAmount ? "receipt-field-warning" : ""}`}>
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
              {(!isToll || vendor.trim() !== "") && (
                <div className={needsVendor ? "receipt-detail-edit receipt-field-warning" : undefined}>
                  <span>{isToll ? "Toll agency/location" : "Vendor"}</span>

                  {needsVendor ? (
                    <div className="receipt-vendor-fallback">
                      <input
                        className="receipt-confirm-input"
                        type="text"
                        value={vendor}
                        placeholder="Enter vendor"
                        onChange={(event) =>
                          setVendor(event.target.value)
                        }
                      />

                      <button
                        type="button"
                        className="receipt-nearby-button"
                        disabled={findingVendor}
                        onClick={() => {
                          void handleFindNearbyVendor();
                        }}
                      >
                        <MapPin size={15} />
                        {findingVendor
                          ? "Finding nearby…"
                          : "Suggest nearby"}
                      </button>

                      {vendorSuggestions.length > 0 && (
                        <div className="receipt-vendor-suggestions">
                          <span>Nearby suggestions</span>
                          {vendorSuggestions.map((suggestion, index) => (
                            <button
                              key={suggestion.id ?? `${suggestion.name}-${index}`}
                              type="button"
                              onClick={() => {
                                setVendor(suggestion.name);
                                setVendorSuggestions([]);
                                setVendorSuggestionError("");
                              }}
                            >
                              <strong>{suggestion.name}</strong>
                              {suggestion.address && (
                                <small>{suggestion.address}</small>
                              )}
                            </button>
                          ))}
                        </div>
                      )}

                      {vendorSuggestionError && (
                        <small className="receipt-vendor-suggestion-error">
                          {vendorSuggestionError}
                        </small>
                      )}
                    </div>
                  ) : (
                    <strong>{vendor}</strong>
                  )}
                </div>
              )}

              {showDateField && (
                <div className={(needsDate || receiptDateDiffersFromEvent) ? "receipt-detail-edit receipt-field-warning" : undefined}>
                  <span>Date</span>

                  <div className="receipt-date-check">
                    <input
                      className="receipt-confirm-input"
                      type="date"
                      value={expenseDate}
                      onChange={(event) =>
                        setExpenseDate(event.target.value)
                      }
                    />

                    {selectedEventDateKey && expenseDate !== selectedEventDateKey && (
                      <button
                        type="button"
                        className="receipt-use-event-date"
                        onClick={() => setExpenseDate(selectedEventDateKey)}
                      >
                        Use Event date · {formatExpenseDate(selectedEventDateKey)}
                      </button>
                    )}

                    {receiptDateDiffersFromEvent && selectedEventDateKey && (
                      <small>
                        Receipt date differs from {selectedEventName ?? "the Event"}. Keep the receipt date if it is correct, or use the Event date.
                      </small>
                    )}

                    {needsDate && selectedEventDateKey && (
                      <small>
                        No date was readable. Use the Event date if that is when the purchase happened.
                      </small>
                    )}
                  </div>
                </div>
              )}

              {!isToll && (
                <div className={needsCategory ? "receipt-field-warning" : undefined}>
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
              )}

              <div>
                <span>Event</span>

                {analysis.active_event ? (
                  <strong>
                    {`${analysis.active_event.name} · ${analysis.active_event.event_number}`}
                  </strong>
                ) : (
                  <select
                    className="receipt-confirm-input"
                    value={eventId}
                    onChange={(event) =>
                      setEventId(event.target.value)
                    }
                  >
                    <option value="">
                      Choose event
                    </option>

                    {assignedEvents.map((assignedEvent) => (
                      <option
                        key={assignedEvent.id}
                        value={assignedEvent.id}
                      >
                        {assignedEvent.name} · {assignedEvent.event_number}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          </section>

          {needsEvent && (
            <p className="receipt-check-note">
              Choose the event this expense belongs to. This does not activate the event.
            </p>
          )}

          {missingCount > 0 && (
            <p className="receipt-check-note receipt-check-note-warning">
              Fix the highlighted {missingCount === 1 ? "field" : "fields"}, then save.
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
