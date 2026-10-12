import { NextResponse } from "next/server";
import { adminContext } from "@/lib/admin-org";
import { serviceClient } from "@/lib/api-auth";
import { sanitizeText } from "@/lib/validation";

// PATCH /api/admin/org — edit the viewing org's announcement banner.
// Plain sanitized text only: the storefront renders it as text, never HTML.
export async function PATCH(request: Request) {
  const ac = await adminContext(request);
  if (!ac.ok) return ac.denied;
  try {
    const body = await request.json();
    const banner = sanitizeText(String(body?.banner_text ?? "").replace(/\s+/g, " "), 200);
    const svc = serviceClient();
    const { data, error } = await svc
      .from("organizations")
      .update({ banner_text: banner || null })
      .eq("id", ac.ctx.orgId)
      .select("id, name, banner_text")
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Org not found" }, { status: 404 });
    return NextResponse.json({ ok: true, org: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "banner update failed" }, { status: 500 });
  }
}
