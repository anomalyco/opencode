import { Plugin, Worktree } from "@opencode-ai/plugin"

export default Plugin.define({
  id: "test.worktree",
  async setup(ctx) {
    const id = typeof ctx.options.strategy === "string" ? ctx.options.strategy : "test-copy"
    await ctx.worktree.transform((editor) =>
      editor.add({
        id,
        async create(input, { signal }) {
          await git(
            input.sourceDirectory,
            ["worktree", "add", "--detach", "--", input.directory, input.branch ?? "HEAD"],
            signal,
          )
          await ctx.storage.set(`tree:${input.directory}`, input.sourceDirectory)
          return { directory: input.directory }
        },
        async remove(input, { signal }) {
          await git(
            input.directory,
            ["worktree", "remove", ...(input.force ? ["--force"] : []), input.directory],
            signal,
            !input.force,
          )
          await ctx.storage.remove(`tree:${input.directory}`)
        },
        async list(sourceDirectory, { signal }) {
          signal.throwIfAborted()
          const rows = await ctx.storage.scan({ prefix: "tree:" })
          return rows.entries
            .filter((row) => row.value === sourceDirectory)
            .map((row) => ({ directory: row.key.slice(5), type: "worktree" as const }))
        },
      }),
    )
  },
})

async function git(directory: string, args: string[], signal: AbortSignal, forceRequired = false) {
  const child = Bun.spawn(["git", "-C", directory, ...args], { stdout: "pipe", stderr: "pipe", signal })
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
  if (code !== 0) throw new Worktree.OperationError({ message: stderr, forceRequired })
}
