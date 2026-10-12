"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/app/components/ui";

export type AdminMember = {
  id: string;
  full_name: string;
  auth_email: string;
  workspace_email: string | null;
  team_id: string | null;
  team_name: string | null;
  org_ids: string[];
};

export type AdminTeam = { id: string; name: string };

// PR1 console: teams are created and assigned from a per-member select.
// (The drag-and-drop board lands in the follow-up PR.)
export default function MemberTeams({
  members,
  teams,
  viewingOrgId,
  viewerId,
}: {
  members: AdminMember[];
  teams: AdminTeam[];
  viewingOrgId: string;
  viewerId: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newTeam, setNewTeam] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) =>
        m.full_name.toLowerCase().includes(q) ||
        m.auth_email.toLowerCase().includes(q) ||
        (m.workspace_email || "").toLowerCase().includes(q) ||
        (m.team_name || "").toLowerCase().includes(q)
    );
  }, [members, query]);

  const teamOptions = useMemo(() => [...teams].sort((a, b) => a.name.localeCompare(b.name)), [teams]);
  const draftFor = (m: AdminMember) => drafts[m.id] ?? m.team_id ?? "";
  const dirty = (m: AdminMember) => draftFor(m) !== (m.team_id ?? "");
  const inOrg = (m: AdminMember) => m.org_ids.includes(viewingOrgId);

  const createTeam = async () => {
    const name = newTeam.trim();
    if (!name || creating) return;
    setCreating(true);
    setErr("");
    setMsg("");
    try {
      const r = await fetch("/api/admin/sub-teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Create failed (${r.status})`);
      setMsg(`Team “${name}” created.`);
      setNewTeam("");
      router.refresh();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setCreating(false);
    }
  };

  const saveTeam = async (m: AdminMember) => {
    if (!dirty(m) || busyId === m.id) return;
    setBusyId(m.id);
    setErr("");
    setMsg("");
    try {
      const teamId = draftFor(m) || null;
      const r = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: m.id, sub_team_id: teamId }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Save failed (${r.status})`);
      const name = teamId ? teamOptions.find((t) => t.id === teamId)?.name || "" : "";
      setMsg(`${m.full_name}: ${name ? `moved to “${name}”` : "removed from team"}.`);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[m.id];
        return next;
      });
      router.refresh();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusyId(null);
    }
  };

  const toggleOrg = async (m: AdminMember) => {
    if (busyId === m.id) return;
    setBusyId(m.id);
    setErr("");
    setMsg("");
    try {
      const action = inOrg(m) ? "remove" : "add";
      const r = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: m.id, org_action: action }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Update failed (${r.status})`);
      setMsg(`${m.full_name} ${action === "add" ? "added to" : "removed from"} this org.`);
      router.refresh();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section aria-label="Member sub-teams">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold tracking-tight text-ink">Sub-teams</h2>
          <p className="mt-1 text-sm text-muted">
            Create teams and assign members. Org membership decides which console sees the member.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search members…"
            aria-label="Search members"
            className="w-48 rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
        </div>
      </div>
      {err && <div className="mt-3"><Alert kind="error">{err}</Alert></div>}
      {msg && <div className="mt-3"><Alert kind="success">{msg}</Alert></div>}

      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white px-4 py-3 shadow-sm">
        <input
          type="text"
          value={newTeam}
          maxLength={100}
          placeholder="New team name (e.g. Frontend)"
          aria-label="New team name"
          onChange={(e) => setNewTeam(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void createTeam();
          }}
          className="w-full max-w-xs rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        />
        <button
          type="button"
          disabled={creating || !newTeam.trim()}
          onClick={() => void createTeam()}
          className="inline-flex items-center rounded-lg bg-brand px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {creating ? "Creating…" : "Create team"}
        </button>
        {teams.length > 0 && (
          <span className="text-[13px] text-muted">
            {teams.length} team{teams.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-white shadow-sm">
        {filtered.map((m) => {
          const self = m.id === viewerId;
          return (
            <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1 basis-48">
                <p className="truncate text-sm font-semibold text-ink" title={m.full_name}>{m.full_name}</p>
                <p className="truncate text-[12px] text-muted" title={m.workspace_email || m.auth_email}>
                  {m.workspace_email || m.auth_email}
                </p>
              </div>
              <div className="w-full max-w-[220px]">
                <select
                  value={draftFor(m)}
                  aria-label={`Team for ${m.full_name}`}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [m.id]: e.target.value }))}
                  className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                >
                  <option value="">No team</option>
                  {teamOptions.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
              {dirty(m) && (
                <button
                  type="button"
                  disabled={busyId === m.id}
                  onClick={() => void saveTeam(m)}
                  className="inline-flex shrink-0 items-center rounded-lg bg-brand px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busyId === m.id ? "Saving…" : "Save"}
                </button>
              )}
              <button
                type="button"
                disabled={busyId === m.id || (self && inOrg(m))}
                title={self && inOrg(m) ? "You can't remove your own membership" : undefined}
                onClick={() => void toggleOrg(m)}
                className="shrink-0 rounded-lg border border-line bg-white px-3 py-2 text-[13px] font-semibold text-ink shadow-sm transition hover:border-muted/50 hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busyId === m.id ? "…" : inOrg(m) ? "Remove from org" : "Add to org"}
              </button>
            </li>
          );
        })}
        {filtered.length === 0 && (
          <li className="px-4 py-8 text-center text-sm text-muted">
            {members.length === 0 ? "No members in this org yet." : "No members match that search."}
          </li>
        )}
      </ul>
    </section>
  );
}
