import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanName,
  properCase,
  normalizeRepoUrl,
  tsString,
  encodeRepoPath,
  joinRepoPath,
  renderIndexTs,
  renderPageTsx,
  buildArtifacts,
} from "../scripts/lib/contributors";

test("cleanName collapses whitespace and strips control chars", () => {
  assert.equal(cleanName("  A   Data \t Scientist \n"), "A Data Scientist");
  assert.equal(cleanName(null), "");
  assert.equal(cleanName(undefined), "");
  assert.equal(cleanName("x".repeat(200)).length, 120);
});

test("properCase capitalises only lowercase word-initial letters", () => {
  assert.equal(properCase("john doe"), "John Doe");
  assert.equal(properCase("ada lovelace"), "Ada Lovelace");
  // Inner capitals are preserved - never mangle existing names.
  assert.equal(properCase("AbdulJaleel AbdulSamad"), "AbdulJaleel AbdulSamad");
  assert.equal(properCase("ADA LOVELACE"), "ADA LOVELACE");
  assert.equal(properCase("o'neil"), "O'Neil");
});

test("normalizeRepoUrl accepts full URLs and short forms, else empty", () => {
  assert.equal(
    normalizeRepoUrl("https://github.com/octocat/hello-world"),
    "https://github.com/octocat/hello-world"
  );
  assert.equal(
    normalizeRepoUrl("https://github.com/octocat/hello-world/"),
    "https://github.com/octocat/hello-world"
  );
  assert.equal(normalizeRepoUrl("octocat/hello-world"), "https://github.com/octocat/hello-world");
  assert.equal(normalizeRepoUrl("https://github.com/o/r/tree/main"), "");
  assert.equal(normalizeRepoUrl("https://example.com/x/y"), "");
  assert.equal(normalizeRepoUrl("not a repo"), "");
  assert.equal(normalizeRepoUrl(null), "");
  assert.equal(normalizeRepoUrl(""), "");
});

test("tsString escapes quotes and backslashes", () => {
  assert.equal(tsString('He said "hi"'), '"He said \\"hi\\""');
  assert.equal(tsString("C:\\path"), '"C:\\\\path"');
});

test("encodeRepoPath encodes parentheses but keeps separators", () => {
  assert.equal(
    encodeRepoPath("src/app/(homepage)/contributors/egrets"),
    "src/app/%28homepage%29/contributors/egrets"
  );
});

test("joinRepoPath handles trailing and leading slashes", () => {
  assert.equal(
    joinRepoPath("src/app/(homepage)/contributors/egrets/", "/index.ts"),
    "src/app/(homepage)/contributors/egrets/index.ts"
  );
});

test("renderIndexTs emits name + repo rows and excludes timestamps", () => {
  const out = renderIndexTs([
    { name: "Ada Lovelace", repo: "https://github.com/ada/hello" },
    { name: "Grace Hopper", repo: "" },
  ]);
  assert.match(out, /export type Contributor = \{/);
  assert.match(out, /  name: string;/);
  assert.match(out, /  repo: string;/);
  assert.match(
    out,
    /\{ name: "Ada Lovelace", repo: "https:\/\/github\.com\/ada\/hello" \},/
  );
  assert.match(out, /\{ name: "Grace Hopper", repo: "" \},/);
  assert.match(out, /export const contributorCount = contributors.length;/);
  assert.match(out, /export default contributors;/);
  // Determinism: no dates anywhere (would cause churn commits).
  assert.doesNotMatch(out, /\d{4}-\d{2}-\d{2}/);
});

test("renderIndexTs is byte-identical for identical input", () => {
  const entries = [
    { name: "A B", repo: "https://github.com/a/b" },
    { name: "C D", repo: "" },
  ];
  assert.equal(renderIndexTs(entries), renderIndexTs(entries));
});

test("renderIndexTs handles an empty list", () => {
  const out = renderIndexTs([]);
  assert.match(out, /export const contributors: Contributor\[\] = \[\n\n\];/);
});

test("renderPageTsx is a main-site themed page with repo links and no extra deps", () => {
  const out = renderPageTsx();
  assert.match(out, /export const metadata: Metadata/);
  assert.match(out, /canonical: "\/contributors\/egrets"/);
  assert.match(
    out,
    /Zedu <span className="text-primary-500">Egret<\/span> Collaborators/
  );
  assert.match(out, /const ContributorsPage = \(\) => \{/);
  assert.match(out, /export default ContributorsPage;/);
  assert.match(out, /from "\.\/index"/);
  // Only next + the generated ./index may be imported.
  const imports = out.match(/from "[^"]+"/g) || [];
  assert.deepEqual(imports, ['from "next"', 'from "./index"']);
  // Main-site theme (HeroSection / ArticleCard / Button.tsx).
  assert.match(out, /text-primary-500/);
  assert.match(out, /rounded-2xl/);
  assert.match(out, /drop-shadow-md/);
  assert.match(out, /grid-cols-3/);
  assert.match(out, /max-w-7xl/);
  assert.match(out, /rounded-full bg-primary-500/);
  // Member boxes: linked only when a repo exists.
  assert.match(out, /entry\.repo \?/);
  assert.match(out, /href=\{entry\.repo\}/);
  assert.match(out, /target="_blank"/);
  assert.match(out, /rel="noreferrer"/);
  assert.doesNotMatch(out, /emerald/);
  assert.doesNotMatch(out, /\d{4}-\d{2}-\d{2}/);
});

test("buildArtifacts returns both published files", () => {
  const files = buildArtifacts([{ name: "Ada Lovelace", repo: "https://github.com/ada/hello" }]);
  assert.deepEqual(Object.keys(files).sort(), ["index.ts", "page.tsx"]);
  assert.match(files["index.ts"], /Ada Lovelace/);
  assert.match(files["index.ts"], /https:\/\/github\.com\/ada\/hello/);
  assert.match(files["page.tsx"], /contributors\/egrets/);
});