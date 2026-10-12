import test from "node:test";
import assert from "node:assert/strict";
import { parseGithubRepo, parseGithubPr, parseDriveUrl, isBlockedHost, isHttpsUrl, generateOrderNumber, normalizeEmail, normalizeTelegram, telegramError, CHANGEABLE_FIELDS, isChangeableField, changeValueError, submissionSchemaError } from "../lib/validation";

test("parseGithubRepo accepts full URL and short form", () => {
  assert.deepEqual(parseGithubRepo("https://github.com/octocat/hello-world"), { owner: "octocat", repo: "hello-world" });
  assert.deepEqual(parseGithubRepo("octocat/hello-world"), { owner: "octocat", repo: "hello-world" });
  assert.equal(parseGithubRepo("https://example.com/x/y"), null);
});

test("parseGithubPr accepts full URL and short form", () => {
  assert.deepEqual(parseGithubPr("https://github.com/octocat/hello-world/pull/42"), { owner: "octocat", repo: "hello-world", number: 42 });
  assert.deepEqual(parseGithubPr("octocat/hello-world#7"), { owner: "octocat", repo: "hello-world", number: 7 });
  assert.deepEqual(parseGithubPr("https://github.com/octocat/hello-world/pull/42/files"), { owner: "octocat", repo: "hello-world", number: 42 });
  assert.equal(parseGithubPr("https://github.com/octocat/hello-world/issues/42"), null);
  assert.equal(parseGithubPr("https://example.com/x/y"), null);
});

test("parseDriveUrl accepts Drive links only", () => {
  assert.equal(parseDriveUrl("https://drive.google.com/file/d/abc123/view"), "drive.google.com");
  assert.equal(parseDriveUrl("https://docs.google.com/document/d/abc123/edit"), "docs.google.com");
  assert.equal(parseDriveUrl("https://example.com/file"), null);
  assert.equal(parseDriveUrl("not a url"), null);
});

test("blocked hosts rejected", () => {
  assert.equal(isBlockedHost("localhost"), true);
  assert.equal(isBlockedHost("127.0.0.1"), true);
  assert.equal(isBlockedHost("10.0.0.5"), true);
  assert.equal(isBlockedHost("myshop.vercel.app"), false);
});

test("https only", () => {
  assert.equal(isHttpsUrl("https://a.com"), true);
  assert.equal(isHttpsUrl("http://a.com"), false);
});

test("order number format", () => {
  const n = generateOrderNumber();
  assert.match(n, /^ZE-2026-[A-Z2-9]{4}$/);
});

test("email normalize", () => {
  assert.equal(normalizeEmail("  Foo@Bar.COM "), "foo@bar.com");
});

test("telegram: display names accepted (spaces allowed)", () => {
  assert.equal(telegramError("A Data Scientist"), null);
  assert.equal(normalizeTelegram("  A   Data   Scientist  "), "A Data Scientist");
  assert.ok((telegramError("") || "").includes("display name"));
  assert.ok((telegramError("A") || "").includes("too short"));
});

test("changeable fields allowlist excludes identity fields", () => {
  assert.ok(isChangeableField("full_name"));
  assert.ok(isChangeableField("skill_rating"));
  assert.equal(isChangeableField("zedu_id"), false);
  assert.equal(isChangeableField("workspace_email"), false);
  assert.equal(isChangeableField("sub_team"), false);
  assert.equal(isChangeableField("id"), false);
  assert.equal(CHANGEABLE_FIELDS.length, 4);
});

test("changeValueError per field", () => {
  assert.equal(changeValueError("full_name", "Abdul Samad"), null);
  assert.equal(changeValueError("full_name", "A"), "Full name looks too short");
  assert.equal(changeValueError("github_url", "https://github.com/octocat"), null);
  assert.equal(changeValueError("github_url", "https://gitlab.com/octocat"), "GitHub URL must be https://github.com/username");
  assert.equal(changeValueError("telegram_handle", "A Data Scientist"), null);
  assert.ok((changeValueError("telegram_handle", "A") || "").includes("too short"));
  assert.equal(changeValueError("skill_rating", "4"), null);
  assert.equal(changeValueError("skill_rating", "9"), "Skill rating must be 1-5");
  assert.equal(changeValueError("skill_rating", ""), "New value is required");
});

test("submissionSchemaError accepts valid schemas", () => {
  assert.equal(submissionSchemaError([]), null);
  assert.equal(
    submissionSchemaError([
      { key: "deployed_url", label: "Deployed app URL", type: "live_url", required: true },
      { key: "github_repo", label: "Repo", type: "github_repo", hint: "Public repo" },
    ]),
    null
  );
});

test("submissionSchemaError rejects malformed schemas", () => {
  assert.ok((submissionSchemaError("nope") || "").includes("JSON array"));
  assert.ok((submissionSchemaError([{ key: "Bad Key", label: "L", type: "text" }]) || "").includes("snake_case"));
  assert.ok((submissionSchemaError([{ key: "a", label: "", type: "text" }]) || "").includes("needs a label"));
  assert.ok((submissionSchemaError([{ key: "a", label: "L", type: "email" }]) || "").includes("unknown type"));
  assert.ok(
    (submissionSchemaError([
      { key: "a", label: "L", type: "text" },
      { key: "a", label: "L2", type: "text" },
    ]) || "").includes("Duplicate")
  );
  assert.ok((submissionSchemaError([{ key: "a", label: "L", type: "text", required: "yes" }]) || "").includes("required"));
  assert.ok((submissionSchemaError([{ key: "a", label: "L", type: "text", hint: "x".repeat(201) }]) || "").includes("hint"));
  assert.ok(
    (submissionSchemaError(Array.from({ length: 21 }, (_, i) => ({ key: `f${i}`, label: "L", type: "text" }))) || "").includes("20 fields")
  );
});
