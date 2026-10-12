import { NextResponse } from "next/server";
import { adminContext } from "@/lib/admin-org";
import { serviceClient } from "@/lib/api-auth";

// GET /api/admin/submissions — verified submissions inside the viewing org,
// newest first. Read-only console data (service role bypasses the
// owner-only submissions RLS policy).
export async function GET(request: Request) {
  const ac = await adminContext(request);
  if (!ac.ok) return ac.denied;
  try {
    const svc = serviceClient();
    const { data, error } = await svc
      .from("submissions")
      .select(
        "id, user_id, stage_number, todo_app_url, task_repo_url, values, verified_at, users(full_name, auth_email, workspace_email)"
      )
      .eq("org_id", ac.ctx.orgId)
      .order("verified_at", { ascending: false })
      .limit(500);
    if (error) throw error;
    return NextResponse.json({ items: data || [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "submissions fetch failed" }, { status: 500 });
  }
}
