export function normalizeEmail(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

export function buildAdminEmailSet(value: string | null | undefined) {
  return new Set(
    (value || "")
      .split(",")
      .map((item) => normalizeEmail(item))
      .filter(Boolean),
  );
}

export function isAdminEmail(email: string | null | undefined, adminEmails: Set<string>) {
  return adminEmails.has(normalizeEmail(email));
}
