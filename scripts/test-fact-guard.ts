import assert from "node:assert/strict";
import { checkFacts } from "../src/lib/content-skills/fact-guard";
const orig = "صبينا سقف فيلا عبدون 12×15 م، مساحة 320 م² على طابقين. للتواصل 0781142003 — عطاء ع/2026/45";
assert.ok(checkFacts(orig, "فيلا عبدون: سقف 12×15 م بمساحة 320 م² وطابقين. ع/2026/45 — 0781142003", ["فيلا عبدون"]).ok, "same facts reworded");
let r = checkFacts(orig, "صبينا سقف فيلا عبدون بمساحة 350 م² على 3 طوابق. 0781142003", ["فيلا عبدون"]);
assert.ok(!r.ok && r.missing.some((m) => m.includes("320")) && r.missing.some((m) => m.includes("12×15")) && r.added.some((a) => a.includes("350")), JSON.stringify(r));
r = checkFacts(orig, "صبينا سقف 12×15 م، 320 م² على طابقين. 0781142003 ع/2026/45", ["فيلا عبدون"]);
assert.ok(r.missing.includes("اسم «فيلا عبدون»"), "project name dropped");
console.log("✅ fact guard OK");
