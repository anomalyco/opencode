import { LSP } from "../lsp"
import { MCP } from "../mcp"
import { Log } from "../util/log"

export namespace ProcessMonitor {
  const log = Log.create({ service: "process-monitor" })

  export interface SystemStats {
    lsp: {
      totalProcesses: number
      processByServer: Record<string, number>
      clients: number
      brokenServers: number
      processes: Array<{
        key: string
        serverID: string
        pid: number
        refCount: number
        ageMinutes: number
        idleMinutes: number
      }>
    }
    mcp: {
      totalClients: number
      clientsByType: { local: number; remote: number }
      clients: Array<{
        name: string
        type: string
        ageMinutes: number
        idleMinutes: number
        restartCount: number
      }>
    }
    timestamp: string
  }

  export async function getSystemStats(): Promise<SystemStats> {
    const [lspStats, mcpStats] = await Promise.all([LSP.getProcessStats(), MCP.getClientStats()])

    return {
      lsp: lspStats,
      mcp: mcpStats,
      timestamp: new Date().toISOString(),
    }
  }

  export async function printStats() {
    const stats = await getSystemStats()

    console.log("\n=== Process Monitor Statistics ===")
    console.log(`Timestamp: ${stats.timestamp}`)

    console.log("\n--- LSP Servers ---")
    console.log(`Total Processes: ${stats.lsp.totalProcesses}`)
    console.log(`Active Clients: ${stats.lsp.clients}`)
    console.log(`Broken Servers: ${stats.lsp.brokenServers}`)

    if (Object.keys(stats.lsp.processByServer).length > 0) {
      console.log("\nProcesses by Server:")
      for (const [server, count] of Object.entries(stats.lsp.processByServer)) {
        console.log(`  ${server}: ${count} processes`)
      }
    }

    if (stats.lsp.processes.length > 0) {
      console.log("\nActive Processes:")
      for (const proc of stats.lsp.processes) {
        console.log(
          `  ${proc.serverID} (PID: ${proc.pid}) - RefCount: ${proc.refCount}, Age: ${proc.ageMinutes}m, Idle: ${proc.idleMinutes}m`,
        )
      }
    }

    console.log("\n--- MCP Servers ---")
    console.log(`Total Clients: ${stats.mcp.totalClients}`)
    console.log(`Local: ${stats.mcp.clientsByType.local}, Remote: ${stats.mcp.clientsByType.remote}`)

    if (stats.mcp.clients.length > 0) {
      console.log("\nActive Clients:")
      for (const client of stats.mcp.clients) {
        console.log(
          `  ${client.name} (${client.type}) - Age: ${client.ageMinutes}m, Idle: ${client.idleMinutes}m, Restarts: ${client.restartCount}`,
        )
      }
    }

    console.log("=====================================\n")
  }

  export async function killAllProcesses() {
    log.info("Killing all LSP and MCP processes")

    try {
      await LSP.killAllProcesses()
      log.info("All LSP processes killed")
    } catch (error) {
      log.error("Failed to kill LSP processes", { error })
    }

    try {
      await MCP.restartAllClients()
      log.info("All MCP clients restarted")
    } catch (error) {
      log.error("Failed to restart MCP clients", { error })
    }
  }

  export async function monitorContinuously(intervalMs: number = 30000) {
    log.info(`Starting continuous monitoring (interval: ${intervalMs}ms)`)

    // Print initial stats
    await printStats()

    const interval = setInterval(async () => {
      try {
        await printStats()

        // Check for potential issues
        const stats = await getSystemStats()

        // Alert if too many LSP processes
        if (stats.lsp.totalProcesses > 10) {
          log.warn(`High LSP process count detected: ${stats.lsp.totalProcesses}`)
        }

        // Alert if processes are very old (indicating potential leaks)
        const oldProcesses = stats.lsp.processes.filter((p) => p.ageMinutes > 60)
        if (oldProcesses.length > 0) {
          log.warn(`Found ${oldProcesses.length} LSP processes older than 1 hour`)
        }

        // Alert if MCP clients have high restart counts
        const flakyClients = stats.mcp.clients.filter((c) => c.restartCount > 5)
        if (flakyClients.length > 0) {
          log.warn(`Found ${flakyClients.length} MCP clients with high restart counts`)
        }
      } catch (error) {
        log.error("Error during monitoring", { error })
      }
    }, intervalMs)

    // Return cleanup function
    return () => {
      clearInterval(interval)
      log.info("Stopped continuous monitoring")
    }
  }

  export async function healthCheck(): Promise<{
    healthy: boolean
    issues: string[]
    stats: SystemStats
  }> {
    const stats = await getSystemStats()
    const issues: string[] = []

    // Check for LSP issues
    if (stats.lsp.totalProcesses > 20) {
      issues.push(`Too many LSP processes: ${stats.lsp.totalProcesses}`)
    }

    if (stats.lsp.brokenServers > 0) {
      issues.push(`${stats.lsp.brokenServers} broken LSP servers`)
    }

    const highRefCountProcesses = stats.lsp.processes.filter((p) => p.refCount > 10)
    if (highRefCountProcesses.length > 0) {
      issues.push(`${highRefCountProcesses.length} LSP processes with high reference counts`)
    }

    const veryOldProcesses = stats.lsp.processes.filter((p) => p.ageMinutes > 120)
    if (veryOldProcesses.length > 0) {
      issues.push(`${veryOldProcesses.length} LSP processes older than 2 hours`)
    }

    // Check for MCP issues
    const highRestartClients = stats.mcp.clients.filter((c) => c.restartCount > 10)
    if (highRestartClients.length > 0) {
      issues.push(`${highRestartClients.length} MCP clients with excessive restarts`)
    }

    return {
      healthy: issues.length === 0,
      issues,
      stats,
    }
  }
}
