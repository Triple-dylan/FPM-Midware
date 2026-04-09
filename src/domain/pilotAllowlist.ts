import { readFileSync } from "node:fs";

/** Cohort = who this Aryeo GROUP is connected to (owner/users/team memberships), not fuzzy text on the client record. */
export type PilotCohortConfig = {
  id: string;
  teamTag: string;
  /** Exact Aryeo customer GROUP `id` (UUID) — use for one-off includes from the Aryeo UI. */
  matchAryeoCustomerIds?: string[];
  /** Any `customer_team_memberships[].customer_team.id` for active/invited memberships. */
  matchCustomerTeamIds?: string[];
  /**
   * Exact email on `owner`, `users[]`, `team_members`, or `customer_team_memberships[].customer_user`.
   * Does **not** match the client’s `group.email` alone.
   */
  matchUserEmails?: string[];
  /**
   * Domain match on those same connection emails only (e.g. `@thejamiemcmartingroup.com` or `thejamiemcmartingroup.com`).
   */
  matchEmailDomains?: string[];
  /**
   * Legacy: substring / token match on {@link buildAryeoTeamAgentHaystack} when no structured rule is configured,
   * or as an extra OR branch when structured rules are also present.
   */
  needles?: string[];
};

export type PilotAllowlistFile = {
  version: number;
  description?: string;
  /** If true, only customers matching a cohort are processed; everyone else is skipped. */
  exclusive: boolean;
  /** Applied to every synced GHL contact (e.g. rollout marker). */
  globalTags: string[];
  cohorts: PilotCohortConfig[];
  allowUnsafeNeedles?: boolean;
};

function cohortHasAnyMatcher(c: PilotCohortConfig): boolean {
  const n = (a: string[] | undefined) => (a?.length ?? 0) > 0;
  return (
    n(c.matchAryeoCustomerIds) ||
    n(c.matchCustomerTeamIds) ||
    n(c.matchUserEmails) ||
    n(c.matchEmailDomains) ||
    n(c.needles)
  );
}

export function loadPilotAllowlist(path: string): PilotAllowlistFile {
  const raw = readFileSync(path, "utf8");
  const j = JSON.parse(raw) as PilotAllowlistFile;
  if (!j || typeof j !== "object" || !Array.isArray(j.cohorts)) {
    throw new Error("pilot allowlist: invalid JSON (need cohorts[])");
  }
  if (j.exclusive !== true) {
    throw new Error("pilot allowlist: exclusive must be true for guarded pilot runs");
  }
  for (const c of j.cohorts) {
    if (!c.id?.trim() || !c.teamTag?.trim()) {
      throw new Error(`pilot allowlist: invalid cohort ${JSON.stringify(c.id)}`);
    }
    if (!cohortHasAnyMatcher(c)) {
      throw new Error(
        `pilot allowlist: cohort ${JSON.stringify(c.id)} needs at least one of matchAryeoCustomerIds, matchCustomerTeamIds, matchUserEmails, matchEmailDomains, needles`,
      );
    }
  }
  if (!Array.isArray(j.globalTags)) j.globalTags = [];
  return j;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function str(x: unknown): string | null {
  return typeof x === "string" ? x : null;
}

function normId(x: string): string {
  return x.trim().toLowerCase();
}

function normEmail(e: string): string {
  return e.trim().toLowerCase();
}

/** Normalize domain entry to host part for comparison (e.g. `@x.com` / `x.com` → `x.com`). */
function normalizeDomainEntry(raw: string): string {
  const t = raw.trim().toLowerCase();
  return t.startsWith("@") ? t.slice(1) : t;
}

function emailDomainHost(email: string): string | null {
  const i = email.lastIndexOf("@");
  if (i < 0 || i === email.length - 1) return null;
  return email.slice(i + 1).trim().toLowerCase() || null;
}

function emailMatchesAnyDomain(email: string, domains: string[]): boolean {
  const host = emailDomainHost(normEmail(email));
  if (!host) return false;
  const want = domains.map(normalizeDomainEntry).filter(Boolean);
  return want.some((d) => host === d || host.endsWith(`.${d}`));
}

const MEMBERSHIP_OK = new Set(["active", "invited"]);

/** Emails from owner, users, team_members, customer_team_memberships (not `group.email`). */
export function collectConnectionEmailsFromAryeoGroup(group: unknown): Set<string> {
  const out = new Set<string>();
  if (!isRecord(group)) return out;
  const push = (e: string | null | undefined) => {
    const t = e?.trim();
    if (t) out.add(normEmail(t));
  };
  const o = group.owner;
  if (isRecord(o)) push(str(o.email));
  const users = group.users;
  if (Array.isArray(users)) {
    for (const u of users) {
      if (isRecord(u)) push(str(u.email));
    }
  }
  const tm = group.team_members;
  if (Array.isArray(tm)) {
    for (const m of tm) {
      if (isRecord(m)) push(str(m.email));
    }
  }
  const ctms = group.customer_team_memberships;
  if (Array.isArray(ctms)) {
    for (const row of ctms) {
      if (!isRecord(row)) continue;
      const st = str(row.status);
      if (st && !MEMBERSHIP_OK.has(st)) continue;
      const cu = row.customer_user;
      if (isRecord(cu)) push(str(cu.email));
    }
  }
  return out;
}

/** Active/invited membership `customer_team.id` values. */
export function collectActiveCustomerTeamIdsFromGroup(group: unknown): Set<string> {
  const out = new Set<string>();
  if (!isRecord(group)) return out;
  const ctms = group.customer_team_memberships;
  if (!Array.isArray(ctms)) return out;
  for (const row of ctms) {
    if (!isRecord(row)) continue;
    const st = str(row.status);
    if (st && !MEMBERSHIP_OK.has(st)) continue;
    const ct = row.customer_team;
    if (isRecord(ct)) {
      const id = str(ct.id);
      if (id?.trim()) out.add(normId(id));
    }
  }
  return out;
}

/** Shallow strings from Aryeo `customer_user` (avoid deep walk — nested memberships repeat). */
function pushCustomerUserIdentityStrings(u: Record<string, unknown>, out: string[]): void {
  const keys = [
    "full_name",
    "first_name",
    "last_name",
    "name",
    "email",
    "phone",
    "phone_number",
    "agent_company_name",
    "agent_license_number",
    "license_number",
  ] as const;
  for (const k of keys) {
    const v = str(u[k]);
    if (v?.trim()) out.push(v.trim());
  }
}

/** Team label fields only (not full nested billing_customer / order_forms). */
function pushCustomerTeamLabelStrings(team: Record<string, unknown>, out: string[]): void {
  for (const k of ["name", "description", "brokerage_name", "brokerage_website", "affiliate_id"] as const) {
    const v = str(team[k]);
    if (v?.trim()) out.push(v.trim());
  }
}

function collectCustomerTeamMembershipHaystackParts(group: Record<string, unknown>, out: string[]): void {
  const ctms = group.customer_team_memberships;
  if (!Array.isArray(ctms)) return;
  for (const raw of ctms) {
    if (!isRecord(raw)) continue;
    const role = str(raw.role);
    if (role?.trim()) out.push(role.trim());
    const st = str(raw.status);
    if (st?.trim()) out.push(st.trim());
    const cu = raw.customer_user;
    if (isRecord(cu)) pushCustomerUserIdentityStrings(cu, out);
    const ct = raw.customer_team;
    if (isRecord(ct)) pushCustomerTeamLabelStrings(ct, out);
  }
}

/**
 * Human-readable line for pilot CSV: Aryeo `customer_team_memberships[].customer_user` is the
 * per-membership agent (closest to “sales rep” in the API). Omits when not present.
 */
export function summarizeAryeoCustomerTeamMemberships(group: unknown): string {
  if (!isRecord(group)) return "";
  const ctms = group.customer_team_memberships;
  if (!Array.isArray(ctms) || ctms.length === 0) return "";
  const lines: string[] = [];
  for (const raw of ctms) {
    if (!isRecord(raw)) continue;
    const role = str(raw.role);
    const status = str(raw.status);
    const cu = isRecord(raw.customer_user) ? raw.customer_user : null;
    const repName =
      cu &&
      (str(cu.full_name) ||
        `${str(cu.first_name) ?? ""} ${str(cu.last_name) ?? ""}`.trim() ||
        str(cu.name));
    const em = cu ? str(cu.email) : null;
    const team = isRecord(raw.customer_team) ? raw.customer_team : null;
    const teamName = team ? str(team.name) : null;
    const brokerage = team ? str(team.brokerage_name) : null;
    const bits: string[] = [];
    if (role) bits.push(`role=${role}`);
    if (status) bits.push(`status=${status}`);
    if (teamName) bits.push(`team=${teamName}`);
    if (brokerage) bits.push(`brokerage=${brokerage}`);
    if (repName || em) {
      bits.push(repName ? `${repName}${em ? ` (${em})` : ""}` : `(${em})`);
    }
    if (bits.length) lines.push(bits.join(" "));
  }
  return lines.join(" | ");
}

/** True if GROUP has any connection fields we can evaluate without a full GET (for CSV fast-path). */
export function groupHasConnectionSignalsForPreFilter(group: unknown): boolean {
  if (!isRecord(group)) return false;
  if (isRecord(group.owner) && str(group.owner.email)?.trim()) return true;
  const users = group.users;
  if (Array.isArray(users) && users.some((u) => isRecord(u) && str(u.email)?.trim())) return true;
  const ctms = group.customer_team_memberships;
  if (
    Array.isArray(ctms) &&
    ctms.some((row) => {
      if (!isRecord(row)) return false;
      const cu = row.customer_user;
      return isRecord(cu) && str(cu.email)?.trim();
    })
  ) {
    return true;
  }
  return false;
}

/** Lowercase, strip HTML, keep letters/digits as tokens (handles "McMartin, Jamie" vs "Jamie McMartin"). */
export function normalizeMatchText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function collectStringsDeep(obj: unknown, out: string[], depth: number): void {
  if (depth > 14) return;
  if (obj == null) return;
  if (typeof obj === "string") {
    const t = obj.replace(/<[^>]+>/g, " ").trim();
    if (t) out.push(t);
    return;
  }
  if (typeof obj === "number" || typeof obj === "boolean") {
    out.push(String(obj));
    return;
  }
  if (Array.isArray(obj)) {
    for (const x of obj) collectStringsDeep(x, out, depth + 1);
    return;
  }
  if (typeof obj === "object") {
    for (const v of Object.values(obj as Record<string, unknown>)) {
      collectStringsDeep(v, out, depth + 1);
    }
  }
}

/**
 * Single normalized string of **all** text Aryeo exposes on the customer GROUP (recursive).
 * For debugging / inspection only.
 */
export function buildAryeoCustomerHaystack(group: unknown): string {
  const parts: string[] = [];
  collectStringsDeep(group, parts, 0);
  return normalizeMatchText(parts.join(" "));
}

/**
 * Normalized text from **vendor team / agents** only: `owner`, `users`, `team_members`, and
 * `customer_team_memberships` (each membership’s `customer_user` + team labels).
 */
export function buildAryeoTeamAgentHaystack(group: unknown): string {
  const parts: string[] = [];
  if (!isRecord(group)) return "";
  if (group.owner) collectStringsDeep(group.owner, parts, 0);
  if (Array.isArray(group.users)) {
    for (const u of group.users) collectStringsDeep(u, parts, 0);
  }
  if (Array.isArray(group.team_members)) {
    for (const m of group.team_members) collectStringsDeep(m, parts, 0);
  }
  collectCustomerTeamMembershipHaystackParts(group, parts);
  return normalizeMatchText(parts.join(" "));
}

/**
 * Multi-word needles: **every** word (length ≥2) must appear in the haystack (order-free).
 * Single word: substring match.
 */
export function needleMatchesHaystackNormalized(
  needleRaw: string,
  haystackNormalized: string,
): boolean {
  const n = normalizeMatchText(needleRaw);
  if (!n) return false;
  const tokens = n.split(/\s+/).filter((t) => t.length >= 2);
  if (tokens.length === 0) return false;
  if (tokens.length === 1) return haystackNormalized.includes(tokens[0]);
  return tokens.every((t) => haystackNormalized.includes(t));
}

function cohortMatchesNeedles(group: unknown, needles: string[] | undefined): boolean {
  if (!needles?.length) return false;
  const hay = buildAryeoTeamAgentHaystack(group);
  for (const n of needles) {
    if (needleMatchesHaystackNormalized(n, hay)) return true;
  }
  return false;
}

/**
 * Whether this cohort’s **structured** rules match (ignores `needles`).
 * Uses OR across rule types: any configured structured rule that matches wins.
 */
export function cohortMatchesStructuredAryeoGroup(group: unknown, c: PilotCohortConfig): boolean {
  if (!isRecord(group)) return false;

  if (c.matchAryeoCustomerIds?.length) {
    const gid = str(group.id);
    const want = new Set(c.matchAryeoCustomerIds.map(normId).filter(Boolean));
    if (gid && want.has(normId(gid))) return true;
  }

  if (c.matchCustomerTeamIds?.length) {
    const have = collectActiveCustomerTeamIdsFromGroup(group);
    const want = new Set(c.matchCustomerTeamIds.map(normId).filter(Boolean));
    for (const id of have) {
      if (want.has(id)) return true;
    }
  }

  const emails = collectConnectionEmailsFromAryeoGroup(group);

  if (c.matchUserEmails?.length) {
    const want = new Set(c.matchUserEmails.map(normEmail).filter(Boolean));
    for (const e of emails) {
      if (want.has(e)) return true;
    }
  }

  if (c.matchEmailDomains?.length && emails.size > 0) {
    for (const e of emails) {
      if (emailMatchesAnyDomain(e, c.matchEmailDomains)) return true;
    }
  }

  return false;
}

/**
 * Cohort matches if **any** structured rule matches **or** (when needles present) legacy needle match.
 * Structured rules do not use client `name` / `group.email` / notes — only connections above.
 */
export function cohortMatchesAryeoGroup(group: unknown, c: PilotCohortConfig): boolean {
  if (cohortMatchesStructuredAryeoGroup(group, c)) return true;
  return cohortMatchesNeedles(group, c.needles);
}

/**
 * First cohort in file order that matches {@link cohortMatchesAryeoGroup}.
 * Pass the raw `GET /customers/{id}` GROUP payload (or list row with the same nested fields when present).
 */
export function pickPilotCohortFromGroup(
  group: unknown,
  cohorts: PilotCohortConfig[],
): PilotCohortConfig | null {
  for (const c of cohorts) {
    if (cohortMatchesAryeoGroup(group, c)) return c;
  }
  return null;
}

/**
 * @deprecated Prefer {@link pickPilotCohortFromGroup} with the Aryeo GROUP object.
 * Haystack-only matching (tests / legacy).
 */
export function pickPilotCohort(
  haystack: string,
  cohorts: PilotCohortConfig[],
): PilotCohortConfig | null {
  const h = haystack.trim() ? haystack : "";
  for (const c of cohorts) {
    if (!c.needles?.length) continue;
    for (const n of c.needles) {
      if (needleMatchesHaystackNormalized(n, h)) {
        return c;
      }
    }
  }
  return null;
}
