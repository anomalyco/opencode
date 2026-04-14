import type { AgentID } from "../protocol/messages.js"
import { Registry } from "./registry.js"
import { AuditLogger } from "./audit.js"

export class Watchdog {
  private registry: Registry
  private audit: AuditLogger
  private heartbeatWarningMs: number
  private zombieTimeoutMs: number
  private interval: ReturnType<typeof setInterval> | null = null
  private onZombie?: (agentId: AgentID) => void

  constructor(
    registry: Registry,
    audit: AuditLogger,
    config?: { heartbeatWarningMs?: number; zombieTimeoutMs?: number },
  ) {
    this.registry = registry
    this.audit = audit
    this.heartbeatWarningMs = config?.heartbeatWarningMs ?? 60000
    this.zombieTimeoutMs = config?.zombieTimeoutMs ?? 120000
  }

  setOnZombie(fn: (agentId: AgentID) => void): void {
    this.onZombie = fn
  }

  async tick(): Promise<{ warned: AgentID[]; zombies: AgentID[] }> {
    const now = Date.now()
    const warned: AgentID[] = []
    const zombies: AgentID[] = []
    for (const agent of this.registry.list()) {
      if (agent.status === "dead" || agent.status === "terminating") continue
      const elapsed = now - agent.last_activity
      if (elapsed > this.zombieTimeoutMs) {
        zombies.push(agent.id)
        await this.handleZombie(agent.id)
      } else if (elapsed > this.heartbeatWarningMs) {
        warned.push(agent.id)
        await this.audit.append({ agent: agent.id, action: "heartbeat.warning", details: { elapsed } })
      }
    }
    return { warned, zombies }
  }

  async handleZombie(agentId: AgentID): Promise<void> {
    this.registry.updateStatus(agentId, "dead")
    await this.audit.append({ agent: agentId, action: "agent.zombie", details: { reason: "heartbeat timeout" } })
    this.onZombie?.(agentId)
  }

  start(intervalMs: number = 30000): void {
    this.stop()
    this.interval = setInterval(() => this.tick(), intervalMs)
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
  }
}
