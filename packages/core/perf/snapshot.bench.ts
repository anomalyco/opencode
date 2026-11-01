import { bench, script, type Context } from "@hona/strobe-bench"

type Ctx = Context<{ fixture: string }>

// Snapshot work spawns git: its time is the run's wall time (a child's CPU leaves with the child), and
// `count.git` is how many processes it spawned.
const git = (ctx: Ctx, call: string, ...args: unknown[]) =>
  ctx.call<number>(call, ...args).then((n) => ctx.count("git", n))

// What each case needs in place before its first run; `reset` repeats it between runs.
const before: Record<string, (ctx: Ctx) => Promise<unknown>> = {
  "capture after editing a file": (ctx) => ctx.call("edit", 1),
  "capture after adding a file": (ctx) => ctx.call("add"),
  "capture after editing 100 files": (ctx) => ctx.call("edit", 100),
  "list 100 changed files": (ctx) => ctx.call("change"),
  "diff 100 changed files": (ctx) => ctx.call("change"),
  "restore 100 files": async (ctx) => {
    await ctx.call("mark")
    await ctx.call("edit", 100)
  },
  "pack the store": (ctx) => ctx.call("history"),
}

const timed = { primary: "run.duration", metrics: ["count.git"] }

export default bench({
  targets: { core: script("./snapshot.ts") },
  // Generated repositories: 1,000, 20,000 or 100,000 tracked files, or this repository cloned.
  params: { fixture: { run: ["medium"], more: ["small", "large", "opencode"] } },
  async setup(ctx) {
    await ctx.call("prepare", ctx.params.fixture)
    await before[ctx.case]?.(ctx)
  },
  cases: {
    "capture, nothing changed": { ...timed, run: (ctx) => git(ctx, "capture") },
    "capture after editing a file": {
      ...timed,
      run: (ctx) => git(ctx, "capture"),
      reset: (ctx) => ctx.call("edit", 1),
    },
    "capture after adding a file": { ...timed, run: (ctx) => git(ctx, "capture"), reset: (ctx) => ctx.call("add") },
    "capture after editing 100 files": {
      ...timed,
      run: (ctx) => git(ctx, "capture"),
      reset: (ctx) => ctx.call("edit", 100),
    },
    "list 100 changed files": { ...timed, run: (ctx) => git(ctx, "files") },
    "diff 100 changed files": { ...timed, run: (ctx) => git(ctx, "diff") },
    "restore 100 files": { ...timed, run: (ctx) => git(ctx, "restore"), reset: (ctx) => ctx.call("edit", 100) },
    // 20 agent steps: a capture at attempt start and at settlement, changed files listed; one step in
    // five edits two files.
    "agent step loop": { ...timed, run: (ctx) => git(ctx, "agentLoop") },
    // Loose objects of ten captures into a pack; `count.store.kib` is the store's size after.
    "pack the store": {
      primary: "run.duration",
      metrics: ["count.git", "count.store.kib"],
      async run(ctx) {
        const packed = await ctx.call<{ git: number; kib: number }>("pack")
        ctx.count("git", packed.git)
        ctx.count("store.kib", packed.kib)
      },
      reset: (ctx) => ctx.call("unpack"),
    },
  },
})
