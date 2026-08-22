import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  ToolRegistry,
  compileGlob,
  resolveInsideRoot,
} from "../src/core/tools.ts";
import type { ApprovalHandler } from "../src/core/types.ts";

async function tmpWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "ocarm-tools-"));
}

const allowAll: ApprovalHandler = async () => true;
const denyAll: ApprovalHandler = async () => false;

async function invoke(
  registry: ToolRegistry,
  name: string,
  args: Record<string, unknown>,
  approval: ApprovalHandler = allowAll,
) {
  return registry.invoke({ id: "t", name, arguments: JSON.stringify(args) }, {
    approval,
  });
}

test("glob matcher supports **, *, ?, braces", () => {
  const g1 = compileGlob("src/**/*.ts");
  assert.equal(g1.regex.test("src/a/b/c.ts"), true);
  assert.equal(g1.regex.test("src/main.ts"), true);
  assert.equal(g1.regex.test("lib/main.ts"), false);

  const g2 = compileGlob("*.{ts,tsx}");
  assert.equal(g2.regex.test("app.tsx"), true);
  assert.equal(g2.regex.test("app.js"), false);

  const g3 = compileGlob("file?.txt");
  assert.equal(g3.regex.test("file1.txt"), true);
  assert.equal(g3.regex.test("file10.txt"), false);
});

test("resolveInsideRoot blocks traversal", () => {
  const root = path.resolve(os.tmpdir(), "ws-root");
  assert.throws(() => resolveInsideRoot(root, ".."));
  assert.throws(() => resolveInsideRoot(root, "a/../../b"));
  assert.doesNotThrow(() => resolveInsideRoot(root, "sub/dir/file.txt"));
});

test("read_file returns numbered lines and respects offset/limit", async (t) => {
  const root = await tmpWorkspace();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "notes.txt"), "alpha\nbeta\ngamma\n");
  const registry = new ToolRegistry({ root });
  const res = await invoke(registry, "read_file", { path: "notes.txt" });
  assert.equal(res.isError, false);
  assert.match(res.output, /1: alpha/);
  assert.match(res.output, /3: gamma/);

  const sliced = await invoke(registry, "read_file", {
    path: "notes.txt",
    offset_line: 2,
    limit_lines: 1,
  });
  assert.match(sliced.output, /^2: beta/);
});

test("write then edit file round-trips; uniqueness enforced", async (t) => {
  const root = await tmpWorkspace();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const registry = new ToolRegistry({ root });
  await invoke(registry, "write_file", {
    path: "src/app.ts",
    content: "const a = 1;\nconst b = 1;\n",
  });
  const dup = await invoke(registry, "edit_file", {
    path: "src/app.ts",
    old_string: "1;",
    new_string: "2;",
  });
  assert.equal(dup.isError, true);
  const ok = await invoke(registry, "edit_file", {
    path: "src/app.ts",
    old_string: "const a = 1;",
    new_string: "const a = 9;",
  });
  assert.equal(ok.isError, false);
  const content = await fs.readFile(path.join(root, "src", "app.ts"), "utf8");
  assert.equal(content, "const a = 9;\nconst b = 1;\n");

  const all = await invoke(registry, "edit_file", {
    path: "src/app.ts",
    old_string: "1;",
    new_string: "5;",
    replace_all: true,
  });
  assert.equal(all.isError, false);
  assert.equal(
    await fs.readFile(path.join(root, "src", "app.ts"), "utf8"),
    "const a = 9;\nconst b = 5;\n",
  );
});

test("mutating tools require approval unless yolo", async (t) => {
  const root = await tmpWorkspace();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const registry = new ToolRegistry({ root });
  const denied = await invoke(
    registry,
    "write_file",
    { path: "x.txt", content: "hi" },
    denyAll,
  );
  assert.equal(denied.isError, true);
  assert.match(denied.output, /denied/);

  let asked = 0;
  const counting: ApprovalHandler = async () => {
    asked++;
    return true;
  };
  await invoke(registry, "write_file", { path: "x.txt", content: "hi" }, counting);
  assert.equal(asked, 1);

  const yolo = new ToolRegistry({ root, yolo: true });
  const auto = await invoke(yolo, "write_file", { path: "y.txt", content: "!" }, denyAll);
  assert.equal(auto.isError, false);
});

test("read-only tools never trigger approval", async (t) => {
  const root = await tmpWorkspace();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "a.txt"), "hello world\n");
  const registry = new ToolRegistry({ root });
  for (const [name, args] of [
    ["read_file", { path: "a.txt" }],
    ["list_dir", {}],
    ["glob", { pattern: "*.txt" }],
    ["grep", { pattern: "world" }],
  ] as Array<[string, Record<string, unknown>]>) {
    const calls: unknown[] = [];
    const spy: ApprovalHandler = async (req) => {
      calls.push(req);
      return false;
    };
    const res = await invoke(registry, name, args, spy);
    assert.equal(calls.length, 0, `${name} should not need approval`);
    assert.equal(res.isError, false, `${name} failed: ${res.output}`);
  }
});

test("grep and glob find workspace content, skipping node_modules/.git", async (t) => {
  const root = await tmpWorkspace();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
  await fs.writeFile(path.join(root, "needle.txt"), "findme here\n");
  await fs.writeFile(
    path.join(root, "code.ts"),
    "// findme in code\nexport {};\n",
  );
  await fs.writeFile(
    path.join(root, "node_modules", "pkg", "i.js"),
    "findme ignored\n",
  );

  const registry = new ToolRegistry({ root });
  const grepRes = await invoke(registry, "grep", { pattern: "findme" });
  assert.equal(grepRes.isError, false);
  assert.match(grepRes.output, /needle\.txt:1/);
  assert.match(grepRes.output, /code\.ts:1/);
  assert.doesNotMatch(grepRes.output, /node_modules/);

  const globRes = await invoke(registry, "glob", { pattern: "**/*.ts" });
  assert.match(globRes.output, /^code\.ts$/m);
});

test(
  "run_command executes cmd.exe with timeout kill",
  { timeout: 30_000 },
  async (t) => {
    const root = await tmpWorkspace();
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const registry = new ToolRegistry({ root });

    const echo = await invoke(registry, "run_command", {
      command: "echo hello-arm",
    });
    assert.equal(echo.isError, false);
    assert.match(echo.output, /hello-arm/);

    const slow = await invoke(registry, "run_command", {
      command: "ping -n 10 127.0.0.1",
      timeout_ms: 1500,
    });
    assert.equal(slow.isError, true);
    assert.match(slow.output, /timed out/);

    const failing = await invoke(registry, "run_command", {
      command: "exit /b 7",
    });
    assert.equal(failing.isError, true);
    assert.match(failing.output, /exit code 7/);
  },
);

test("unknown tool and bad JSON produce error results, not throws", async (t) => {
  const root = await tmpWorkspace();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const registry = new ToolRegistry({ root });
  const unknown = await registry.invoke(
    { id: "1", name: "nope", arguments: "{}" },
    { approval: allowAll },
  );
  assert.equal(unknown.isError, true);
  const badJson = await registry.invoke(
    { id: "2", name: "read_file", arguments: "{not json" },
    { approval: allowAll },
  );
  assert.equal(badJson.isError, true);
  assert.match(badJson.output, /invalid arguments JSON/);
});
