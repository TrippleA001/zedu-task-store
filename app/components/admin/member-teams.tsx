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

// Drag-and-drop sub-team board. Drops only stage pending moves in local
// state; one explicit Save commits them all (a PATCH per changed member).
// Teams sort alphabetically and show their member count; the pencil icon
// renames a team; new teams pick their founding members at creation time.
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
  const [moves, setMoves] = useState<Record<string, string | null>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [newTeam, setNewTeam] = useState("");
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const teamOf = (m: AdminMember) => (m.id in moves ? moves[m.id] : m.team_id);
  const inOrg = (m: AdminMember) => m.org_ids.includes(viewingOrgId);
  const inScope = useMemo(() => members.filter(inOrg), [members, viewingOrgId]);

  const teamOptions = useMemo(
    () => [...teams].sort((a, b) => a.name.localeCompare(b.name)),
    [teams]
  );

  const q = query.trim().toLowerCase();
  const matches = (m: AdminMember) =>
    !q ||
    m.full_name.toLowerCase().includes(q) ||
    m.auth_email.toLowerCase().includes(q) ||
    (m.workspace_email || "").toLowerCase().includes(q) ||
    (m.team_name || "").toLowerCase().includes(q);

  // Effective grouping after pending moves: unassigned bucket + one list per
  // team, restricted to viewing-org members and the search filter. Small
  // lists — recompute per render instead of memoizing.
  const unassigned: AdminMember[] = [];
  const byTeam = new Map<string, AdminMember[]>();
  for (const m of inScope) {
    if (!matches(m)) continue;
    const t = teamOf(m);
    if (!t) unassigned.push(m);
    else {
      const list = byTeam.get(t) || [];
      list.push(m);
      byTeam.set(t, list);
    }
  }

  const pendingCount = inScope.filter((m) => teamOf(m) !== m.team_id).length;

  const dropOn = (teamId: string | null) => {
    if (!dragId) return;
    setMoves((prev) => ({ ...prev, [dragId]: teamId }));
    setDragId(null);
  };

  const saveMoves = async () => {
    if (pendingCount === 0 || saving) return;
    setSaving(true);
    setErr("");
    setMsg("");
    const changed = inScope.filter((m) => teamOf(m) !== m.team_id);
    try {
      for (const m of changed) {
        const r = await fetch("/api/admin/users", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: m.id, sub_team_id: teamOf(m) }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `Save failed for ${m.full_name} (${r.status})`);
      }
      setMoves({});
      setMsg(`Saved ${changed.length} team move${changed.length === 1 ? "" : "s"}.`);
      router.refresh();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  const createTeam = async () => {
    const name = newTeam.trim();
    if (!name || creating) return;
    setCreating(true);
    setErr("");
    setMsg("");
    try {
      const member_ids = inScope.filter((m) => picked[m.id]).map((m) => m.id);
      const r = await fetch("/api/admin/sub-teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, member_ids }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Create failed (${r.status})`);
      setMsg(`Team “${name}” created${member_ids.length > 0 ? ` with ${member_ids.length} member${member_ids.length === 1 ? "" : "s"}` : ""}.`);
      setNewTeam("");
      setPicked({});
      router.refresh();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setCreating(false);
    }
  };

  const saveRename = async (team: AdminTeam) => {
    const name = renameValue.trim();
    setRenaming(null);
    if (!name || name === team.name) return;
    setErr("");
    setMsg("");
    try {
      const r = await fetch("/api/admin/sub-teams", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team_id: team.id, name }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Rename failed (${r.status})`);
      setMsg(`Team renamed to “${name}”.`);
      router.refresh();
    } catch (e: any) {
      setErr(e.message);
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

  const chip = (m: AdminMember) => (
    <li
      key={m.id}
      draggable
      onDragStart={() => setDragId(m.id)}
      onDragEnd={() => setDragId(null)}
      className={`flex cursor-grab items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 shadow-sm active:cursor-grabbing ${
        dragId === m.id ? "ring-2 ring-brand/50" : ""
      }`}
      title={`Drag to assign ${m.full_name}`}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-ink">{m.full_name}</p>
        <p className="truncate text-[11px] text-muted">{m.workspace_email || m.auth_email}</p>
      </div>
      <button
        type="button"
        disabled={busyId === m.id || m.id === viewerId}
        title={m.id === viewerId ? "You can't remove your own membership" : "Remove from this org"}
        onClick={() => void toggleOrg(m)}
        className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-muted transition hover:bg-canvas hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
      >
        ×
      </button>
    </li>
  );

  const dropZone = (teamId: string | null, list: AdminMember[], label: string) => (
    <ul
      onDragOver={(e) => e.preventDefault()}
      onDrop={() => dropOn(teamId)}
      className={`mt-2 min-h-[56px] space-y-2 rounded-lg border border-dashed p-2 transition ${
        dragId ? "border-brand/50 bg-brand-tint/40" : "border-line bg-canvas/50"
      }`}
      aria-label={label}
    >
      {list.map(chip)}
      {list.length === 0 && <li className="px-2 py-2 text-[12px] italic text-muted">Drop members here</li>}
    </ul>
  );

  return (
    <section aria-label="Member sub-teams">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold tracking-tight text-ink">Sub-teams</h2>
          <p className="mt-1 text-sm text-muted">
            Drag members between teams, then save. Org membership decides which console sees the member.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search members…"
            aria-label="Search members"
            className="w-48 rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
          <button
            type="button"
            disabled={pendingCount === 0 || saving}
            onClick={() => void saveMoves()}
            className="inline-flex items-center rounded-lg bg-brand px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving…" : pendingCount > 0 ? `Save ${pendingCount} move${pendingCount === 1 ? "" : "s"}` : "Save"}
          </button>
        </div>
      </div>
      {err && <div className="mt-3"><Alert kind="error">{err}</Alert></div>}
      {msg && <div className="mt-3"><Alert kind="success">{msg}</Alert></div>}

      <div className="mt-4 rounded-xl border border-line bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={newTeam}
            maxLength={100}
            placeholder="New team name (e.g. Frontend)"
            aria-label="New team name"
            onChange={(e) => setNewTeam(e.target.value)}
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
          <span className="text-[12px] text-muted">Optionally pick founding members:</span>
        </div>
        {inScope.length > 0 && (
          <div className="mt-3 grid max-h-40 gap-1 overflow-y-auto rounded-lg border border-line bg-canvas/40 p-2 sm:grid-cols-2 lg:grid-cols-3">
            {inScope.map((m) => (
              <label key={m.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[13px] text-ink hover:bg-white">
                <input
                  type="checkbox"
                  checked={picked[m.id] === true}
                  onChange={(e) => setPicked((prev) => ({ ...prev, [m.id]: e.target.checked }))}
                  className="h-3.5 w-3.5 rounded border-line text-brand focus:ring-brand/30"
                />
                <span className="truncate">{m.full_name}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-line bg-white p-4 shadow-sm">
          <p className="text-[13px] font-bold uppercase tracking-wider text-muted">
            {unassigned.length} · Unassigned
          </p>
          {dropZone(null, unassigned, "Unassigned members")}
        </div>
        {teamOptions.map((t) => {
          const list = byTeam.get(t.id) || [];
          return (
            <div key={t.id} className="rounded-xl border border-line bg-white p-4 shadow-sm">
              {renaming === t.id ? (
                <input
                  autoFocus
                  value={renameValue}
                  maxLength={100}
                  aria-label={`Rename ${t.name}`}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => void saveRename(t)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveRename(t);
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  className="w-full max-w-[260px] rounded-lg border border-line bg-white px-3 py-1.5 text-[13px] font-bold text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                />
              ) : (
                <p className="flex items-center gap-1.5 text-[13px] font-bold uppercase tracking-wider text-muted">
                  <button
                    type="button"
                    aria-label={`Rename ${t.name}`}
                    title={`Rename ${t.name}`}
                    onClick={() => {
                      setRenaming(t.id);
                      setRenameValue(t.name);
                    }}
                    className="rounded-md p-1 text-muted transition hover:bg-canvas hover:text-ink"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                      <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                    </svg>
                  </button>
                  <span>
                    {list.length} · {t.name}
                  </span>
                </p>
              )}
              {dropZone(t.id, list, `Members of ${t.name}`)}
            </div>
          );
        })}
      </div>

      {members.filter((m) => !inOrg(m) && matches(m)).length > 0 && (
        <div className="mt-6 rounded-xl border border-line bg-white p-4 shadow-sm">
          <p className="text-[13px] font-bold uppercase tracking-wider text-muted">Not in this org</p>
          <ul className="mt-2 divide-y divide-line">
            {members
              .filter((m) => !inOrg(m) && matches(m))
              .map((m) => (
                <li key={m.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-ink">{m.full_name}</p>
                    <p className="truncate text-[11px] text-muted">{m.workspace_email || m.auth_email}</p>
                  </div>
                  <button
                    type="button"
                    disabled={busyId === m.id}
                    onClick={() => void toggleOrg(m)}
                    className="shrink-0 rounded-lg border border-line bg-white px-3 py-1.5 text-[12px] font-semibold text-ink shadow-sm transition hover:border-muted/50 hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busyId === m.id ? "…" : "Add to org"}
                  </button>
                </li>
              ))}
          </ul>
        </div>
      )}
    </section>
  );
}
