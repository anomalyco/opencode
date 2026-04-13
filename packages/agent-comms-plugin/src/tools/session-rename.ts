import { tool } from "@opencode-ai/plugin"

type Deps = {
  client: {
    session: {
      update: (params: {
        path: { id: string }
        body: { title: string }
        query?: { directory?: string }
      }) => Promise<any>
    }
  }
}

export function createSessionRenameTool(deps: Deps) {
  return tool({
    description: "Rename a session by its ID",
    args: {
      session_id: tool.schema.string().describe("The session ID to rename"),
      title: tool.schema.string().describe("New title for the session"),
    },
    async execute(args, ctx) {
      try {
        await deps.client.session.update({
          path: { id: args.session_id },
          body: { title: args.title },
          query: { directory: ctx.directory },
        })
        return `Session "${args.session_id}" renamed to "${args.title}"`
      } catch (err: any) {
        return `Error renaming session: ${err.message}`
      }
    },
  })
}
