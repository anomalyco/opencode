/**
 * Differential corpus for the snapshot engine. Run the same file from two worktrees
 * and compare the JSON: tree IDs, changed-file lists, diffs, and post-restore
 * worktree digests must be byte-identical.
 *
 *   bun run script/snapshot-parity.ts <result.json> [scenario...]
 */
import { $ } from "bun"
import crypto from "crypto"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Effect, Layer, Logger, ManagedRuntime } from "effect"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { Location } from "../src/location"
import { AbsolutePath, RelativePath } from "../src/schema"
import { Snapshot } from "../src/snapshot"
import { Global } from "@opencode/util/global"

const root = path.join(process.env.SNAPSHOT_BENCH_ROOT ?? os.tmpdir(), "opencode-snapshot-parity")

// User-level Git configuration reaches every snapshot command, so the corpus runs under several.
const variants: Record<string, string | undefined> = {
  user: undefined,
  empty: "",
  "split index": "[core]\n\tsplitIndex = true\n",
  "skip hash": "[index]\n\tskipHash = true\n[feature]\n\tmanyFiles = true\n",
  "autocrlf and no untracked cache": "[core]\n\tautocrlf = true\n\tuntrackedCache = false\n",
  fsmonitor: "[core]\n\tfsmonitor = true\n",
  "template hook": "[init]\n\ttemplateDir = TEMPLATE\n",
}
const variant = process.env.PARITY_CONFIG ?? "user"
if (variants[variant] !== undefined) {
  await fs.mkdir(root, { recursive: true })
  const template = path.join(root, `template-${process.pid}`)
  await fs.mkdir(path.join(template, "hooks"), { recursive: true })
  await fs.writeFile(path.join(template, "hooks", "post-checkout"), '#!/bin/sh\necho "checkout $3" > .hooklog\n', {
    mode: 0o755,
  })
  // Stores are created with `git init`, so template ignore rules must keep applying to them.
  await fs.mkdir(path.join(template, "info"), { recursive: true })
  await fs.writeFile(path.join(template, "info", "exclude"), "template-ignored/\n")
  const config = path.join(root, `gitconfig-${process.pid}`)
  await fs.writeFile(config, variants[variant]!.replace("TEMPLATE", template))
  process.env.GIT_CONFIG_GLOBAL = config
}

const env = {
  ...process.env,
  GIT_ALLOW_PROTOCOL: "file",
  GIT_AUTHOR_NAME: "Parity",
  GIT_AUTHOR_EMAIL: "parity@opencode.test",
  GIT_COMMITTER_NAME: "Parity",
  GIT_COMMITTER_EMAIL: "parity@opencode.test",
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
}

type Context = {
  readonly dir: string
  readonly write: (file: string, content: string | Uint8Array) => Promise<void>
  readonly remove: (file: string) => Promise<void>
  readonly git: (args: string[], cwd?: string) => Promise<string>
  readonly capture: (label: string, location?: string) => Promise<void>
  readonly files: (from: string, to: string) => Promise<void>
  readonly diff: (from: string, to: string, paths?: string[]) => Promise<void>
  readonly restore: (label: string, files: Record<string, string>) => Promise<void>
  readonly digest: (label: string) => Promise<void>
}

type Scenario = (ctx: Context) => Promise<void>

const commit = async (ctx: Context, message = "initial") => {
  await ctx.git(["add", "-A"])
  await ctx.git(["commit", "-q", "--no-gpg-sign", "--allow-empty", "-m", message])
}

const scenarios: Record<string, Scenario> = {
  async basic(ctx) {
    await ctx.write("a.txt", "a\n")
    await ctx.write("b.txt", "b\n")
    await ctx.write("dir/c.txt", "c\n")
    await commit(ctx)
    await ctx.capture("t0")
    await ctx.write("a.txt", "a2\n")
    await ctx.remove("b.txt")
    await ctx.write("dir/new.txt", "new\n")
    await ctx.capture("t1")
    await ctx.capture("t1-again")
    await ctx.files("t0", "t1")
    await ctx.diff("t0", "t1")
    await ctx.diff("t0", "t1", ["a.txt"])
    await ctx.restore("undo", { "a.txt": "t0", "b.txt": "t0", "dir/new.txt": "t0" })
    await ctx.capture("t2")
    await ctx.files("t0", "t2")
  },

  async "rename directory"(ctx) {
    for (let i = 0; i < 20; i++) await ctx.write(`src/f${i}.ts`, `${i}\n`)
    await commit(ctx)
    await ctx.capture("t0")
    await fs.rename(path.join(ctx.dir, "src"), path.join(ctx.dir, "lib"))
    await ctx.capture("t1")
    await ctx.files("t0", "t1")
    await ctx.diff("t0", "t1")
  },

  async "file becomes directory"(ctx) {
    await ctx.write("a", "file\n")
    await ctx.write("keep.txt", "keep\n")
    await commit(ctx)
    await ctx.capture("t0")
    await ctx.remove("a")
    await ctx.write("a/b", "nested\n")
    await ctx.capture("t1")
    await ctx.files("t0", "t1")
    await ctx.restore("undo", { a: "t0", "a/b": "t0" })
    await ctx.capture("t2")
  },

  async "directory becomes file"(ctx) {
    await ctx.write("d/x", "x\n")
    await ctx.write("d/y", "y\n")
    await commit(ctx)
    await ctx.capture("t0")
    await ctx.remove("d")
    await ctx.write("d", "file now\n")
    await ctx.capture("t1")
    await ctx.files("t0", "t1")
    await ctx.restore("undo", { "d/x": "t0", "d/y": "t0", d: "t0" })
    await ctx.capture("t2")
  },

  async "embedded repository"(ctx) {
    await ctx.write("top.txt", "top\n")
    await commit(ctx)
    await ctx.capture("t0")
    await ctx.write("sub/inner.txt", "inner\n")
    await ctx.git(["init", "-q"], path.join(ctx.dir, "sub"))
    await ctx.git(["add", "-A"], path.join(ctx.dir, "sub"))
    await ctx.git(["commit", "-q", "--no-gpg-sign", "-m", "inner"], path.join(ctx.dir, "sub"))
    await ctx.capture("t1")
    await ctx.write("sub/inner.txt", "changed\n")
    await ctx.capture("t2")
    await ctx.git(["commit", "-q", "--no-gpg-sign", "-am", "inner 2"], path.join(ctx.dir, "sub"))
    await ctx.capture("t3")
    await ctx.files("t0", "t3")
    await ctx.diff("t0", "t3")
  },

  async symlinks(ctx) {
    await ctx.write("target.txt", "target\n")
    await ctx.write("dir/inside.txt", "inside\n")
    await ctx.write("plain.txt", "plain\n")
    await commit(ctx)
    await ctx.capture("t0")
    await fs.symlink("target.txt", path.join(ctx.dir, "link"))
    await fs.symlink("dir", path.join(ctx.dir, "dirlink"))
    await fs.symlink("missing", path.join(ctx.dir, "dangling"))
    await ctx.remove("plain.txt")
    await fs.symlink("target.txt", path.join(ctx.dir, "plain.txt"))
    await ctx.capture("t1")
    await ctx.write("target.txt", "target 2\n")
    await ctx.capture("t2")
    await ctx.files("t0", "t2")
    await ctx.diff("t0", "t2")
    await ctx.restore("undo", { link: "t0", dirlink: "t0", dangling: "t0", "plain.txt": "t0", "target.txt": "t0" })
    await ctx.capture("t3")
  },

  async "executable bit"(ctx) {
    await ctx.write("run.sh", "echo hi\n")
    await commit(ctx)
    await ctx.capture("t0")
    await fs.chmod(path.join(ctx.dir, "run.sh"), 0o755)
    await ctx.capture("t1")
    await ctx.files("t0", "t1")
    await ctx.diff("t0", "t1")
    await ctx.restore("undo", { "run.sh": "t0" })
    await ctx.capture("t2")
  },

  async "special names"(ctx) {
    const names = [
      "with space.txt",
      "caf\u00e9.txt",
      "cafe\u0301-nfd.txt",
      'quote"s.txt',
      "-rf",
      ":colon.txt",
      "!bang.txt",
      "#hash.txt",
      "app/[slug]/page.tsx",
      "star*.txt",
      "q?.txt",
      "back\\slash.txt",
      "tab\tname.txt",
      "new\nline.txt",
      "\u65e5\u672c\u8a9e/\u30d5\u30a1\u30a4\u30eb.txt",
    ]
    for (const name of names) await ctx.write(name, `${name}\n`)
    await commit(ctx)
    await ctx.capture("t0")
    for (const name of names) await ctx.write(name, `${name} changed\n`)
    await ctx.write("added [x].txt", "added\n")
    await ctx.capture("t1")
    await ctx.files("t0", "t1")
    await ctx.diff("t0", "t1")
    await ctx.restore("undo", Object.fromEntries([...names, "added [x].txt"].map((name) => [name, "t0"])))
    await ctx.capture("t2")
  },

  async "ignore rules"(ctx) {
    await ctx.write(".gitignore", "*.log\nbuild/\n!keep.log\n")
    await ctx.write("keep.log", "keep\n")
    await ctx.write("src/a.ts", "a\n")
    await ctx.write("build/forced.txt", "forced\n")
    await ctx.git(["add", "-A"])
    await ctx.git(["add", "-f", "build/forced.txt"])
    await ctx.git(["commit", "-q", "--no-gpg-sign", "-m", "initial"])
    await ctx.write(".git/info/exclude", "secret/\n*.local\n")
    await ctx.capture("t0")
    await ctx.write("debug.log", "ignored\n")
    await ctx.write("keep.log", "keep 2\n")
    await ctx.write("build/forced.txt", "forced 2\n")
    await ctx.write("build/out.js", "out\n")
    await ctx.write("secret/key.txt", "key\n")
    await ctx.write("config.local", "local\n")
    await ctx.write("template-ignored/x.txt", "template\n")
    await ctx.write("src/a.ts", "a2\n")
    await ctx.capture("t1")
    await ctx.files("t0", "t1")
    await ctx.diff("t0", "t1")
    await ctx.write(".git/info/exclude", "")
    await ctx.capture("t2")
    await ctx.files("t1", "t2")
  },

  async "gitignore changes"(ctx) {
    await ctx.write("gen/out.txt", "1\n")
    await ctx.write("src.txt", "src\n")
    await commit(ctx)
    await ctx.capture("t0")
    await ctx.write(".gitignore", "gen/\n")
    await ctx.write("gen/out.txt", "2\n")
    await ctx.capture("t1")
    await ctx.files("t0", "t1")
    await ctx.write(".gitignore", "")
    await ctx.capture("t2")
    await ctx.files("t1", "t2")
  },

  async "large files"(ctx) {
    await ctx.write("tracked.bin", "small\n")
    await commit(ctx)
    await ctx.capture("t0")
    await ctx.write("big.bin", new Uint8Array(3 * 1024 * 1024).fill(7))
    await ctx.write("tracked.bin", new Uint8Array(3 * 1024 * 1024).fill(9))
    await ctx.capture("t1")
    await ctx.files("t0", "t1")
    await ctx.write("big.bin", "now small\n")
    await ctx.capture("t2")
    await ctx.files("t1", "t2")
  },

  async "line endings"(ctx) {
    await ctx.write(".gitattributes", "* text=auto\n*.bat eol=crlf\n")
    await ctx.write("unix.txt", "one\ntwo\n")
    await commit(ctx)
    await ctx.capture("t0")
    await ctx.write("unix.txt", "one\r\ntwo\r\nthree\r\n")
    await ctx.write("run.bat", "echo\r\n")
    await ctx.capture("t1")
    await ctx.files("t0", "t1")
    await ctx.diff("t0", "t1")
    await ctx.restore("undo", { "unix.txt": "t0", "run.bat": "t0" })
    await ctx.digest("after-undo")
  },

  async "merge conflict in source"(ctx) {
    await ctx.write("c.txt", "base\n")
    await commit(ctx)
    await ctx.git(["checkout", "-q", "-b", "other"])
    await ctx.write("c.txt", "other\n")
    await commit(ctx, "other")
    await ctx.git(["checkout", "-q", "-"])
    await ctx.write("c.txt", "main\n")
    await commit(ctx, "main")
    await ctx.git(["merge", "-q", "other"]).catch(() => "")
    await ctx.capture("t0")
    await ctx.write("c.txt", "resolved\n")
    await ctx.capture("t1")
    await ctx.files("t0", "t1")
  },

  async "case-only rename"(ctx) {
    await ctx.write("Readme.md", "readme\n")
    await commit(ctx)
    await ctx.capture("t0")
    await fs.rename(path.join(ctx.dir, "Readme.md"), path.join(ctx.dir, "README.md"))
    await ctx.capture("t1")
    await ctx.files("t0", "t1")
    await ctx.write("README.md", "changed\n")
    await ctx.capture("t2")
    await ctx.files("t0", "t2")
  },

  async "location subdirectory"(ctx) {
    await ctx.write("pkg/a.txt", "a\n")
    await ctx.write("other/b.txt", "b\n")
    await commit(ctx)
    await ctx.capture("t0", "pkg")
    await ctx.write("pkg/a.txt", "a2\n")
    await ctx.write("pkg/new.txt", "new\n")
    await ctx.write("other/b.txt", "b2\n")
    await ctx.capture("t1", "pkg")
    await ctx.files("t0", "t1")
    await ctx.capture("t2", ".")
    await ctx.files("t1", "t2")
    await ctx.capture("t3", "pkg")
    await ctx.files("t2", "t3")
  },

  async "many untracked"(ctx) {
    await ctx.write("seed.txt", "seed\n")
    await commit(ctx)
    for (let i = 0; i < 3000; i++) await ctx.write(`gen/d${i % 30}/f${i}.txt`, `${i}\n`)
    await ctx.capture("t0")
    await ctx.capture("t0-again")
  },

  async "empty directories and delete all"(ctx) {
    await ctx.write("a/b/c.txt", "c\n")
    await ctx.write("d.txt", "d\n")
    await commit(ctx)
    await ctx.capture("t0")
    await fs.mkdir(path.join(ctx.dir, "empty/nested"), { recursive: true })
    await ctx.capture("t1")
    await ctx.remove("a")
    await ctx.remove("d.txt")
    await ctx.capture("t2")
    await ctx.files("t0", "t2")
    await ctx.restore("undo", { "a/b/c.txt": "t0", "d.txt": "t0" })
    await ctx.capture("t3")
  },

  async "restore with overlapping paths"(ctx) {
    await ctx.write("a", "file a\n")
    await commit(ctx)
    await ctx.capture("t0")
    await ctx.remove("a")
    await ctx.write("a/b", "nested b\n")
    await ctx.capture("t1")
    await ctx.remove("a")
    await ctx.write("a", "file again\n")
    await ctx.capture("t2")
    await ctx.restore("order-1", { a: "t0", "a/b": "t0" })
    await ctx.restore("order-2", { "a/b": "t1", a: "t1" })
    await ctx.restore("order-3", { a: "t1", "a/b": "t1" })
    await ctx.restore("order-4", { "a/b": "t0", a: "t2" })
  },

  async "restore from several trees"(ctx) {
    await ctx.write("x.txt", "x0\n")
    await ctx.write("y.txt", "y0\n")
    await commit(ctx)
    await ctx.capture("t0")
    await ctx.write("x.txt", "x1\n")
    await ctx.write("z.txt", "z1\n")
    await ctx.capture("t1")
    await ctx.write("x.txt", "x2\n")
    await ctx.write("y.txt", "y2\n")
    await ctx.write("z.txt", "z2\n")
    await ctx.write("w.txt", "w2\n")
    await ctx.restore("mixed", { "x.txt": "t1", "y.txt": "t0", "z.txt": "t0", "w.txt": "t1" })
  },

  async "staged changes in source"(ctx) {
    await ctx.write("a.txt", "a\n")
    await commit(ctx)
    await ctx.write("a.txt", "staged\n")
    await ctx.write("new.txt", "staged new\n")
    await ctx.git(["add", "-A"])
    await ctx.write("a.txt", "worktree\n")
    await ctx.capture("t0")
    await ctx.write("a.txt", "worktree 2\n")
    await ctx.capture("t1")
    await ctx.files("t0", "t1")
  },

  async "binary and replaced types"(ctx) {
    await ctx.write("img.bin", new Uint8Array([0, 1, 2, 3, 0, 255]))
    await ctx.write("f.txt", "file\n")
    await commit(ctx)
    await ctx.capture("t0")
    await ctx.write("img.bin", new Uint8Array([0, 9, 9, 3, 0, 255, 1]))
    await ctx.remove("f.txt")
    await fs.symlink("img.bin", path.join(ctx.dir, "f.txt"))
    await ctx.capture("t1")
    await ctx.files("t0", "t1")
    await ctx.diff("t0", "t1")
    await ctx.remove("f.txt")
    await ctx.write("f.txt", "file\n")
    await ctx.capture("t2")
    await ctx.files("t0", "t2")
  },

  async "sparse checkout source"(ctx) {
    await ctx.write("in/a.txt", "a\n")
    await ctx.write("out/b.txt", "b\n")
    await commit(ctx)
    await ctx.git(["sparse-checkout", "set", "in"])
    await ctx.capture("t0")
    await ctx.write("in/a.txt", "a2\n")
    await ctx.write("in/new.txt", "new\n")
    await ctx.capture("t1")
    await ctx.files("t0", "t1")
  },

  async "unreadable file"(ctx) {
    await ctx.write("ok.txt", "ok\n")
    await commit(ctx)
    await ctx.capture("t0")
    await ctx.write("locked.txt", "locked\n")
    await fs.chmod(path.join(ctx.dir, "locked.txt"), 0o000)
    await ctx.capture("t1")
    await fs.chmod(path.join(ctx.dir, "locked.txt"), 0o644)
    await ctx.capture("t2")
    await ctx.files("t0", "t2")
  },

  async "no commits yet"(ctx) {
    await ctx.write("a.txt", "a\n")
    await ctx.capture("t0")
    await ctx.git(["add", "a.txt"])
    await ctx.write("b.txt", "b\n")
    await ctx.capture("t1")
    await ctx.files("t0", "t1")
  },

  async "special files"(ctx) {
    await ctx.write("a.txt", "a\n")
    await commit(ctx)
    await ctx.capture("t0")
    await $`mkfifo ${path.join(ctx.dir, "pipe")}`.quiet()
    await ctx.capture("t1")
    await ctx.remove("pipe")
    await ctx.capture("t2")
    await ctx.files("t0", "t2")
  },

  async "tracked submodule"(ctx) {
    const other = path.join(path.dirname(ctx.dir), "library")
    await fs.mkdir(other)
    await ctx.git(["init", "-q"], other)
    await fs.writeFile(path.join(other, "lib.txt"), "lib\n")
    await ctx.git(["add", "-A"], other)
    await ctx.git(["commit", "-q", "--no-gpg-sign", "-m", "lib"], other)
    await ctx.git(["-c", "protocol.file.allow=always", "submodule", "add", "-q", other, "vendor/library"])
    // The absolute temporary URL differs between runs; pin it so trees are comparable.
    await ctx.git(["config", "-f", ".gitmodules", "submodule.vendor/library.url", "../library"])
    await commit(ctx)
    await ctx.capture("t0")
    await ctx.write("vendor/library/lib.txt", "changed\n")
    await ctx.capture("t1")
    await ctx.git(["commit", "-q", "--no-gpg-sign", "-am", "bump"], path.join(ctx.dir, "vendor/library"))
    await ctx.capture("t2")
    await ctx.files("t0", "t2")
    await ctx.diff("t0", "t2")
  },

  async "index flags in source"(ctx) {
    await ctx.write("assumed.txt", "a\n")
    await ctx.write("skipped.txt", "s\n")
    await ctx.write("plain.txt", "p\n")
    await commit(ctx)
    await ctx.git(["update-index", "--assume-unchanged", "assumed.txt"])
    await ctx.git(["update-index", "--skip-worktree", "skipped.txt"])
    await ctx.write("intent.txt", "intent\n")
    await ctx.git(["add", "-N", "intent.txt"])
    await ctx.capture("t0")
    await ctx.write("assumed.txt", "a2\n")
    await ctx.write("skipped.txt", "s2\n")
    await ctx.write("intent.txt", "intent 2\n")
    await ctx.write("plain.txt", "p2\n")
    await ctx.capture("t1")
    await ctx.files("t0", "t1")
  },

  async "restore key spellings"(ctx) {
    await ctx.write("Readme.md", "readme\n")
    await ctx.write("dir/a.txt", "a\n")
    await ctx.write("dir/b.txt", "b\n")
    await ctx.write("caf\u00e9.txt", "nfc\n")
    await commit(ctx)
    await ctx.capture("t0")
    await ctx.write("Readme.md", "changed\n")
    await ctx.write("dir/a.txt", "a2\n")
    await ctx.write("dir/c.txt", "c2\n")
    await ctx.write("caf\u00e9.txt", "nfc 2\n")
    await ctx.restore("case", { "readme.md": "t0" })
    await ctx.restore("directory", { dir: "t0" })
    await ctx.restore("nfd", { "cafe\u0301.txt": "t0" })
    await ctx.restore("dot-slash", { "./Readme.md": "t0" })
  },

  async "large batched restore"(ctx) {
    for (let i = 0; i < 300; i++) await ctx.write(`src/m${i % 7}/f${i}.ts`, `export const v = ${i}\n`)
    await commit(ctx)
    await ctx.capture("t0")
    for (let i = 0; i < 300; i += 2) await ctx.write(`src/m${i % 7}/f${i}.ts`, `changed ${i}\n`)
    for (let i = 0; i < 50; i++) await ctx.write(`src/new/n${i}.ts`, `new ${i}\n`)
    for (let i = 1; i < 300; i += 3) await ctx.remove(`src/m${i % 7}/f${i}.ts`)
    await ctx.capture("t1")
    await ctx.files("t0", "t1")
    const changed = await Promise.resolve().then(async () => {
      const files: Record<string, string> = {}
      for (let i = 0; i < 300; i++) files[`src/m${i % 7}/f${i}.ts`] = "t0"
      for (let i = 0; i < 50; i++) files[`src/new/n${i}.ts`] = "t0"
      return files
    })
    await ctx.restore("all", changed)
    await ctx.capture("t2")
    await ctx.files("t0", "t2")
  },

  async "restore blocked by a file"(ctx) {
    await ctx.write("a/b.txt", "b\n")
    await ctx.write("z.txt", "z\n")
    await commit(ctx)
    await ctx.capture("t0")
    await ctx.remove("a")
    await ctx.write("a", "now a file\n")
    await ctx.write("z.txt", "z2\n")
    await ctx.restore("blocked", { "a/b.txt": "t0", "z.txt": "t0" })
  },

  async "location with pattern characters"(ctx) {
    await ctx.write("app/[id]/page.tsx", "page\n")
    await ctx.write("app/i/other.tsx", "other\n")
    await commit(ctx)
    await ctx.capture("t0", "app/[id]")
    await ctx.write("app/[id]/page.tsx", "page 2\n")
    await ctx.write("app/i/other.tsx", "other 2\n")
    await ctx.capture("t1", "app/[id]")
    await ctx.files("t0", "t1")
  },

  async "restore paths absent from both sides"(ctx) {
    await ctx.write("a.txt", "a\n")
    await commit(ctx)
    await ctx.capture("t0")
    await ctx.restore("missing", { "never.txt": "t0", "gone/deep/x.txt": "t0" })
    await ctx.write("later.txt", "later\n")
    await ctx.restore("remove-later", { "later.txt": "t0" })
  },
}

async function run(name: string, scenario: Scenario) {
  const base = await fs.realpath(await fs.mkdtemp(path.join(root, "case-")))
  const dir = path.join(base, "project")
  const data = path.join(base, "data")
  await fs.mkdir(dir, { recursive: true })
  const git = (args: string[], cwd = dir) =>
    $`git -c core.fsmonitor=false -c core.splitIndex=false -c init.defaultBranch=main ${args}`
      .cwd(cwd)
      .env(env)
      .quiet()
      .text()
  await git(["init", "-q"])
  const log: unknown[] = []
  const trees = new Map<string, Snapshot.ID | undefined>()
  // One long-lived runtime per Location, as in production, so in-process caches are exercised.
  const runtimes = new Map<string, ManagedRuntime.ManagedRuntime<Snapshot.Service, never>>()
  const runtime = (location = ".") => {
    const existing = runtimes.get(location)
    if (existing) return existing
    const created = ManagedRuntime.make(
      Layer.provide(snapshotLayer(data, path.join(dir, location)), Logger.layer([])) as Layer.Layer<Snapshot.Service>,
    )
    runtimes.set(location, created)
    return created
  }
  const use = <A>(location: string | undefined, body: (snapshot: Snapshot.Interface) => Effect.Effect<A, unknown>) =>
    runtime(location)
      .runPromise(
        Effect.gen(function* () {
          return yield* body(yield* Snapshot.Service)
        }).pipe(Effect.exit),
      )
      .then((exit) => (exit._tag === "Success" ? { ok: exit.value } : { error: true }))
  const tree = (label: string) => {
    const id = trees.get(label)
    if (!id) throw new Error(`no tree ${label}`)
    return id
  }
  const ctx: Context = {
    dir,
    write: async (file, content) => {
      await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true })
      await fs.writeFile(path.join(dir, file), content)
    },
    remove: (file) => fs.rm(path.join(dir, file), { recursive: true, force: true }),
    git,
    capture: async (label, location) => {
      const result = await use(location, (snapshot) => snapshot.capture())
      const id = "ok" in result ? result.ok : undefined
      trees.set(label, id)
      log.push({ capture: label, tree: id ?? null, entries: id ? await listing(data, id) : null })
    },
    files: async (from, to) => {
      if (!trees.get(from) || !trees.get(to)) return void log.push({ files: [from, to], skipped: true })
      log.push({ files: [from, to], result: await use(undefined, (s) => s.files({ from: tree(from), to: tree(to) })) })
    },
    diff: async (from, to, paths) => {
      if (!trees.get(from) || !trees.get(to)) return void log.push({ diff: [from, to], skipped: true })
      const result = await use(undefined, (s) =>
        s.diff({ from: tree(from), to: tree(to), paths: paths?.map((file) => RelativePath.make(file)) }),
      )
      log.push({
        diff: [from, to, paths ?? null],
        result:
          "ok" in result && result.ok
            ? result.ok.map((file) => ({
                ...file,
                patch: crypto.createHash("sha1").update(file.patch).digest("hex"),
              }))
            : result,
      })
    },
    restore: async (label, files) => {
      const plan = new Map(
        Object.entries(files).flatMap(([file, from]) => {
          const id = trees.get(from)
          return id ? [[RelativePath.make(file), id] as const] : []
        }),
      )
      const result = await use(undefined, (s) => s.restore({ files: plan }))
      log.push({ restore: label, result: "ok" in result ? "ok" : result, worktree: await digest(dir) })
    },
    digest: async (label) => {
      log.push({ digest: label, worktree: await digest(dir) })
    },
  }
  const failure = await scenario(ctx).then(
    () => undefined,
    (error: unknown) => String(error),
  )
  if (failure) log.push({ scenarioError: failure })
  await Promise.all([...runtimes.values()].map((item) => item.dispose()))
  await $`chmod -R u+rwX ${base}`.quiet().nothrow()
  if (process.env.PARITY_KEEP) console.error(`kept ${base}`)
  if (!process.env.PARITY_KEEP) await fs.rm(base, { recursive: true, force: true })
  return log
}

function snapshotLayer(data: string, directory: string) {
  return AppNodeBuilder.build(Snapshot.node, [
    Location.node.replace(Location.boundNode(Location.Ref.make({ directory: AbsolutePath.make(directory) }))),
    Global.node.replace(Global.layerWith({ data, config: path.join(data, "config") })),
  ])
}

/** The recursive listing of a captured tree, read from whichever snapshot store holds it. */
async function listing(data: string, tree: string) {
  const stores = (await $`find ${path.join(data, "snapshot")} -mindepth 2 -maxdepth 2 -type d`.quiet().text())
    .split("\n")
    .filter(Boolean)
  for (const store of stores) {
    const result = await $`git --git-dir ${store} ls-tree -r -z ${tree}`.quiet().nothrow()
    if (result.exitCode === 0) return result.stdout.toString().split("\0").filter(Boolean)
  }
  return null
}

/** Paths, types, modes, and content hashes of the worktree, excluding `.git`. */
async function digest(dir: string) {
  const entries: string[] = []
  const walk = async (current: string) => {
    for (const entry of (await fs.readdir(current, { withFileTypes: true })).toSorted((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      const full = path.join(current, entry.name)
      const relative = path.relative(dir, full)
      if (relative === ".git" || relative.startsWith(".git/")) continue
      const stat = await fs.lstat(full)
      if (stat.isSymbolicLink()) entries.push(`L ${relative} -> ${await fs.readlink(full)}`)
      else if (stat.isDirectory()) {
        entries.push(`D ${relative}`)
        await walk(full)
      } else {
        const content = await fs.readFile(full).catch(() => Buffer.from("<unreadable>"))
        entries.push(
          `F ${relative} ${stat.mode & 0o111 ? "x" : "-"} ${crypto.createHash("sha1").update(content).digest("hex")}`,
        )
      }
    }
  }
  await walk(dir)
  return entries
}

await fs.mkdir(root, { recursive: true })
const [outputFile, ...selected] = process.argv.slice(2)
const output: Record<string, unknown> = {}
for (const [name, scenario] of Object.entries(scenarios)) {
  if (selected.length && !selected.includes(name)) continue
  output[name] = await run(name, scenario)
}
await Bun.write(outputFile!, JSON.stringify(output, null, 2))
