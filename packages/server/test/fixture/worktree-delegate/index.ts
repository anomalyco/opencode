import { Plugin } from "@opencode-ai/plugin"

export default Plugin.define({
  id: "test.worktree-delegate",
  async setup(ctx) {
    const directory = ctx.options.directory
    if (typeof directory !== "string") throw new Error("Missing target location")
    await ctx.worktree.create({
      projectID: ctx.location.project.id,
      location: { directory },
      name: "delegated",
    })
  },
})
