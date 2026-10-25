import { Plugin } from "@opencode/plugin"

export default Plugin.define({
  id: "test.worktree-delegate",
  async setup(ctx) {
    const projectID = ctx.options.projectID ?? ctx.location.project.id
    if (typeof projectID !== "string") throw new Error("Missing target project")
    await ctx.worktree.create({
      projectID,
      name: "delegated",
    })
  },
})
