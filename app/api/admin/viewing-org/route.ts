import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { VIEWING_ORG_COOKIE, adminContext } from "@/lib/admin-org";
import { serviceClient } from "@/lib/api-auth";

// POST /api/admin/viewing-org — switch which org the admin console views.
// Super admins pick any org via the admin_org cookie; scoped admins are
// pinned to their own org and cannot switch. { org_id: null } clears the
// pick so the console falls back to the admin's active org.
export async function POST(request: Request) {
  const ac = await adminContext(request);
  if (!ac.ok) return ac.denied;
  if (!ac.ctx.isSuper)
    return NextResponse.json({ error: "Scoped admins always view their own org" }, { status: 403 });
  try {
    const body = await request.json().catch(() => ({}));
    const orgId = body?.org_id == null ? null : String(body.org_id);
    const jar = cookies();
    if (!orgId) {
      jar.delete(VIEWING_ORG_COOKIE);
      return NextResponse.json({ ok: true, org_id: null });
    }
    const svc = serviceClient();
    const { data } = await svc.from("organizations").select("id").eq("id", orgId).maybeSingle();
    if (!data) return NextResponse.json({ error: "Org not found" }, { status: 404 });
    jar.set(VIEWING_ORG_COOKIE, orgId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return NextResponse.json({ ok: true, org_id: orgId });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "org switch failed" }, { status: 500 });
  }
}
