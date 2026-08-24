export const TEST_EMPLOYEE_ID =
  "0c57ebeb-cb79-44f6-95fa-479d4166e31c";

export type Expense = {
  id: string;
  expense_date: string;
  vendor: string | null;
  description: string | null;
  claimed_amount: string;
  approved_amount: string;
  category_name: string;
  event_id: string | null;
  event_number: string | null;
  event_name: string | null;
};

export type MileageEntry = {
  id: string;
  trip_date: string;
  source: string;
  claimed_miles: string;
  approved_miles: string;
  rate_per_mile: string;
  event_id: string;
  event_number: string;
  event_name: string;
};

export type CurrentReimbursement = {
  id: string;
  year: number;
  month: number;
  status: "open" | "submitted" | "reviewed" | "paid";
  submitted_at: string | null;
  reviewed_at: string | null;
  check_number: string | null;
  paid_at: string | null;
  totals: {
    claimed_total: string;
    approved_total: string;
  };
  expenses: Expense[];
  mileage: MileageEntry[];
};

export type ActiveEvent = {
  session_id: string;
  started_at: string;
  event_id: string;
  event_number: string;
  name: string;
  event_date: string;
  venue_name: string | null;
  venue_address: string | null;
};

export async function getCurrentReimbursement(
  userId: string,
): Promise<CurrentReimbursement | null> {
  const response = await fetch(
    `/api/reimbursements/current/${userId}`,
  );

  if (!response.ok) {
    throw new Error("Could not load reimbursement");
  }

  return response.json();
}

export async function getActiveEvent(
  userId: string,
): Promise<ActiveEvent | null> {
  const response = await fetch(`/api/events/active/${userId}`);

  if (!response.ok) {
    throw new Error("Could not load active event");
  }

  return response.json();
}
