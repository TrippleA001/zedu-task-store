import { NextResponse } from "next/server";
import { adminContext } from "@/lib/admin-org";
import { serviceClient } from "@/lib/api-auth";

// PATCH /api/admin/users — one member mutation per call, always inside the
// viewing org:
//   { user_id, sub_team_id }        assign a team (null clears)
//   { user_id, org_action }         "add" | "remove" viewing-org membership
async function memberInOrg(svc: ReturnType<typeof serviceClient>, userId: string, orgId: string) {
  const { data } = await svc
    .from("user_orgs")
    .select("user_id")
    .eq("user_id", userId)
    .eq("org_id", orgId)
    .maybeSingle();
  return Boolean(data);
}

export async function PATCH(request: Request) {
  const ac = await adminContext(request);
  if (!ac.ok) return ac.denied;
  try {
    const body = await request.json();
    const userId = String(body?.user_id || "");
    if (!userId) return NextResponse.json({ error: "user_id is required" }, { status: 400 });
    const setsTeam = body?.sub_team_id !== undefined;
    const setsOrg = body?.org_action !== undefined;
    if (setsTeam === setsOrg)
      return NextResponse.json(
        { error: "Send exactly one of sub_team_id or org_action" },
        { status: 400 }
      );

    const svc = serviceClient();
    if (!(await memberInOrg(svc, userId, ac.ctx.orgId)))
      return NextResponse.json({ error: "Member not found in this org" }, { status: 404 });

    if (setsTeam) {
      if (body.sub_team_id !== null && typeof body.sub_team_id !== "string")
        return NextResponse.json({ error: "sub_team_id must be a team id or null" }, { status: 400 });
      if (body.sub_team_id !== null) {
        const { data: team } = await svc
          .from("sub_teams")
          .select("id")
          .eq("id", body.sub_team_id)
          .eq("org_id", ac.ctx.orgId)
          .maybeSingle();
        if (!team) return NextResponse.json({ error: "Team not found in this org" }, { status: 404 });
      }
      const { data, error } = await svc
        .from("users")
        .update({ sub_team_id: body.sub_team_id })
        .eq("id", userId)
        .select("id, full_name, sub_team_id")
        .maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ error: "Member not found" }, { status: 404 });
      return NextResponse.json({ ok: true, member: data });
    }

    const action = String(body.org_action);
    if (action !== "add" && action !== "remove")
      return NextResponse.json({ error: "org_action must be add or remove" }, { status: 400 });

    if (action === "add") {
      await svc
        .from("user_orgs")
        .upsert({ user_id: userId, org_id: ac.ctx.orgId }, { onConflict: "user_id,org_id", ignoreDuplicates: true });
      return NextResponse.json({ ok: true, member: { id: userId, in_org: true } });
    }

    await svc.from("user_orgs").delete().eq("user_id", userId).eq("org_id", ac.ctx.orgId);
    // Losing the working org would leave active_org_id dangling — repoint it
    // to any remaining membership, else null (falls back to the default org).
    const { data: target } = await svc
      .from("users")
      .select("active_org_id")
      .eq("id", userId)
      .maybeSingle();
    if (target?.active_org_id === ac.ctx.orgId) {
      const { data: rest } = await svc
        .from("user_orgs")
        .select("org_id")
        .eq("user_id", userId)
        .limit(1);
      const nextOrg = rest && rest.length > 0 ? rest[0].org_id : null;
      await svc.from("users").update({ active_org_id: nextOrg }).eq("id", userId);
    }
    return NextResponse.json({ ok: true, member: { id: userId, in_org: false } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "member update failed" }, { status: 500 });
  }
}
