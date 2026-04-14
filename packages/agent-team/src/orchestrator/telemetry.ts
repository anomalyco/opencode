import path from "path"
import fs from "fs"
import type { AgentID } from "../protocol/messages.js"

type TelemetryEvent = {
  ts: number
  agent: AgentID
  event_type: "task.start" | "task.complete" | "task.fail" | "message.sent" | "message.received"
  duration_ms?: number
  success?: boolean
  metadata?: Record<string, unknown>
}

type AgentStats = {
  total_tasks: number
  completed_tasks: number
  failed_tasks: number
  total_messages: number
  avg_task_duration_ms: number
  cost_total: number
  tokens_total: number
}

export class Telemetry {
  private filePath: string

  constructor(dir: string) {
    this.filePath = path.join(dir, "telemetry.jsonl")
  }

  async init(): Promise<void> {
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true })
  }

  async record(event: Omit<TelemetryEvent, "ts">): Promise<void> {
    const full: TelemetryEvent = { ts: Date.now(), ...event }
    await fs.promises.appendFile(this.filePath, JSON.stringify(full) + "\n")
  }

  async getStats(agentId: AgentID, timeRange?: { since?: number; until?: number }): Promise<AgentStats> {
    const events = await this.readEvents(timeRange)
    const agent = events.filter((e) => e.agent === agentId)
    const tasks = agent.filter((e) => e.event_type.startsWith("task."))
    const completed = tasks.filter((e) => e.event_type === "task.complete")
    const failed = tasks.filter((e) => e.event_type === "task.fail")
    const messages = agent.filter((e) => e.event_type.startsWith("message."))
    const durations = completed.filter((e) => e.duration_ms !== undefined).map((e) => e.duration_ms!)
    const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0
    return {
      total_tasks: tasks.length,
      completed_tasks: completed.length,
      failed_tasks: failed.length,
      total_messages: messages.length,
      avg_task_duration_ms: avgDuration,
      cost_total: 0,
      tokens_total: 0,
    }
  }

  async getDashboard(timeRange?: { since?: number; until?: number }): Promise<Record<AgentID, AgentStats>> {
    const events = await this.readEvents(timeRange)
    const byAgent = new Map<AgentID, TelemetryEvent[]>()
    for (const e of events) {
      if (!byAgent.has(e.agent)) byAgent.set(e.agent, [])
      byAgent.get(e.agent)!.push(e)
    }
    const result: Record<AgentID, AgentStats> = {}
    for (const [agentId, agentEvents] of byAgent) {
      const tasks = agentEvents.filter((e) => e.event_type.startsWith("task."))
      const completed = tasks.filter((e) => e.event_type === "task.complete")
      const failed = tasks.filter((e) => e.event_type === "task.fail")
      const messages = agentEvents.filter((e) => e.event_type.startsWith("message."))
      const durations = completed.filter((e) => e.duration_ms !== undefined).map((e) => e.duration_ms!)
      const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0
      result[agentId] = {
        total_tasks: tasks.length,
        completed_tasks: completed.length,
        failed_tasks: failed.length,
        total_messages: messages.length,
        avg_task_duration_ms: avgDuration,
        cost_total: 0,
        tokens_total: 0,
      }
    }
    return result
  }

  private async readEvents(timeRange?: { since?: number; until?: number }): Promise<TelemetryEvent[]> {
    try {
      const content = await fs.promises.readFile(this.filePath, "utf-8")
      let events = content
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as TelemetryEvent)
      const thirtyDaysAgo = Date.now() - 30 * 86400000
      events = events.filter((e) => e.ts >= thirtyDaysAgo)
      if (timeRange?.since) events = events.filter((e) => e.ts >= timeRange.since!)
      if (timeRange?.until) events = events.filter((e) => e.ts <= timeRange.until!)
      return events
    } catch {
      return []
    }
  }
}
