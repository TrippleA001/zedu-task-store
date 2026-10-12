import test from "node:test";
import assert from "node:assert/strict";
import { ROSTER_TABLE_BY_SLUG, rosterTableForSlug } from "../lib/roster";

test("each org resolves to its own roster table", () => {
  assert.equal(rosterTableForSlug("zedu-egret"), "roster");
  assert.equal(rosterTableForSlug("zedu-neo"), "roster_neo");
  assert.equal(rosterTableForSlug("brand-new-org"), null);
  assert.equal(rosterTableForSlug(""), null);
  assert.equal(rosterTableForSlug(undefined), null);
  assert.deepEqual(Object.values(ROSTER_TABLE_BY_SLUG), ["roster", "roster_neo"]);
});
