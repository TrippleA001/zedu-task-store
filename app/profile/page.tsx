"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-client";
import { requiredStages } from "@/lib/policy";
import { SKILL_LEVELS } from "@/lib/constants";
import { Alert, Badge, btnPrimary, btnSecondary, inputCls } from "../components/ui";

type Product = {
  id: string;
  title: string;
  stage_number: number;
  week_number: number;
  prereq_stages?: string | null;
  submission_schema?: Array<{
    key: string;
    label: string;
    type: "live_url" | "github_repo" | "drive_url" | "github_pr" | "text";
    required?: boolean;
  }>;
};

type Submission = {
  stage_number: number;
  values: Record<string, string> | null;
  todo_app_url: string | null;
  task_repo_url: string | null;
};

type ChangeRequest = {
  id: string;
  field: string;
  old_value: string;
  new_value: string;
  note: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
};

type Profile = {
  workspace_email: string;
  zedu_id: string;
  full_name: string;
  github_url: string;
  telegram_handle: string;
  sub_team: string | null;
  skill_rating: number;
  active_org_id: string | null;
};

type OrgItem = { id: string; name: string };

const PROFILE_FIELDS: Array<{
  key: keyof Profile;
  label: string;
  hint?: string;
  changeable?: boolean;
  kind?: "select";
  empty?: string;
}> = [
  { key: "workspace_email", label: "Workspace email", hint: "Fixed — used to match your registration" },
  { key: "zedu_id", label: "Zedu ID", hint: "Fixed — your unique Zedu identifier" },
  { key: "sub_team", label: "Sub-team", hint: "Assigned by your team lead" },
  { key: "full_name", label: "Full name", changeable: true },
  { key: "github_url", label: "GitHub URL", changeable: true },
  { key: "telegram_handle", label: "Telegram display name", changeable: true },
  { key: "skill_rating", label: "Technical skill rating", changeable: true, kind: "select" },
];

function isHttpUrl(v: string) {
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
}

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [stages, setStages] = useState<number[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [orgs, setOrgs] = useState<OrgItem[]>([]);
  const [switching, setSwitching] = useState<string | null>(null);
  const [orgErr, setOrgErr] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const loadRequests = async () => {
    const sb = supabaseBrowser();
    const { data } = await sb
      .from("change_requests")
      .select("*")
      .order("created_at", { ascending: false });
    setRequests((data as ChangeRequest[]) || []);
  };

  const loadOrgs = async () => {
    const sb = supabaseBrowser();
    const { data } = await sb.from("user_orgs").select("org_id, organizations(name)");
    const rows =
      (data as Array<{
        org_id: string;
        organizations: { name: string } | Array<{ name: string }> | null;
      }>) || [];
    setOrgs(
      rows
        .map((r) => {
          const o = Array.isArray(r.organizations) ? r.organizations[0] : r.organizations;
          return { id: r.org_id, name: o?.name || "" };
        })
        .filter((o) => o.name)
    );
  };

  const loadScoped = async (orgId: string) => {
    const rp = await fetch("/api/products").then((r) => r.json());
    if (rp.items) setProducts(rp.items);
    const ro = await fetch("/api/orders").then((r) => r.json());
    if (ro.stages) setStages(ro.stages);
    const sb = supabaseBrowser();
    const q = sb
      .from("submissions")
      .select("stage_number, values, todo_app_url, task_repo_url")
      .eq("is_current", true);
    const { data } = orgId ? await q.eq("org_id", orgId) : await q;
    setSubmissions((data as Submission[]) || []);
  };

  useEffect(() => {
    (async () => {
      const sb = supabaseBrowser();
      const { data } = await sb.auth.getUser();
      if (!data.user) { router.replace("/login"); return; }
      const { data: prof } = await sb
        .from("users")
        .select("*, sub_teams(name)")
        .eq("id", data.user.id)
        .maybeSingle();
      if (!prof) { router.replace("/onboarding"); return; }
      // users.sub_team text was replaced by sub_team_id in 013 — surface the
      // joined team name under the same key for the profile cards.
      const team = (prof.sub_teams as Array<{ name: string }> | null)?.[0]?.name ?? null;
      setProfile({ ...(prof as Profile), sub_team: team });
      await loadOrgs();
      await loadScoped(prof.active_org_id || "");
      await loadRequests();
    })();
  }, [router]);

  const pendingFor = (field: string) =>
    requests.find((r) => r.field === field && r.status === "pending");

  const startEdit = (field: keyof Profile) => {
    if (!profile) return;
    setErr(""); setMsg(""); setNote("");
    setEditValue(field === "skill_rating" ? String(profile.skill_rating) : String(profile[field] ?? ""));
    setEditing(field);
  };

  const submitRequest = async () => {
    if (!editing) return;
    setBusy(true); setErr(""); setMsg("");
    try {
      const r = await fetch("/api/change-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: editing, new_value: editValue, note }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
      setMsg("Change request submitted — an admin will review it.");
      setEditing(null);
      await loadRequests();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const switchOrg = async (orgId: string, name: string) => {
    setSwitching(orgId); setOrgErr("");
    try {
      const r = await fetch("/api/me/active-org", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org_id: orgId }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
      setProfile((p) => (p ? { ...p, active_org_id: orgId } : p));
      // Let the announcement bar (and anything else scoped) refetch for the
      // newly selected org without a full page reload.
      window.dispatchEvent(new Event("zedu:org-switched"));
      await loadScoped(orgId);
    } catch (e: any) {
      setOrgErr(e.message);
    } finally {
      setSwitching(null);
    }
  };

  const unlocked = (p: Product) =>
    requiredStages(p.prereq_stages, p.stage_number).every((s) => stages.includes(s));
  const subFor = (stage: number) => submissions.find((s) => s.stage_number === stage);

  const chipsFor = (p: Product, sub: Submission | undefined): Array<{ label: string; value: string }> => {
    if (!sub) return [];
    const out: Array<{ label: string; value: string }> = [];
    for (const f of p.submission_schema || []) {
      const v = String(sub.values?.[f.key] || "").trim();
      if (v) out.push({ label: f.label || f.key, value: v });
    }
    if (out.length === 0) {
      if (sub.todo_app_url) out.push({ label: "Deployed app", value: sub.todo_app_url });
      if (sub.task_repo_url) out.push({ label: "Task repo", value: sub.task_repo_url });
    }
    return out;
  };

  if (!profile) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="skeleton h-8 w-48" />
        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <div className="skeleton h-64 rounded-xl" />
          <div className="skeleton h-64 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <nav className="text-[13px] font-medium text-muted" aria-label="Breadcrumb">
        <Link href="/" className="text-muted">Home</Link> <span aria-hidden>/</span> <span className="text-ink">Profile</span>
      </nav>
      <div className="mt-4 border-b border-line pb-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">Your profile</h1>
        <p className="mt-1 text-sm text-muted">
          Onboarding details and task history. Profile edits go through a change request for admin review.
        </p>
      </div>

      <section aria-label="Onboarding details" className="mt-8">
        <h2 className="text-lg font-extrabold tracking-tight text-ink">Onboarding details</h2>
        {msg && <div className="mt-3"><Alert kind="success">{msg}</Alert></div>}
        {err && <div className="mt-3"><Alert kind="error">{err}</Alert></div>}
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PROFILE_FIELDS.map((f) => {
            const value = String(profile[f.key] ?? "");
            const display = f.key === "sub_team"
              ? (value || f.empty || "—")
              : f.key === "skill_rating"
                ? `${value} · ${SKILL_LEVELS.find((s) => s.value === profile.skill_rating)?.title ?? ""}`
                : value;
            const pending = f.changeable ? pendingFor(f.key) : undefined;
            const isEditing = f.changeable && editing === f.key;
            return (
              <div key={f.key} className="rounded-xl border border-line bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{f.label}</p>
                    {f.hint && <p className="mt-0.5 text-[12px] text-muted">{f.hint}</p>}
                  </div>
                  {pending && <Badge tone="open">Pending review</Badge>}
                </div>
                {pending && (
                  <p className="mt-1.5 truncate text-[13px] text-muted" title={pending.new_value}>
                    Requested: <span className="font-medium text-ink">{pending.new_value}</span>
                  </p>
                )}
                {!isEditing ? (
                  <div className="mt-2 flex items-end justify-between gap-2">
                    <p className={`truncate text-[15px] font-semibold ${f.key === "sub_team" && !value ? "font-normal italic text-muted" : "text-ink"}`} title={display}>
                      {display}
                    </p>
                    {f.changeable && !pending && (
                      <button type="button" className="shrink-0 text-[13px] font-semibold text-brand hover:underline" onClick={() => startEdit(f.key)}>
                        Request change
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="mt-3 space-y-2">
                    {f.kind === "select" ? (
                      <select className={inputCls} value={editValue} onChange={(e) => setEditValue(e.target.value)} aria-label={f.label}>
                        {SKILL_LEVELS.map((s) => (
                          <option key={s.value} value={s.value}>{s.value} · {s.title}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className={inputCls}
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        placeholder={f.key === "telegram_handle" ? "As shown on your Telegram profile" : f.label}
                        aria-label={f.label}
                      />
                    )}
                    <input
                      className={inputCls}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Note for reviewers (optional)"
                      aria-label="Note for reviewers"
                    />
                    <div className="flex items-center gap-2">
                      <button type="button" className={btnPrimary} disabled={busy || !editValue.trim()} onClick={() => void submitRequest()}>
                        {busy ? "Submitting…" : "Submit request"}
                      </button>
                      <button type="button" className={btnSecondary} disabled={busy} onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section aria-label="Organizations" className="mt-10">
        <h2 className="text-lg font-extrabold tracking-tight text-ink">Organizations</h2>
        <p className="mt-1 text-sm text-muted">
          Switching is instant — the catalog and your task history re-scope to the selected organization.
        </p>
        {orgErr && <div className="mt-3"><Alert kind="error">{orgErr}</Alert></div>}
        <ul className="mt-4 divide-y divide-line rounded-xl border border-line bg-white shadow-sm">
          {orgs.map((o) => {
            const active = o.id === (profile.active_org_id || orgs[0]?.id);
            return (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <p className="text-sm font-semibold text-ink">{o.name}</p>
                {active ? (
                  <Badge tone="done">Active</Badge>
                ) : (
                  <button
                    type="button"
                    className={btnSecondary}
                    disabled={switching !== null}
                    onClick={() => void switchOrg(o.id, o.name)}
                  >
                    {switching === o.id ? "Switching…" : "Switch"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-label="Task history" className="mt-10">
        <h2 className="text-lg font-extrabold tracking-tight text-ink">Task history</h2>
        <p className="mt-1 text-sm text-muted">{stages.length} of {products.length} tasks complete</p>
        <div className="mt-4 space-y-6">
          {Array.from(new Set(products.map((p) => p.week_number ?? 1)))
            .sort((a, b) => a - b)
            .map((week) => {
              const weekProducts = products
                .filter((p) => (p.week_number ?? 1) === week)
                .sort((a, b) => a.stage_number - b.stage_number);
              return (
                <div key={week}>
                  <p className="text-[13px] font-semibold uppercase tracking-widest text-muted">Week {week}</p>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {weekProducts.map((p) => {
                      const done = stages.includes(p.stage_number);
                      const open = unlocked(p);
                      const missing = requiredStages(p.prereq_stages, p.stage_number).filter((s) => !stages.includes(s));
                      const sub = subFor(p.stage_number);
                      const chips = chipsFor(p, sub);
                      const tone = done ? "done" : open ? "open" : "locked";
                      const status = done ? "Completed" : open ? "Pending" : "Locked";
                      return (
                        <article key={p.id} className="rounded-xl border border-line bg-white p-4 shadow-sm">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">Task {p.stage_number}</p>
                              <h3 className="mt-0.5 truncate text-sm font-bold text-ink" title={p.title}>{p.title}</h3>
                            </div>
                            <Badge tone={tone}>{status}</Badge>
                          </div>
                          {done && chips.length > 0 && (
                            <ul className="mt-3 flex flex-wrap gap-1.5">
                              {chips.map((c) =>
                                isHttpUrl(c.value) ? (
                                  <li key={c.label}>
                                    <a
                                      href={c.value}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex max-w-full items-center gap-1 rounded-full bg-brand-tint px-2.5 py-1 text-[12px] font-medium text-brand-deep transition hover:underline"
                                      title={c.value}
                                    >
                                      <span className="truncate">{c.label} ↗</span>
                                    </a>
                                  </li>
                                ) : (
                                  <li key={c.label} className="inline-flex max-w-full items-center rounded-full bg-canvas px-2.5 py-1 text-[12px] font-medium text-muted ring-1 ring-inset ring-line">
                                    <span className="truncate" title={c.value}>{c.label}: {c.value}</span>
                                  </li>
                                )
                              )}
                            </ul>
                          )}
                          {done && chips.length === 0 && (
                            <p className="mt-3 text-[13px] text-muted">Submitted — no links recorded.</p>
                          )}
                          {!done && (
                            <p className="mt-3 text-[13px] text-muted">
                              {open
                                ? "Not submitted yet — open the catalog to submit."
                                : missing.length === 1
                                  ? `Complete Task ${missing[0]} first.`
                                  : `Complete Tasks ${missing.join(", ")} first.`}
                            </p>
                          )}
                        </article>
                      );
                    })}
                  </div>
                </div>
              );
            })}
        </div>
      </section>

      {requests.some((r) => r.status !== "pending") && (
        <section aria-label="Past change requests" className="mt-10">
          <h2 className="text-lg font-extrabold tracking-tight text-ink">Past change requests</h2>
          <ul className="mt-4 divide-y divide-line rounded-xl border border-line bg-white shadow-sm">
            {requests.filter((r) => r.status !== "pending").slice(0, 10).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span className="text-ink">
                  <span className="font-semibold">{PROFILE_FIELDS.find((f) => f.key === r.field)?.label ?? r.field}</span>{" "}
                  → <span className="text-muted">{r.new_value}</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-[12px] text-muted">{new Date(r.created_at).toLocaleDateString()}</span>
                  <Badge tone={r.status === "approved" ? "done" : "locked"}>{r.status === "approved" ? "Approved" : "Rejected"}</Badge>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
