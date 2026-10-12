export function normalizeEmail(s: string) {
  return s.trim().toLowerCase();
}

export function normalizeZeduId(s: string) {
  return s.trim().toLowerCase();
}

export function normalizeTelegram(s: string) {
  // Display name mode: free text as shown on the Telegram profile
  // (e.g. "A Data Scientist"). Collapse extra whitespace, keep case/spaces.
  return s.replace(/\s+/g, " ").trim().replace(/^@+/, "");
}

export function isValidTelegram(h: string) {
  const t = h.trim();
  return t.length >= 2 && t.length <= 100;
}

// Human-friendly error for display names.
export function telegramError(raw: string): string | null {
  const h = normalizeTelegram(raw);
  if (!h) return "Please enter your Telegram display name as shown on your profile (e.g. A Data Scientist).";
  if (h.length < 2)
    return "That display name looks too short. Enter your full Telegram display name as shown on your profile.";
  if (h.length > 100)
    return "That display name is longer than 100 characters. Enter a shorter form of your Telegram display name.";
  return null;
}

export function isHttpsUrl(u: string) {
  try {
    const x = new URL(u);
    return x.protocol === "https:";
  } catch {
    return false;
  }
}

export function isBlockedHost(hostname: string) {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (/^(127\.|10\.|192\.168\.)/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h === "::1" || h === "[::1]") return true;
  return false;
}

export function parseGithubRepo(input: string): { owner: string; repo: string } | null {
  const t = input.trim().replace(/\/+$/, "");
  // Accept full URL https://github.com/owner/repo or owner/repo
  let m = t.match(/^https?:\/\/(www\.)?github\.com\/([^/\s]+)\/([^/\s]+?)(\.git)?$/i);
  if (m) return { owner: m[2], repo: m[3].replace(/\.git$/, "") };
  m = t.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (m && !m[1].includes(":") && !m[1].includes(".")) return { owner: m[1], repo: m[2].replace(/\.git$/, "") };
  return null;
}

/** Parse a GitHub PR reference. Accepts full URL (…/owner/repo/pull/N) or
 *  short form (owner/repo#N). Anything else (including issue links) → null. */
export function parseGithubPr(input: string): { owner: string; repo: string; number: number } | null {
  const t = input.trim().replace(/\/+$/, "").replace(/\/(files|commits|checks)$/i, "");
  let m = t.match(/^https?:\/\/(www\.)?github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)$/i);
  if (m) return { owner: m[2], repo: m[3], number: Number(m[4]) };
  m = t.match(/^([^/\s]+)\/([^/\s]+)#(\d+)$/);
  if (m && !m[1].includes(":") && !m[1].includes(".")) return { owner: m[1], repo: m[2], number: Number(m[3]) };
  return null;
}

/** Accept a shared Google Drive file/folder link. Returns the canonical
 *  drive host or null when the input is not a Drive link at all. */
export function parseDriveUrl(input: string): string | null {
  let host = "";
  try {
    host = new URL(input.trim()).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host === "drive.google.com" || host === "docs.google.com") return host;
  return null;
}

export function sanitizeText(s: string, max = 255) {
  return s.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, max);
}

// Profile fields a user may request changes to. Identity fields (emails,
// zedu_id) and sub_team (assigned by admins in /admin) are deliberately
// excluded — those go through the lead, not a change request.
export const CHANGEABLE_FIELDS = [
  "full_name",
  "github_url",
  "telegram_handle",
  "skill_rating",
] as const;
export type ChangeableField = (typeof CHANGEABLE_FIELDS)[number];

export function isChangeableField(f: string): f is ChangeableField {
  return (CHANGEABLE_FIELDS as readonly string[]).includes(f);
}

// Column on public.users each changeable field maps to. Shared by the
// change-request POST (snapshot) and the admin approve route (apply).
export const CHANGE_FIELD_COLUMN: Record<ChangeableField, string> = {
  full_name: "full_name",
  github_url: "github_url",
  telegram_handle: "telegram_handle",
  skill_rating: "skill_rating",
};

// Allowed per-task submission field types (mirrors the checkout validator).
export const SUBMISSION_FIELD_TYPES = [
  "live_url",
  "github_repo",
  "drive_url",
  "github_pr",
  "text",
] as const;
export type SubmissionFieldType = (typeof SUBMISSION_FIELD_TYPES)[number];

/** Validate an admin-supplied submission_schema (JSON array of field defs).
 *  Returns an error string or null (valid). */
export function submissionSchemaError(schema: unknown): string | null {
  if (!Array.isArray(schema)) return "submission_schema must be a JSON array";
  if (schema.length > 20) return "submission_schema supports up to 20 fields";
  const seen = new Set<string>();
  for (const f of schema) {
    const def = (f ?? {}) as Record<string, unknown>;
    const key = typeof def.key === "string" ? def.key.trim() : "";
    if (!/^[a-z0-9_]{1,40}$/.test(key))
      return "Each field needs a snake_case key (letters, numbers, underscores)";
    if (seen.has(key)) return `Duplicate field key "${key}"`;
    seen.add(key);
    const label = typeof def.label === "string" ? def.label.trim() : "";
    if (!label || label.length > 120)
      return `Field "${key}" needs a label (max 120 characters)`;
    if (!(SUBMISSION_FIELD_TYPES as readonly string[]).includes(String(def.type)))
      return `Field "${key}" has unknown type "${String(def.type)}" (use one of: ${SUBMISSION_FIELD_TYPES.join(", ")})`;
    if (def.hint != null && (typeof def.hint !== "string" || def.hint.trim().length > 200))
      return `Field "${key}" hint must be a string of at most 200 characters`;
    if (def.required != null && typeof def.required !== "boolean")
      return `Field "${key}" required must be true or false`;
  }
  return null;
}

/** Validate a proposed new value for a changeable profile field.
 *  Returns an error string or null (valid). */
export function changeValueError(field: ChangeableField, raw: string): string | null {
  const v = raw.trim();
  if (!v) return "New value is required";
  switch (field) {
    case "full_name": {
      const s = sanitizeText(v);
      if (s.length < 2) return "Full name looks too short";
      return null;
    }
    case "github_url": {
      try {
        const u = new URL(v);
        if (u.protocol !== "https:" || u.hostname !== "github.com") throw new Error();
      } catch {
        return "GitHub URL must be https://github.com/username";
      }
      return null;
    }
    case "telegram_handle":
      return telegramError(v);
    case "skill_rating":
      return ["1", "2", "3", "4", "5"].includes(v) ? null : "Skill rating must be 1-5";
  }
}

export function generateOrderNumber() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let suffix = "";
  for (let i = 0; i < 4; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
  return `ZE-2026-${suffix}`;
}

// Onboarding only ever exposes abcd***@domain — the first four characters of
// the local part plus the domain. The raw address never leaves the server.
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return email;
  return `${email.slice(0, Math.min(4, at))}***${email.slice(at)}`;
}

// True when the value is a mask produced by maskEmail rather than a full email.
export function isMaskedEmail(s: string): boolean {
  return /^[^@*]+\*{3}@/.test(s.trim());
}

// Build a LIKE pattern for a masked email, escaping LIKE wildcards so a
// crafted prefix/domain can't widen the match. Returns null for non-masks.
export function maskedEmailLike(masked: string): string | null {
  const t = masked.trim().toLowerCase();
  if (!isMaskedEmail(t)) return null;
  const [prefix, rest] = t.split("***");
  const domain = rest.replace(/^@+/, "").replace(/[*%_\\]/g, "");
  const head = prefix.replace(/[*%_\\]/g, "");
  if (!head || !domain || domain.includes("@")) return null;
  return `${head}%@${domain}`;
}
