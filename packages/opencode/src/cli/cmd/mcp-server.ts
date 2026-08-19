import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { ServerAuth } from "@/server/auth"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"

export const McpServerCommand = effectCmd({
  command: "mcp-server",
  describe: "start opencode as an MCP server (for Claude Code and other MCP clients)",
  builder: (yargs) =>
    withNetworkOptions(yargs)
      .option("transport", {
        describe: "transport type",
        type: "string",
        choices: ["stdio", "streamable-http", "sse"] as const,
        default: "stdio",
      })
      .option("path", {
        describe: "HTTP path for streamable-http/sse transport",
        type: "string",
        default: "/mcp",
      })
      .option("cwd", {
        describe: "working directory",
        type: "string",
        default: process.cwd(),
      }),
  handler: Effect.fn("Cli.mcp-server")(function* (args) {
    const { Server } = yield* Effect.promise(() => import("@/server/server"))
    const { McpServerAgent } = yield* Effect.promise(() => import("@/mcp-server/agent"))
    process.env.OPENCODE_CLIENT = "mcp-server"
    const opts = yield* resolveNetworkOptions(args)
    const server = yield* Effect.promise(() => Server.listen(opts))

    const sdk = createOpencodeClient({
      baseUrl: `http://${server.hostname}:${server.port}`,
      headers: ServerAuth.headers(),
    })

    const transport = args.transport ?? "stdio"
    const mcpOptions = {
      transport,
      port: transport !== "stdio" ? (args.port ?? 3001) : undefined,
      hostname: transport !== "stdio" ? opts.hostname : undefined,
      path: args.path,
    }

    const agent = McpServerAgent.init({ sdk })
    const handle = yield* Effect.promise(() => agent.start(mcpOptions))

    yield* Effect.logInfo("MCP server started", { transport, hostname: handle.hostname, port: handle.port })

    if (transport === "stdio") {
      process.stdout.write(`MCP server started on stdio\n`)
    } else {
      process.stdout.write(`MCP server started on ${transport} at ${handle.hostname}:${handle.port}${args.path}\n`)
      const authHeader = ServerAuth.header()
      if (authHeader) process.stdout.write(`Authorization header: ${authHeader}\n`)
    }

    yield* Effect.promise(() =>
      new Promise<void>((resolve, reject) => {
        process.on("SIGINT", resolve)
        process.on("SIGTERM", resolve)
        process.on("unhandledRejection", reject)
      }),
    )

    yield* Effect.promise(() => handle.stop())
  }),
})
