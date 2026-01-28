import { Server } from "../../server/server"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "../../flag/flag"
import * as prompts from "@clack/prompts"

type Decision = "allow" | "confirm" | "deny"

function normalizeHost(input: string) {
  const trimmed = input.trim()
  if (!trimmed) return ""
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) return trimmed.slice(1, -1).toLowerCase()
  return trimmed.toLowerCase()
}

function isLoopbackHost(hostname: string) {
  const host = normalizeHost(hostname)
  if (!host) return true
  return host === "127.0.0.1" || host === "localhost" || host === "::1"
}

export function serveSecurityDecision(input: { hostname: string; passwordSet: boolean; yes?: boolean; isTTY: boolean }) {
  if (input.passwordSet) return "allow" as const
  if (isLoopbackHost(input.hostname)) return "allow" as const
  if (input.yes) return "allow" as const
  return input.isTTY ? ("confirm" as const) : ("deny" as const)
}

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) =>
    withNetworkOptions(yargs).option("yes", {
      alias: "y",
      type: "boolean",
      describe: "skip confirmation prompts",
      default: false,
    }),
  describe: "starts a headless opencode server",
  handler: async (args) => {
    const opts = await resolveNetworkOptions(args as any)
    const passwordSet = !!Flag.OPENCODE_SERVER_PASSWORD
    const decision = serveSecurityDecision({
      hostname: opts.hostname,
      passwordSet,
      yes: (args as any).yes,
      isTTY: !!process.stdin.isTTY,
    })

    if (!passwordSet) {
      console.log("Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.")
    }

    if (decision === "deny") {
      console.error("Refusing to start an unsecured server on a non-loopback hostname.")
      console.error("Set OPENCODE_SERVER_PASSWORD, or pass --yes to explicitly accept this risk.")
      process.exitCode = 1
      return
    }

    if (decision === "confirm") {
      prompts.intro("Start unsecured server?")
      prompts.log.warn(`Hostname: ${opts.hostname}`)
      prompts.log.warn("OPENCODE_SERVER_PASSWORD is not set; anyone who can reach this host can access the server.")
      const confirm = await prompts.confirm({
        message: "Start anyway?",
        initialValue: false,
      })
      if (!confirm || prompts.isCancel(confirm)) {
        prompts.outro("Cancelled")
        return
      }
      prompts.outro("Starting server")
    }

    const server = Server.listen(opts)
    console.log(`opencode server listening on http://${server.hostname}:${server.port}`)
    await new Promise(() => {})
    await server.stop()
  },
})
