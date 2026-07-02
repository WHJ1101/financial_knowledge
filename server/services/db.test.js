import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const root = await mkdtemp(join(tmpdir(), "financial-knowledge-db-"));
process.env.FINANCE_KNOWLEDGE_DATA_DIR = root;

const { default: db } = await import("./db.js");

test("adapter normalizes undefined and booleans and keeps changes contract", () => {
  db.exec("CREATE TABLE adapter_params (id TEXT PRIMARY KEY, note TEXT, enabled INTEGER)");
  const result = db.prepare("INSERT INTO adapter_params (id,note,enabled) VALUES (?,?,?)").run("a", undefined, true);

  assert.equal(result.changes, 1);
  assert.deepEqual(db.prepare("SELECT * FROM adapter_params WHERE id=?").get("a"), {
    id: "a",
    note: null,
    enabled: 1
  });
});

test("adapter transaction rolls back all writes on failure", () => {
  db.exec("CREATE TABLE adapter_tx (id TEXT PRIMARY KEY)");
  const tx = db.transaction(() => {
    db.prepare("INSERT INTO adapter_tx (id) VALUES (?)").run("inside-tx");
    throw new Error("boom");
  });

  assert.throws(() => tx(), /boom/);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM adapter_tx").get().count, 0);
});
