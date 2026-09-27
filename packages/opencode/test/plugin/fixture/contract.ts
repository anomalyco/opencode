import type { PluginInput } from "@opencode-ai/plugin"

export default {
  id: "test.plugin-contract",
  server: async (input: PluginInput, options?: { inputPath: string; writeAuth?: boolean }) => {
    if (!options) throw new Error("fixture requires inputPath option")
    await Bun.write(
      options.inputPath,
      JSON.stringify({
        client: typeof input.client?.auth?.set,
        directory: input.directory,
        worktree: input.worktree,
        project: input.project?.id,
        shell: typeof input.$,
      }),
    )
    return {
      "experimental.chat.messages.transform": async () => {
        if (!options.writeAuth) return
        const result = await input.client.auth.set({
          path: { id: "plugin-contract-write" },
          body: { type: "api", key: "written-by-plugin" },
        })
        if (result.error) throw new Error(String(result.error))
      },
      auth: {
        provider: "plugin-contract",
        methods: [],
        loader: async () => {
          await Bun.write(options.inputPath + ".loader", "called")
          return {
            fetch: async (request: RequestInfo | URL, init?: RequestInit) => {
              const headers = new Headers(init?.headers)
              headers.set("x-plugin-contract", "loaded")
              return fetch(request, { ...init, headers })
            },
          }
        },
      },
    }
  },
}
