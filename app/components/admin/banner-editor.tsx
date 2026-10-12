"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, btnPrimary, btnSecondary } from "@/app/components/ui";

// Edits the announcement banner of the org the admin console is currently
// viewing (the PATCH route resolves the org from the admin_org cookie, so
// this always targets what the switcher shows).
export default function BannerEditor({ initial }: { initial: string }) {
  const router = useRouter();
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const dirty = text.trim() !== initial.trim();

  const save = async () => {
    if (!dirty || busy) return;
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const r = await fetch("/api/admin/org", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ banner_text: text.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Save failed (${r.status})`);
      setMsg("Banner updated.");
      router.refresh();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Announcement banner">
      <h2 className="text-lg font-extrabold tracking-tight text-ink">Announcement banner</h2>
      <p className="mt-1 text-sm text-muted">
        Shown in the green bar at the top of every page for this org. Plain text only (max 200 characters).
        Leave empty to show the default announcement.
      </p>
      <div className="mt-4 max-w-2xl space-y-3 rounded-xl border border-line bg-white p-4 shadow-sm">
        {err && <Alert kind="error">{err}</Alert>}
        {msg && <Alert kind="success">{msg}</Alert>}
        <textarea
          className="w-full rounded-lg border border-line bg-white px-3 py-2.5 text-[15px] text-ink shadow-sm transition hover:border-muted/60 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25 disabled:cursor-not-allowed disabled:bg-canvas"
          rows={2}
          maxLength={200}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Stage 1 verification is open — complete your milestone."
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12px] text-muted">{text.length}/200</span>
          <div className="flex gap-2">
            <button
              className={btnSecondary}
              onClick={() => {
                setText(initial);
                setErr("");
                setMsg("");
              }}
              disabled={busy || !dirty}
            >
              Reset
            </button>
            <button className={btnPrimary} onClick={save} disabled={busy || !dirty}>
              {busy ? "Saving..." : "Save banner"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
