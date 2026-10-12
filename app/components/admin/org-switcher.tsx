"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

// Org picker for super admins on /admin — posts the choice to
// /api/admin/viewing-org (sets the admin_org cookie), then refreshes so the
// server component re-reads the viewing org.
export default function OrgSwitcher({
  orgs,
  current,
}: {
  orgs: Array<{ id: string; name: string }>;
  current: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const pick = async (orgId: string) => {
    setBusy(true);
    try {
      await fetch("/api/admin/viewing-org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org_id: orgId }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <label className="flex items-center gap-2 text-[13px] text-muted">
      Org
      <select
        value={current}
        disabled={busy}
        onChange={(e) => void pick(e.target.value)}
        className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px] font-semibold text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
      >
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}
