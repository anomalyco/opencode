import { bench, script } from "@hona/strobe-bench"

export default bench({
  targets: { core: script("./location.ts") },
  cases: {
    // A request for a directory the server already serves.
    "load a cached location": {
      primary: "cpu.work",
      async run(ctx) {
        await ctx.call("load")
      },
    },
    // The first request after the directory's graph was dropped (a config change, an idle eviction).
    "load a location": {
      primary: "cpu.work",
      async run(ctx) {
        await ctx.call("load")
      },
      async reset(ctx) {
        await ctx.call("invalidate")
      },
    },
    // What one more open directory keeps alive in a long-running server.
    "keep a location graph": {
      primary: "js.heap.retained",
      metrics: ["cpu.work"],
      async run(ctx) {
        await ctx.call("keepLocation")
      },
    },
    "keep a models.dev plugin instance": {
      primary: "js.heap.retained",
      metrics: ["cpu.work"],
      async run(ctx) {
        await ctx.call("keepPlugin")
      },
    },
  },
  async setup(ctx) {
    // The first load pays for module and database setup once; a cold case starts dropped.
    await ctx.call("load")
    if (ctx.case === "load a location") await ctx.call("invalidate")
  },
})
