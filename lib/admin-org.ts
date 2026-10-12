import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { authUser, isAdminUser, serviceClient } from "@/lib/api-auth";
import { defaultOrgId } from "@/lib/org";

// Cookie carrying a super admin's org-picker choice ("Viewing: <org>").
// Scoped admins (users.admin_org_id set) ignore it — they always see their
// own org.
export const VIEWING_ORG_COOKIE = "admin_org";

export type AdminContext = {
  userId: string;
  orgId: string; // viewing org, validated against the admin's scope
  isSuper: boolean; // admin_org_id is null → may pick any org
};

async function rowFor(svc: ReturnType<typeof serviceClient>, userId: string) {
  const { data } = await svc
    .from("users")
    .select("role, admin_org_id, active_org_id")
    .eq("id", userId)
    .maybeSingle();
  return data as { role: string | null; admin_org_id: string | null; active_org_id: string | null } | null;
}

// Viewing org for an already-fetched admin row: scoped admins are pinned to
// admin_org_id; super admins follow the cookie when it points at a real org,
// falling back to their active org, then the default org.
export async function resolveViewingOrg(
  svc: ReturnType<typeof serviceClient>,
  admin: { isSuper: boolean; adminOrgId: string | null; activeOrgId: string | null }
): Promise<string> {
  if (!admin.isSuper && admin.adminOrgId) return admin.adminOrgId;
  const jar = cookies();
  const cookieOrg = jar.get(VIEWING_ORG_COOKIE)?.value || "";
  if (cookieOrg) {
    const { data } = await svc.from("organizations").select("id").eq("id", cookieOrg).maybeSingle();
    if (data) return cookieOrg;
  }
  if (admin.activeOrgId) return admin.activeOrgId;
  return defaultOrgId(svc);
}

// Shared guard for /api/admin/* routes. Returns { ok, ctx } or a ready
// NextResponse denial (401 unauthenticated, 403 not an admin).
export async function adminContext(
  request: Request
): Promise<{ ok: true; ctx: AdminContext } | { ok: false; denied: NextResponse }> {
  const user = await authUser(request);
  if (!user)
    return { ok: false, denied: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  if (!(await isAdminUser(user.id)))
    return { ok: false, denied: NextResponse.json({ error: "Admin access required" }, { status: 403 }) };

  const svc = serviceClient();
  const row = await rowFor(svc, user.id);
  const isSuper = row?.admin_org_id == null;
  const orgId = await resolveViewingOrg(svc, {
    isSuper,
    adminOrgId: row?.admin_org_id ?? null,
    activeOrgId: row?.active_org_id ?? null,
  });
  return { ok: true, ctx: { userId: user.id, orgId, isSuper } };
}

// Ids of users who belong to an org — the member scope for every admin query.
export async function orgMemberIds(
  svc: ReturnType<typeof serviceClient>,
  orgId: string
): Promise<string[]> {
  const { data } = await svc.from("user_orgs").select("user_id").eq("org_id", orgId);
  return (data || []).map((r: { user_id: string }) => r.user_id);
}
