export const TEST_EMPLOYEE_ID =
  "015ec89f-1530-43d3-829e-8a5045749313";

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

export type AssignedEvent = {
  id: string;
  event_number: string;
  name: string;
  event_date: string;
  event_type: string | null;
  venue_name: string | null;
  venue_address: string | null;
  client_name: string | null;
  start_time: string | null;
  end_time: string | null;
  status: string;
};

export type ExpenseCategory = {
  id: string;
  name: string;
  is_active: boolean;
};

export type CreatedExpense = {
  id: string;
  reimbursement_id: string;
  event_id: string | null;
  category_id: string;
  expense_date: string;
  vendor: string | null;
  description: string | null;
  claimed_amount: string;
  approved_amount: string;
  created_at: string;
  updated_at: string;
};

export type CreatedMileageEntry = {
  id: string;
  reimbursement_id: string;
  event_id: string;
  trip_date: string;
  source: "automatic" | "manual";
  claimed_miles: string;
  approved_miles: string;
  mileage_rate_id: string;
  created_at: string;
  updated_at: string;
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

export async function getAssignedEvents(
  userId: string,
): Promise<AssignedEvent[]> {
  const response = await fetch(`/api/events/assigned/${userId}`);

  if (!response.ok) {
    throw new Error("Could not load assigned events");
  }

  return response.json();
}

export async function getExpenseCategories(): Promise<
  ExpenseCategory[]
> {
  const response = await fetch("/api/categories");

  if (!response.ok) {
    throw new Error("Could not load expense categories");
  }

  return response.json();
}

export async function createExpense(input: {
  user_id: string;
  category_id: string;
  expense_date: string;
  claimed_amount: string;
  vendor?: string;
  description?: string;
}): Promise<CreatedExpense> {
  const response = await fetch("/api/expenses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...input,
      claimed_amount: Number(input.claimed_amount),
    }),
  });

  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error ?? "Could not create expense");
  }

  return body;
}

export async function uploadExpenseReceipt(
  expenseId: string,
  userId: string,
  file: File,
) {
  const formData = new FormData();

  formData.append("uploaded_by_user_id", userId);
  formData.append("file", file);

  const response = await fetch(
    `/api/expenses/${expenseId}/attachments`,
    {
      method: "POST",
      body: formData,
    },
  );

  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error ?? "Could not upload receipt");
  }

  return body;
}

export async function createManualMileage(input: {
  user_id: string;
  event_id: string;
  trip_date: string;
  claimed_miles: string;
}): Promise<CreatedMileageEntry> {
  const response = await fetch("/api/mileage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      user_id: input.user_id,
      event_id: input.event_id,
      trip_date: input.trip_date,
      source: "manual",
      claimed_miles: Number(input.claimed_miles),
    }),
  });

  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error ?? "Could not save mileage");
  }

  return body;
}

export async function activateEvent(
  eventId: string,
  userId: string,
): Promise<void> {
  const response = await fetch(
    `/api/events/${eventId}/activate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id: userId,
      }),
    },
  );

  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error ?? "Could not activate event");
  }
}

export async function endEventSession(
  sessionId: string,
): Promise<void> {
  const response = await fetch(
    `/api/events/sessions/${sessionId}/end`,
    {
      method: "POST",
    },
  );

  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error ?? "Could not end event");
  }
}

export async function submitReimbursement(
  reimbursementId: string,
  userId: string,
): Promise<void> {
  const response = await fetch(
    `/api/reimbursements/${reimbursementId}/submit`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        submitted_by_user_id: userId,
      }),
    },
  );

  const body = await response.json();

  if (!response.ok) {
    throw new Error(
      body.error ?? "Could not submit reimbursement",
    );
  }
}

export const TEST_ADMIN_ID =
  "3f07589b-c84d-4372-818a-69aee47ae002";

export type AdminReimbursementQueueItem = {
  id: string;
  user_id: string;
  employee_name: string;
  employee_email: string;
  year: number;
  month: number;
  status: "submitted" | "reviewed" | "paid";
  submitted_at: string | null;
  reviewed_at: string | null;
  check_number: string | null;
  paid_at: string | null;
  expense_count: string;
  mileage_count: string;
  claimed_total: string;
  approved_total: string;
};

export async function getAdminReimbursementQueue(
  adminUserId: string,
): Promise<AdminReimbursementQueueItem[]> {
  const response = await fetch(
    `/api/reimbursements/admin/queue?requesting_user_id=${adminUserId}`,
  );

  const body = await response.json();

  if (!response.ok) {
    throw new Error(
      body.error ?? "Could not load reimbursement queue",
    );
  }

  return body;
}


export async function getAdminPaidReimbursements(
  adminUserId: string,
): Promise<AdminReimbursementQueueItem[]> {
  const response = await fetch(
    `/api/reimbursements/admin/paid?requesting_user_id=${adminUserId}`,
  );

  const body = await response.json();

  if (!response.ok) {
    throw new Error(
      body.error ?? "Could not load paid reimbursements",
    );
  }

  return body;
}

export type AdminExpense = {
  id: string;
  expense_date: string;
  vendor: string | null;
  description: string | null;
  claimed_amount: string;
  approved_amount: string;
  category_id: string;
  category_name: string;
  event_id: string | null;
  event_number: string | null;
  event_name: string | null;
};

export type AdminMileageEntry = {
  id: string;
  trip_date: string;
  source: "automatic" | "manual";
  claimed_miles: string;
  approved_miles: string;
  mileage_rate_id: string;
  rate_per_mile: string;
  event_id: string;
  event_number: string;
  event_name: string;
};

export type AdminReimbursementDetail = {
  id: string;
  user_id: string;
  employee_name: string;
  employee_email: string;
  year: number;
  month: number;
  status: "submitted" | "reviewed" | "paid";
  submitted_at: string | null;
  reviewed_at: string | null;
  check_number: string | null;
  paid_at: string | null;
  totals: {
    claimed_total: string;
    approved_total: string;
  };
  expenses: AdminExpense[];
  mileage: AdminMileageEntry[];
};

export async function getAdminReimbursementDetail(
  reimbursementId: string,
  adminUserId: string,
): Promise<AdminReimbursementDetail> {
  const response = await fetch(
    `/api/reimbursements/${reimbursementId}?requesting_user_id=${adminUserId}`,
  );

  const body = await response.json();

  if (!response.ok) {
    throw new Error(
      body.error ?? "Could not load reimbursement",
    );
  }

  return body;
}

export async function updateApprovedExpenseAmount(
  expenseId: string,
  approvedAmount: string,
  adminUserId: string,
): Promise<void> {
  const response = await fetch(
    `/api/expenses/${expenseId}/approved-amount`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        approved_amount: Number(approvedAmount),
        changed_by_user_id: adminUserId,
      }),
    },
  );

  const body = await response.json();

  if (!response.ok) {
    throw new Error(
      body.error ?? "Could not update approved amount",
    );
  }
}

export async function updateApprovedMileage(
  mileageId: string,
  approvedMiles: string,
  adminUserId: string,
): Promise<void> {
  const response = await fetch(
    `/api/mileage/${mileageId}/approved-miles`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        approved_miles: Number(approvedMiles),
        changed_by_user_id: adminUserId,
      }),
    },
  );

  const body = await response.json();

  if (!response.ok) {
    throw new Error(
      body.error ?? "Could not update approved mileage",
    );
  }
}

export async function reviewReimbursement(
  reimbursementId: string,
  adminUserId: string,
): Promise<void> {
  const response = await fetch(
    `/api/reimbursements/${reimbursementId}/review`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        reviewed_by_user_id: adminUserId,
      }),
    },
  );

  const body = await response.json();

  if (!response.ok) {
    throw new Error(
      body.error ?? "Could not mark reimbursement reviewed",
    );
  }
}

export async function payReimbursement(
  reimbursementId: string,
  adminUserId: string,
  checkNumber: string,
): Promise<void> {
  const response = await fetch(
    `/api/reimbursements/${reimbursementId}/pay`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        paid_by_user_id: adminUserId,
        check_number: checkNumber,
      }),
    },
  );

  const body = await response.json();

  if (!response.ok) {
    throw new Error(
      body.error ?? "Could not mark reimbursement paid",
    );
  }
}

export async function uploadCheckStub(
  reimbursementId: string,
  adminUserId: string,
  file: File,
): Promise<void> {
  const formData = new FormData();

  formData.append("uploaded_by_user_id", adminUserId);
  formData.append("purpose", "check_stub");
  formData.append("file", file);

  const response = await fetch(
    `/api/reimbursements/${reimbursementId}/attachments`,
    {
      method: "POST",
      body: formData,
    },
  );

  const body = await response.json();

  if (!response.ok) {
    throw new Error(
      body.error ?? "Could not upload check stub",
    );
  }
}

export type ReimbursementAttachment = {
  id: string;
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
  created_at: string;
  purpose: "ezpass_statement" | "check_stub" | "other";
};

export async function getReimbursementAttachments(
  reimbursementId: string,
  requestingUserId: string,
): Promise<ReimbursementAttachment[]> {
  const response = await fetch(
    `/api/reimbursements/${reimbursementId}/attachments?requesting_user_id=${encodeURIComponent(
      requestingUserId,
    )}`,
  );

  const body = await response.json();

  if (!response.ok) {
    throw new Error(
      body.error ?? "Could not load reimbursement attachments",
    );
  }

  return body;
}
