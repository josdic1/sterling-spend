const DEMO_LABEL_BY_KEY: Record<string, string> = {
  greg: "Greg · Waitstaff",
  jesse: "Jesse · Waitstaff",
  kelly: "Kelly · Manager",
  maya: "Maya · Kitchen",
};

function normalizeKey(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .replace(/^DEMO\s*[—-]\s*/i, "")
    .toLowerCase();
}

export function personDisplayName(args: {
  name?: string | null;
  email?: string | null;
  username?: string | null;
  role?: "user" | "admin" | string | null;
}) {
  const cleanName = String(args.name ?? "")
    .trim()
    .replace(/^DEMO\s*[—-]\s*/i, "")
    .trim();

  const usernameKey = normalizeKey(args.username).replace(/^demo\s+/, "");
  const emailKey = normalizeKey(args.email).split("@")[0] ?? "";
  const nameKey = normalizeKey(cleanName).split(/\s+/)[0] ?? "";

  for (const key of [usernameKey, emailKey, nameKey]) {
    if (DEMO_LABEL_BY_KEY[key]) return DEMO_LABEL_BY_KEY[key];
  }

  if (args.role === "admin" && nameKey === "jill") {
    return "Jill · Admin";
  }

  return cleanName || args.username || args.email || "Employee";
}
