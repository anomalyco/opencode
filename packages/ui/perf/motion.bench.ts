import { bench, script } from "@hona/strobe-bench"

export default bench({
  targets: { ui: script("./motion.ts") },
  cases: {
    // One second of animation for 1,000 springs.
    "1,000 springs for 60 frames": {
      primary: "cpu.work",
      async run(ctx) {
        await ctx.call("frames", 60)
      },
    },
  },
})
