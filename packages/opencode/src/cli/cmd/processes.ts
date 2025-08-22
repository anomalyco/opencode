import { Config } from "../../config/config"
import { ProcessMonitor } from "../../util/process_monitor"

export const description = "Monitor and manage LSP and MCP processes"

export interface Args {
  action: "stats" | "monitor" | "kill" | "health"
  interval?: number
}

export async function handler(args: Args) {
  await Config.get() // Initialize config

  switch (args.action) {
    case "stats":
      await ProcessMonitor.printStats()
      break

    case "monitor":
      const interval = args.interval || 30000
      console.log(`Starting continuous monitoring (interval: ${interval}ms)`)
      console.log("Press Ctrl+C to stop")

      const stopMonitoring = await ProcessMonitor.monitorContinuously(interval)

      process.on("SIGINT", () => {
        console.log("\nStopping monitoring...")
        stopMonitoring()
        process.exit(0)
      })
      break

    case "kill":
      console.log("Killing all LSP and MCP processes...")
      await ProcessMonitor.killAllProcesses()
      console.log("Done.")
      break

    case "health":
      const health = await ProcessMonitor.healthCheck()
      console.log(`\nHealth Status: ${health.healthy ? "✅ HEALTHY" : "❌ ISSUES DETECTED"}`)

      if (health.issues.length > 0) {
        console.log("\nIssues:")
        for (const issue of health.issues) {
          console.log(`  - ${issue}`)
        }
      }

      console.log(`\nSummary:`)
      console.log(`  LSP: ${health.stats.lsp.totalProcesses} processes, ${health.stats.lsp.clients} clients`)
      console.log(
        `  MCP: ${health.stats.mcp.totalClients} clients (${health.stats.mcp.clientsByType.local} local, ${health.stats.mcp.clientsByType.remote} remote)`,
      )

      if (!health.healthy) {
        process.exit(1)
      }
      break

    default:
      console.error(`Unknown action: ${args.action}`)
      console.log("Available actions: stats, monitor, kill, health")
      process.exit(1)
  }
}
