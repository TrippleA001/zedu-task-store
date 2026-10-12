"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { SKILL_LEVELS } from "@/lib/constants";
import { Alert, Field, btnPrimary, inputCls } from "../components/ui";

export type ConfirmPrefill = {
  email: string;
  zedu_id: string;
  full_name: string;
  github_url: string;
  telegram_handle: string;
  skill_label: string;
  suggested_rating: number | null;
};

// Pre-filled confirm screen for members whose roster row already carries
// telegram + github. Returned by GET /api/onboarding/confirm — the wizard
// stays as the fallback whenever that lookup 404s.
export default function ConfirmCard({ prefill }: { prefill: ConfirmPrefill }) {
  const router = useRouter();
  const [fullName, setFullName] = useState(prefill.full_name);
  const [githubUrl, setGithubUrl] = useState(prefill.github_url);
  const [telegram, setTelegram] = useState(prefill.telegram_handle);
  const [skill, setSkill] = useState(prefill.suggested_rating ?? 0);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/onboarding/confirm", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: fullName, github_url: githubUrl,
          telegram_handle: telegram, skill_rating: skill,
        }),
      });
      const j = await r.json();
      if (r.status === 404) {
        // No longer eligible (row claimed elsewhere) — reload into the wizard.
        window.location.reload();
        return;
      }
      if (!r.ok) throw new Error(j.error || "Submit failed");
      router.replace("/profile");
    } catch (e: any) { setMsg(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="mt-4 rounded-xl border border-line bg-white p-6 shadow-sm sm:p-8">
      <h2 className="text-lg font-bold text-ink">Confirm your profile</h2>
      <p className="mt-1 text-sm text-muted">
        You&apos;re already registered — your details from the registration list are filled in below.
        Check them and make changes if necessary, then finish.
      </p>
      {msg && <div className="mt-4"><Alert kind="error">{msg}</Alert></div>}
      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <Field label="Registration email" hint="From your registration — shown masked, cannot be changed here.">
          <input className={`${inputCls} bg-canvas text-muted`} value={prefill.email} disabled />
        </Field>
        <Field label="Zedu ID (username)" hint="From your registration — cannot be changed here.">
          <input className={`${inputCls} bg-canvas text-muted`} value={prefill.zedu_id} disabled />
        </Field>
        <Field label="Full name" hint="Edit if it's wrong.">
          <input className={inputCls} value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </Field>
        <Field label="Telegram display name" hint="As shown on your Telegram profile, e.g. A Data Scientist.">
          <input className={inputCls} value={telegram} onChange={(e) => setTelegram(e.target.value)} placeholder="e.g. A Data Scientist" autoCapitalize="words" autoCorrect="off" spellCheck={false} maxLength={100} />
        </Field>
      </div>
      <div className="mt-5">
        <Field label="GitHub URL" hint="Edit if it's wrong.">
          <input className={inputCls} value={githubUrl} onChange={(e) => setGithubUrl(e.target.value)} placeholder="https://github.com/you" />
        </Field>
      </div>
      <fieldset className="mt-6">
        <legend className="text-sm font-medium text-ink">
          Technical skill rating <span className="font-normal text-muted">— be honest, used for grouping</span>
        </legend>
        {prefill.skill_label && (
          <p className="mt-1 text-[13px] text-muted">
            Your registration list says <span className="font-semibold text-ink">{prefill.skill_label}</span>
            {prefill.suggested_rating ? ` — we picked ${prefill.suggested_rating} below.` : " — we couldn't map that to a rating, pick one below."}
          </p>
        )}
        <div className="mt-3 space-y-2">
          {SKILL_LEVELS.map((s) => {
            const active = skill === s.value;
            return (
              <label
                key={s.value}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition ${
                  active ? "border-brand bg-brand-tint/60 ring-1 ring-brand" : "border-line bg-white hover:border-muted/60 hover:bg-canvas/50"
                }`}
              >
                <input
                  type="radio"
                  name="skill"
                  className="mt-1 h-4 w-4 shrink-0 accent-[#008060]"
                  checked={active}
                  onChange={() => setSkill(s.value)}
                />
                <span>
                  <span className="block text-sm font-semibold text-ink">
                    {s.value} — {s.title}
                    <span className="ml-2 font-normal text-warn" aria-hidden>{"★".repeat(s.value)}{"☆".repeat(5 - s.value)}</span>
                  </span>
                  <span className="mt-0.5 block text-[13px] text-muted">{s.desc}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <div className="mt-6 rounded-lg border border-line bg-canvas px-4 py-3 text-[13px] text-muted">
        Channels are already marked as joined for imported members — no checkboxes needed.
        You can request changes to any of these details later from your profile.
      </div>
      <div className="mt-6">
        <button className={btnPrimary} disabled={busy || !fullName || !githubUrl || !telegram || skill < 1} onClick={submit}>
          {busy ? "Submitting..." : "Complete & view my profile"}
        </button>
      </div>
    </div>
  );
}
