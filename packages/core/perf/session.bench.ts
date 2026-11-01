import { bench, script } from "@hona/strobe-bench"

// A scripted agent session through the real SessionStep.attempt, each model response 400 ms after
// the request, with snapshots on (a real store) or off. Compare the two series for what snapshots add
// to a session's wall time; compare base and head for whether a change moved either.
export default bench({
  targets: { core: script("./snapshot.ts") },
  params: { snapshots: ["on", "off"], fixture: { run: ["opencode"], more: ["medium"] } },
  async setup(ctx) {
    await ctx.call("prepare", ctx.params.fixture)
  },
  cases: {
    "an agent session of 15 steps": {
      primary: "run.duration",
      metrics: ["count.git"],
      async run(ctx) {
        ctx.count("git", await ctx.call<number>("session", ctx.params.snapshots, 400))
      },
      reset: (ctx) => ctx.call("resetFixture"),
    },
  },
})
