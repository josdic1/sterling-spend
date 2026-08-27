export type AuthUser = {
  id: string;
  name: string;
  email: string;
  username: string | null;
  role: "user" | "admin";
  is_active: boolean;
};

export async function login(
  username: string,
  password: string,
): Promise<AuthUser> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error ?? "Could not sign in");
  }

  return body;
}

export async function getCurrentUser(): Promise<AuthUser> {
  const response = await fetch("/api/auth/me");
  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error ?? "Not signed in");
  }

  return body;
}

export async function logout(): Promise<void> {
  const response = await fetch("/api/auth/logout", { method: "POST" });

  if (!response.ok && response.status !== 204) {
    const body = await response.json();
    throw new Error(body.error ?? "Could not sign out");
  }
}

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
  event_session_id: string | null;
  trip_date: string;
  source: string;
  claimed_miles: string;
  approved_miles: string;
  rate_per_mile: string;
  planned_tolls_amount: string | null;
  event_id: string;
  event_number: string;
  event_name: string;
};

export type ReimbursementIssueResolution = {
  resolved: boolean;
  resolution_reason: string | null;
  resolved_by_name: string | null;
  resolved_at: string | null;
};

export type ReimbursementKnownIssue =
  | ({
      issue_key: string;
      type: "toll_mismatch";
      event_id: string;
      event_name: string;
      planned_amount: number;
      evidence_amount: number;
      difference: number;
    } & ReimbursementIssueResolution)
  | ({
      issue_key: string;
      type: "possible_duplicate";
      event_id: string | null;
      event_name: string | null;
      vendor: string;
      expense_date: string;
      claimed_amount: number;
      count: number;
      expense_ids: string[];
    } & ReimbursementIssueResolution);

export type ReimbursementSubmissionBlocker =
  | {
      type: "active_event";
      event_id: string;
      event_name: string;
    }
  | {
      type: "unassigned_expense";
      expense_id: string;
      vendor: string | null;
      claimed_amount: number;
    };

export type ReimbursementAnalysis = {
  issue_count: number;
  unresolved_issue_count: number;
  known_issues: ReimbursementKnownIssue[];
  blocker_count: number;
  submission_blockers: ReimbursementSubmissionBlocker[];
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
  analysis: ReimbursementAnalysis;
};

export type ActiveEvent = {
  session_id: string;
  started_at: string;
  planned_miles: string | null;
  planned_tolls_amount: string | null;
  planned_mileage_amount: string | null;
  rate_per_mile: string | null;
  travel_calculated_at: string | null;
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
  event_id?: string;
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

type AutomaticMileageEvent = {
  id: string;
  event_number: string;
  name: string;
  event_date: string;
  venue_name: string | null;
  venue_address: string;
};

export type AutomaticMileageQuote =
  | {
      already_saved: true;
      event: AutomaticMileageEvent;
      travel: {
        session_id: string;
        planned_miles: number;
        planned_tolls_amount: number | null;
        rate_per_mile: number;
        planned_mileage_amount: number;
      };
    }
  | {
      already_saved: false;
      event: AutomaticMileageEvent;
      route: {
        origin: string;
        destination: string;
        outbound_miles: number;
        return_miles: number;
        round_trip_miles: number;
      };
      tolls: {
        has_tolls: boolean;
        estimated_round_trip_amount: number | null;
        currency_code: string | null;
        outbound: {
          has_tolls: boolean;
          estimated_amount: number | null;
        };
        return: {
          has_tolls: boolean;
          estimated_amount: number | null;
        };
      };
      mileage_rate: {
        id: string;
        rate_per_mile: number;
      };
      reimbursement_amount: number;
    };

export async function getAutomaticMileageQuote(
  userId: string,
): Promise<AutomaticMileageQuote> {
  const response = await fetch(
    "/api/mileage/automatic-quote",
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
    throw new Error(
      body.error ?? "Could not calculate mileage",
    );
  }

  return body;
}

export async function saveAutomaticTravel(input: {
  user_id: string;
  event_id: string;
  trip_date: string;
  planned_miles: number;
  planned_tolls_amount: number | null;
}): Promise<{
  travel: {
    session_id: string;
    planned_miles: string;
    planned_tolls_amount: string | null;
    planned_mileage_amount: string;
    travel_calculated_at: string;
    rate_per_mile: number;
  };
  mileage_entry_id: string | null;
  reimbursement_linked: boolean;
}> {
  const response = await fetch("/api/mileage/automatic-travel", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  const body = await response.json();

  if (!response.ok) {
    throw new Error(
      body.error ?? "Could not save automatic travel",
    );
  }

  return body;
}

export async function ensureAutomaticTravel(
  userId: string,
): Promise<boolean> {
  const quote = await getAutomaticMileageQuote(userId);

  if (quote.already_saved) {
    return false;
  }

  await saveAutomaticTravel({
    user_id: userId,
    event_id: quote.event.id,
    trip_date: quote.event.event_date.slice(0, 10),
    planned_miles: quote.route.round_trip_miles,
    planned_tolls_amount: quote.tolls.has_tolls
      ? quote.tolls.estimated_round_trip_amount
      : 0,
  });

  return true;
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
  acknowledgeKnownIssues: boolean,
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
        acknowledge_known_issues: acknowledgeKnownIssues,
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

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  username: string | null;
  role: "user" | "admin";
  is_active: boolean;
  created_at: string;
};

export async function getAdminUsers(
  adminUserId: string,
): Promise<AdminUser[]> {
  const response = await fetch(
    `/api/users/admin?requesting_user_id=${encodeURIComponent(
      adminUserId,
    )}`,
  );

  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error ?? "Could not load users");
  }

  return body;
}

export async function createAdminUser(
  adminUserId: string,
  input: {
    name: string;
    email: string;
    username: string;
    password: string;
  },
): Promise<AdminUser> {
  const response = await fetch("/api/users/admin", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      requesting_user_id: adminUserId,
      name: input.name,
      email: input.email,
      username: input.username,
      password: input.password,
    }),
  });

  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error ?? "Could not add employee");
  }

  return body;
}

export async function updateAdminUser(
  adminUserId: string,
  userId: string,
  input: {
    name: string;
    email: string;
    username: string;
    password?: string;
  },
): Promise<AdminUser> {
  const response = await fetch(`/api/users/${userId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requesting_user_id: adminUserId,
      name: input.name,
      email: input.email,
      username: input.username,
      ...(input.password ? { password: input.password } : {}),
    }),
  });

  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error ?? "Could not update employee");
  }

  return body;
}

export async function setAdminUserActive(
  adminUserId: string,
  userId: string,
  isActive: boolean,
): Promise<AdminUser> {
  const response = await fetch(
    `/api/users/${userId}/active`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requesting_user_id: adminUserId,
        is_active: isActive,
      }),
    },
  );

  const body = await response.json();

  if (!response.ok) {
    throw new Error(
      body.error ?? "Could not update employee status",
    );
  }

  return body;
}

export type AdminEvent = {
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
  status: string | null;
  assigned_user_ids: string[];
};

export type AdminEventInput = {
  event_number: string;
  name: string;
  event_date: string;
  client_name: string | null;
  venue_name: string | null;
  venue_address: string | null;
  start_time: string | null;
  end_time: string | null;
  assigned_user_ids: string[];
};

export async function getAdminEvents(
  adminUserId: string,
): Promise<AdminEvent[]> {
  const response = await fetch(
    `/api/events/admin?requesting_user_id=${encodeURIComponent(adminUserId)}`,
  );
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? "Could not load events");
  }
  return body;
}

export async function createAdminEvent(
  adminUserId: string,
  input: AdminEventInput,
): Promise<AdminEvent> {
  const response = await fetch("/api/events/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requesting_user_id: adminUserId, ...input }),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? "Could not create event");
  }
  return body;
}

export async function updateAdminEvent(
  adminUserId: string,
  eventId: string,
  input: AdminEventInput,
): Promise<AdminEvent> {
  const response = await fetch(`/api/events/admin/${eventId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requesting_user_id: adminUserId, ...input }),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? "Could not update event");
  }
  return body;
}


export type AdminEventDetailAttachment = {
  id: string;
  file_name: string;
  mime_type: string;
  file_size_bytes: string;
  created_at: string;
  expense_id: string;
  employee_id: string;
  employee_name: string;
  vendor: string | null;
  category_name: string;
};

export type AdminEventDetailExpense = {
  id: string;
  expense_date: string;
  vendor: string | null;
  description: string | null;
  claimed_amount: number;
  approved_amount: number;
  created_at: string;
  category_name: string;
  employee_id: string;
  employee_name: string;
  attachments: Array<Omit<AdminEventDetailAttachment, "expense_id" | "employee_id" | "employee_name" | "vendor" | "category_name">>;
};

export type AdminEventDetailMileage = {
  id: string;
  event_session_id: string | null;
  trip_date: string;
  source: "automatic" | "manual";
  claimed_miles: number;
  approved_miles: number;
  rate_per_mile: number;
  claimed_mileage_amount: number;
  approved_mileage_amount: number;
  planned_tolls_amount: number | null;
  employee_id: string;
  employee_name: string;
  created_at: string;
};

export type AdminEventDetailTravelSummary = {
  employee_id: string;
  employee_name: string;
  trip_count: number;
  approved_miles: number;
  mileage_amount: number;
  planned_tolls_amount: number | null;
  toll_evidence_amount: number;
  toll_difference: number | null;
};

export type AdminEventDetailEmployee = {
  id: string;
  name: string;
  email: string;
  role: "user" | "admin";
  is_active: boolean;
  active_now: boolean;
  receipt_count: number;
  toll_count: number;
  mileage_count: number;
  miles: number;
  receipts_total: number;
  tolls_total: number;
  mileage_total: number;
  total: number;
};

export type AdminEventDetailIssue = {
  type: string;
  message: string;
  employee_id?: string;
  employee_name?: string;
  expense_id?: string;
};

export type AdminEventDetail = {
  event: {
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
    status: string | null;
    created_at: string;
    updated_at: string;
  };
  totals: {
    total: number;
    receipts: number;
    mileage: number;
    tolls: number;
    receipt_count: number;
    mileage_count: number;
    toll_count: number;
  };
  employees: AdminEventDetailEmployee[];
  expenses: AdminEventDetailExpense[];
  mileage: AdminEventDetailMileage[];
  travel_by_employee: AdminEventDetailTravelSummary[];
  sessions: Array<{
    id: string;
    employee_id: string;
    employee_name: string;
    started_at: string;
    ended_at: string | null;
    planned_miles: string | null;
    planned_tolls_amount: string | null;
    planned_mileage_amount: string | null;
    travel_calculated_at: string | null;
  }>;
  issues: AdminEventDetailIssue[];
  category_breakdown: Array<{ name: string; amount: number }>;
  activity: Array<{
    type: string;
    occurred_at: string;
    employee_name: string;
    label: string;
    detail: string;
  }>;
  documents: AdminEventDetailAttachment[];
};

export async function getAdminEventDetail(
  adminUserId: string,
  eventId: string,
): Promise<AdminEventDetail> {
  const response = await fetch(
    `/api/events/admin/${eventId}/detail?requesting_user_id=${encodeURIComponent(adminUserId)}`,
  );
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? "Could not load event detail");
  }
  return body;
}

export type AdminAssignedEvent = {
  id: string;
  event_number: string;
  name: string;
  event_date: string;
  venue_name: string | null;
};

export type AdminActivationStatus = {
  user_id: string;
  employee_name: string;
  employee_email: string;
  is_activated: boolean;
  session_id: string | null;
  event_id: string | null;
  event_number: string | null;
  event_name: string | null;
  venue_name: string | null;
  assigned_events: AdminAssignedEvent[];
};

export async function getAdminActivationStatus(
  requestingUserId: string,
): Promise<AdminActivationStatus[]> {
  const response = await fetch(
    `/api/events/admin/activation-status?requesting_user_id=${encodeURIComponent(
      requestingUserId,
    )}`,
  );

  const body = await response.json();

  if (!response.ok) {
    throw new Error(
      body.error ?? "Could not load employee activation status",
    );
  }

  return body;
}

export type AdminTodayExpense = {
  id: string;
  expense_date: string;
  vendor: string | null;
  description: string | null;
  claimed_amount: number;
  category_name: string;
  event_id: string;
  event_number: string;
  event_name: string;
};

export type AdminTodayMileage = {
  id: string;
  event_session_id: string | null;
  trip_date: string;
  claimed_miles: number;
  approved_miles: number;
  planned_tolls_amount: number | null;
  rate_per_mile: number;
  mileage_amount: number;
  toll_evidence_amount: number;
  toll_difference: number | null;
  event_id: string;
  event_number: string;
  event_name: string;
};

export type AdminTodayIssue = {
  type: string;
  event_id?: string;
  event_name?: string;
  message: string;
};

export type AdminTodayDetail = {
  employee: {
    id: string;
    name: string;
    email: string;
    role: "user" | "admin";
    is_active: boolean;
  };
  assigned_events: Array<{
    id: string;
    event_number: string;
    name: string;
    event_date: string;
    venue_name: string | null;
    venue_address: string | null;
    start_time: string | null;
    end_time: string | null;
  }>;
  active_event: null | {
    session_id: string;
    started_at: string;
    planned_miles: string | null;
    planned_tolls_amount: string | null;
    planned_mileage_amount: string | null;
    travel_calculated_at: string | null;
    rate_per_mile: string | null;
    event_id: string;
    event_number: string;
    event_name: string;
    event_date: string;
    venue_name: string | null;
    venue_address: string | null;
  };
  expenses: AdminTodayExpense[];
  mileage: AdminTodayMileage[];
  issues: AdminTodayIssue[];
  totals: {
    expenses: number;
    mileage: number;
    running: number;
  };
};

export async function getAdminTodayDetail(
  adminUserId: string,
  userId: string,
): Promise<AdminTodayDetail> {
  const response = await fetch(
    `/api/events/admin/today/${userId}?requesting_user_id=${encodeURIComponent(adminUserId)}`,
  );

  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error ?? "Could not load Today detail");
  }

  return body;
}

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
  issue_count?: number;
  issue_summaries?: string[];
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
  planned_tolls_amount: string | null;
  event_id: string;
  event_number: string;
  event_name: string;
};

export type AdminAdjustment = {
  id: string;
  entity_type: "expense" | "mileage";
  entity_id: string;
  field_name: "approved_amount" | "approved_miles";
  old_value: string | null;
  new_value: string | null;
  reason: string | null;
  changed_at: string;
  changed_by_name: string;
  item_name: string;
};

export type AdminReimbursementNote = {
  id: string;
  note: string;
  changed_at: string;
  changed_by_name: string;
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
  adjustments: AdminAdjustment[];
  notes: AdminReimbursementNote[];
  analysis: ReimbursementAnalysis;
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
  reason: string,
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
        reason,
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
  reason: string,
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
        reason,
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

export async function resolveReimbursementIssue(
  reimbursementId: string,
  adminUserId: string,
  issueKey: string,
  reason: string,
): Promise<void> {
  const response = await fetch(
    `/api/reimbursements/${reimbursementId}/issues/resolve`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        resolved_by_user_id: adminUserId,
        issue_key: issueKey,
        reason,
      }),
    },
  );

  const body = await response.json();

  if (!response.ok) {
    throw new Error(
      body.error ?? "Could not resolve issue",
    );
  }
}

export async function addReimbursementNote(
  reimbursementId: string,
  adminUserId: string,
  note: string,
): Promise<void> {
  const response = await fetch(
    `/api/reimbursements/${reimbursementId}/notes`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        added_by_user_id: adminUserId,
        note,
      }),
    },
  );

  const body = await response.json();

  if (!response.ok) {
    throw new Error(
      body.error ?? "Could not add review note",
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

export type ReceiptAnalysis = {
  vendor: string | null;
  expense_date: string | null;
  amount: number | null;
  category_id: string | null;
  category_name: string | null;
  confidence: number;
  active_event: {
    id: string;
    event_number: string;
    name: string;
    event_date: string;
  } | null;
};

export async function analyzeReceipt(
  userId: string,
  file: File,
): Promise<ReceiptAnalysis> {
  const formData = new FormData();

  formData.append("user_id", userId);
  formData.append("file", file);

  const response = await fetch(
    "/api/receipt-analysis",
    {
      method: "POST",
      body: formData,
    },
  );

  const body = await response.json();

  if (!response.ok) {
    throw new Error(
      body.error ?? "Could not analyze receipt",
    );
  }

  return body;
}


export type NearbyVendorSuggestion = {
  id: string | null;
  name: string;
  address: string | null;
};

export async function getNearbyVendorSuggestions(input: {
  user_id: string;
  latitude: number;
  longitude: number;
  accuracy_meters?: number | null;
}): Promise<NearbyVendorSuggestion[]> {
  const response = await fetch(
    "/api/receipt-analysis/vendor-suggestions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    },
  );

  const body = await response.json();

  if (!response.ok) {
    throw new Error(
      body.error ?? "Could not suggest nearby vendors",
    );
  }

  return body.suggestions ?? [];
}
