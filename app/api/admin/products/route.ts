import { NextResponse } from "next/server";
import { adminContext } from "@/lib/admin-org";
import { serviceClient } from "@/lib/api-auth";
import { attemptsPolicyError, prereqStagesError } from "@/lib/policy";
import { sanitizeText, submissionSchemaError } from "@/lib/validation";

// `is_active` = catalog visibility; `is_open` = purchasable gate enforced
// by checkout (423 when closed). Both toggled from the admin console.

type SchemaDef = {
  key: string;
  label: string;
  hint?: string;
  type: string;
  required?: boolean;
};

function cleanSchema(raw: unknown): SchemaDef[] {
  return (raw as SchemaDef[]).map((f) => {
    const out: SchemaDef = {
      key: String(f.key).trim(),
      label: sanitizeText(String(f.label), 120),
      type: String(f.type),
    };
    if (typeof f.hint === "string" && f.hint.trim()) out.hint = sanitizeText(f.hint, 200);
    if (f.required === true) out.required = true;
    return out;
  });
}

function fieldErrors(body: Record<string, unknown>, { creating }: { creating: boolean }): string | null {
  if (creating || body.title !== undefined) {
    const title = sanitizeText(String(body.title ?? ""), 255);
    if (title.length < 3) return "Title must be at least 3 characters";
  }
  if (body.price !== undefined) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) return "Price must be a number ≥ 0";
  }
  for (const key of ["stage_number", "week_number"] as const) {
    if (body[key] !== undefined) {
      const n = Number(body[key]);
      if (!Number.isInteger(n) || n < 1 || n > 99) return `${key} must be an integer between 1 and 99`;
    }
  }
  if (body.is_active !== undefined && typeof body.is_active !== "boolean")
    return "is_active must be true or false";
  if (body.is_open !== undefined && typeof body.is_open !== "boolean")
    return "is_open must be true or false";
  if (body.submission_schema !== undefined) {
    const err = submissionSchemaError(body.submission_schema);
    if (err) return err;
  }
  if (body.prereq_stages !== undefined && body.prereq_stages !== null) {
    const err = prereqStagesError(String(body.prereq_stages));
    if (err) return err;
  }
  if (body.attempts_policy !== undefined) {
    const err = attemptsPolicyError(String(body.attempts_policy ?? ""));
    if (err) return err;
  }
  return null;
}

// POST /api/admin/products — create a task product in the viewing org.
export async function POST(request: Request) {
  const ac = await adminContext(request);
  if (!ac.ok) return ac.denied;
  try {
    const body = await request.json();
    if (body?.stage_number === undefined) return NextResponse.json({ error: "stage_number is required" }, { status: 400 });
    const err = fieldErrors(body, { creating: true });
    if (err) return NextResponse.json({ error: err }, { status: 422 });

    const stageNumber = Number(body.stage_number);
    const prereqRaw = body.prereq_stages == null ? "" : String(body.prereq_stages).trim();
    const selfErr = prereqStagesError(prereqRaw, stageNumber);
    if (selfErr) return NextResponse.json({ error: selfErr }, { status: 422 });

    const svc = serviceClient();
    const { data, error } = await svc
      .from("products")
      .insert({
        title: sanitizeText(String(body.title), 255),
        description: body.description != null ? sanitizeText(String(body.description), 2000) : null,
        price: body.price != null ? Number(body.price) : 0,
        stage_number: stageNumber,
        week_number: body.week_number != null ? Number(body.week_number) : 1,
        is_active: body.is_active !== false,
        is_open: body.is_open === true,
        submission_schema: cleanSchema(body.submission_schema ?? []),
        prereq_stages: prereqRaw === "" ? null : prereqRaw,
        attempts_policy: String(body.attempts_policy || "single"),
        org_id: ac.ctx.orgId,
      })
      .select("*")
      .single();
    if (error) {
      if (String(error.message).includes("duplicate"))
        return NextResponse.json({ error: `Task ${Number(body.stage_number)} already exists` }, { status: 409 });
      throw error;
    }
    return NextResponse.json({ ok: true, product: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "product create failed" }, { status: 500 });
  }
}

// PATCH /api/admin/products — update an existing product by id. Partial:
// only the fields present in the body are changed.
export async function PATCH(request: Request) {
  const ac = await adminContext(request);
  if (!ac.ok) return ac.denied;
  try {
    const body = await request.json();
    const id = String(body?.id || "");
    if (!id) return NextResponse.json({ error: "Product id is required" }, { status: 400 });
    const err = fieldErrors(body, { creating: false });
    if (err) return NextResponse.json({ error: err }, { status: 422 });

    const patch: Record<string, unknown> = {};
    if (body.title !== undefined) patch.title = sanitizeText(String(body.title), 255);
    if (body.description !== undefined)
      patch.description = body.description === null ? null : sanitizeText(String(body.description), 2000);
    if (body.price !== undefined) patch.price = Number(body.price);
    if (body.stage_number !== undefined) patch.stage_number = Number(body.stage_number);
    if (body.week_number !== undefined) patch.week_number = Number(body.week_number);
    if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);
    if (body.is_open !== undefined) patch.is_open = Boolean(body.is_open);
    if (body.submission_schema !== undefined) patch.submission_schema = cleanSchema(body.submission_schema);
    if (body.prereq_stages !== undefined) {
      const raw = body.prereq_stages === null ? "" : String(body.prereq_stages).trim();
      patch.prereq_stages = raw === "" ? null : raw;
    }
    if (body.attempts_policy !== undefined) patch.attempts_policy = String(body.attempts_policy);
    if (Object.keys(patch).length === 0)
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

    const svc = serviceClient();
    // Self-reference needs the FINAL stage + prereq pair, so a prereq-only
    // patch validates against the stored stage (and vice versa).
    if (patch.prereq_stages !== undefined || patch.stage_number !== undefined) {
      const { data: product, error: pErr } = await svc
        .from("products")
        .select("stage_number, prereq_stages")
        .eq("id", id)
        .eq("org_id", ac.ctx.orgId)
        .maybeSingle();
      if (pErr) throw pErr;
      if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });
      const nextStage = patch.stage_number !== undefined ? Number(patch.stage_number) : product.stage_number;
      const nextPrereq =
        patch.prereq_stages !== undefined ? String(patch.prereq_stages || "") : String(product.prereq_stages || "");
      const selfErr = prereqStagesError(nextPrereq, nextStage);
      if (selfErr) return NextResponse.json({ error: selfErr }, { status: 422 });
    }

    const { data, error } = await svc
      .from("products")
      .update(patch)
      .eq("id", id)
      .eq("org_id", ac.ctx.orgId)
      .select("*")
      .maybeSingle();
    if (error) {
      if (String(error.message).includes("duplicate"))
        return NextResponse.json({ error: `Task ${Number(body.stage_number)} already exists` }, { status: 409 });
      throw error;
    }
    if (!data) return NextResponse.json({ error: "Product not found" }, { status: 404 });
    return NextResponse.json({ ok: true, product: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "product update failed" }, { status: 500 });
  }
}

// DELETE /api/admin/products — remove a task that has never been ordered.
// Any order, submission, or cart row referencing it blocks deletion (409) so
// purchased or earned values are never lost.
export async function DELETE(request: Request) {
  const ac = await adminContext(request);
  if (!ac.ok) return ac.denied;
  try {
    const body = await request.json();
    const id = String(body?.id || "");
    if (!id) return NextResponse.json({ error: "Product id is required" }, { status: 400 });

    const svc = serviceClient();
    const { data: product, error: pErr } = await svc
      .from("products")
      .select("id, stage_number")
      .eq("id", id)
      .eq("org_id", ac.ctx.orgId)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

    const [{ count: orders }, { count: submissions }, { count: carts }] = await Promise.all([
      svc.from("orders").select("id", { count: "exact", head: true }).eq("product_id", id),
      // submissions carry stage numbers, not product ids
      svc.from("submissions").select("id", { count: "exact", head: true }).eq("stage_number", product.stage_number),
      svc.from("carts").select("product_id", { count: "exact", head: true }).eq("product_id", id),
    ]);
    const blockers: string[] = [];
    if (orders) blockers.push(`${orders} order${orders === 1 ? "" : "s"}`);
    if (submissions) blockers.push(`${submissions} submission${submissions === 1 ? "" : "s"}`);
    if (carts) blockers.push(`${carts} cart${carts === 1 ? "" : "s"}`);
    if (blockers.length > 0)
      return NextResponse.json(
        { error: `Cannot delete — referenced by ${blockers.join(", ")}` },
        { status: 409 }
      );

    const { error } = await svc.from("products").delete().eq("id", id).eq("org_id", ac.ctx.orgId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "product delete failed" }, { status: 500 });
  }
}
