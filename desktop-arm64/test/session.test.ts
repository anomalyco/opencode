import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { SessionStore } from "../src/core/session.ts";

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "ocarm-sess-"));
}

test("append and load round-trip preserves records", async (t) => {
  const dir = await tmpDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new SessionStore(dir);
  const id = await store.start("fix the build");
  assert.match(id, /^\d{8}-\d{6}-[a-z0-9]+$/);

  await store.append({ ts: 1, kind: "user", payload: { text: "fix the build" } });
  await store.append({
    ts: 2,
    kind: "assistant",
    payload: { text: "ok", toolCalls: [] },
  });

  const records = await store.load(id);
  assert.equal(records.length, 3); // meta + user + assistant
  assert.equal(records[0]!.kind, "meta");
  assert.deepEqual(records[1]!.payload, { text: "fix the build" });
});

test("list returns newest first with titles from meta or first prompt", async (t) => {
  const dir = await tmpDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const older = new SessionStore(dir);
  await older.start("first session title");
  await older.append({ ts: 1, kind: "user", payload: { text: "hello" } });
  // ensure distinct mtimes
  await new Promise((r) => setTimeout(r, 30));

  const newer = new SessionStore(dir);
  await newer.start();
  await newer.append({ ts: 2, kind: "user", payload: { text: "second prompt wins title" } });

  const list = await newer.list();
  assert.equal(list.length, 2);
  assert.match(list[0]!.title, /second prompt wins title/);
  assert.equal(list[1]!.title, "first session title");
});

test("corrupt lines are skipped on load without crashing", async (t) => {
  const dir = await tmpDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new SessionStore(dir);
  const id = await store.start("t");
  await store.append({ ts: 1, kind: "user", payload: { text: "good line" } });
  // Simulate a crash mid-append (partial trailing line):
  await fs.appendFile(store.sessionPath(id), '{"ts":2,"kind":"use', "utf8");

  const records = await store.load(id);
  assert.equal(records.length, 2); // meta + user; partial line skipped
  assert.equal(records[1]!.kind, "user");
});
