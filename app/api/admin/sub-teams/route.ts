import { NextResponse } from "next/server";
import { adminContext, orgMemberIds } from "@/lib/admin-org";
import { serviceClient } from "@/lib/api-auth";
import { sanitizeText } from "@/lib/validation";

function teamNameError(raw: string): string | null {
  const name = sanitizeText(raw, 100);
  if (!name) return "Team name is required";
  if (name.length > 100) return "Team name must be at most 100 characters";
  return null;
}

// POST /api/admin/sub-teams — create a team in the viewing org, optionally
// assigning members at creation time. member_ids outside the viewing org are
// ignored, never stored.
export async function POST(request: Request) {
  const ac = await adminContext(request);
  if (!ac.ok) return ac.denied;
  try {
    const body = await request.json();
    const name = sanitizeText(String(body?.name ?? ""), 100);
    const err = teamNameError(name);
    if (err) return NextResponse.json({ error: err }, { status: 422 });

    const svc = serviceClient();
    const { data: team, error } = await svc
      .from("sub_teams")
      .insert({ org_id: ac.ctx.orgId, name })
      .select("id, org_id, name")
      .single();
    if (error) {
      if (String(error.message).includes("duplicate"))
        return NextResponse.json({ error: `Team “${name}” already exists` }, { status: 409 });
      throw error;
    }

    const requested: string[] = Array.isArray(body?.member_ids) ? body.member_ids.map(String) : [];
    let assigned: string[] = [];
    if (requested.length > 0) {
      const members = new Set(await orgMemberIds(svc, ac.ctx.orgId));
      assigned = requested.filter((id) => members.has(id));
      if (assigned.length > 0) {
        const { error: uErr } = await svc.from("users").update({ sub_team_id: team.id }).in("id", assigned);
        if (uErr) throw uErr;
      }
    }
    return NextResponse.json({ ok: true, team, assigned_count: assigned.length });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "team create failed" }, { status: 500 });
  }
}

// PATCH /api/admin/sub-teams — rename a team in the viewing org.
export async function PATCH(request: Request) {
  const ac = await adminContext(request);
  if (!ac.ok) return ac.denied;
  try {
    const body = await request.json();
    const id = String(body?.team_id || "");
    const name = sanitizeText(String(body?.name ?? ""), 100);
    if (!id) return NextResponse.json({ error: "team_id is required" }, { status: 400 });
    const err = teamNameError(name);
    if (err) return NextResponse.json({ error: err }, { status: 422 });

    const svc = serviceClient();
    const { data, error } = await svc
      .from("sub_teams")
      .update({ name })
      .eq("id", id)
      .eq("org_id", ac.ctx.orgId)
      .select("id, name")
      .maybeSingle();
    if (error) {
      if (String(error.message).includes("duplicate"))
        return NextResponse.json({ error: `Team “${name}” already exists` }, { status: 409 });
      throw error;
    }
    if (!data) return NextResponse.json({ error: "Team not found" }, { status: 404 });
    return NextResponse.json({ ok: true, team: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "team rename failed" }, { status: 500 });
  }
}
