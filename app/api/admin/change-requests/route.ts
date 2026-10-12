import { NextResponse } from "next/server";
import { adminContext, orgMemberIds } from "@/lib/admin-org";
import { serviceClient } from "@/lib/api-auth";
import { CHANGE_FIELD_COLUMN, isChangeableField, type ChangeableField } from "@/lib/validation";

// PATCH /api/admin/change-requests — decide a pending profile change.
// Body: { id, action: "approve" | "reject" }. Approving applies new_value to
// the member's users row (service role), then flips the request to approved;
// the status flip is conditional on still-pending so two admins can never
// double-decide, and a failed profile write rolls the flip back.
export async function PATCH(request: Request) {
  const ac = await adminContext(request);
  if (!ac.ok) return ac.denied;
  try {
    const body = await request.json();
    const id = String(body?.id || "");
    const action = String(body?.action || "");
    if (!id) return NextResponse.json({ error: "Request id is required" }, { status: 400 });
    if (action !== "approve" && action !== "reject")
      return NextResponse.json({ error: "action must be approve or reject" }, { status: 400 });

    const svc = serviceClient();
    const { data: row } = await svc.from("change_requests").select("*").eq("id", id).maybeSingle();
    if (!row) return NextResponse.json({ error: "Request not found" }, { status: 404 });
    const members = new Set(await orgMemberIds(svc, ac.ctx.orgId));
    if (!members.has(row.user_id))
      return NextResponse.json({ error: "Request not found in this org" }, { status: 404 });
    if (row.status !== "pending")
      return NextResponse.json({ error: `Already decided (${row.status})` }, { status: 409 });

    const nextStatus = action === "approve" ? "approved" : "rejected";
    const { data: claimed, error: claimErr } = await svc
      .from("change_requests")
      .update({ status: nextStatus, decided_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();
    if (claimErr) throw claimErr;
    if (!claimed) return NextResponse.json({ error: "Already decided" }, { status: 409 });

    if (action === "approve") {
      if (!isChangeableField(row.field)) {
        await svc.from("change_requests").update({ status: "pending", decided_at: null }).eq("id", id);
        return NextResponse.json({ error: `Unknown field "${row.field}"` }, { status: 400 });
      }
      const column: string = CHANGE_FIELD_COLUMN[row.field as ChangeableField];
      let value: string | number = String(row.new_value);
      if (row.field === "skill_rating") {
        const rating = Number(row.new_value);
        if (!(Number.isInteger(rating) && rating >= 1 && rating <= 5)) {
          await svc.from("change_requests").update({ status: "pending", decided_at: null }).eq("id", id);
          return NextResponse.json({ error: "Stored skill rating is not 1-5" }, { status: 422 });
        }
        value = rating;
      }
      const { error: applyErr } = await svc.from("users").update({ [column]: value }).eq("id", row.user_id);
      if (applyErr) {
        await svc.from("change_requests").update({ status: "pending", decided_at: null }).eq("id", id);
        throw applyErr;
      }
    }

    return NextResponse.json({ ok: true, request: claimed });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "decision failed" }, { status: 500 });
  }
}
