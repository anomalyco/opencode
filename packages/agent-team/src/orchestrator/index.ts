import path from "path"
import fs from "fs"
import type { AgentID, AgentInfo } from "../protocol/messages.js"
import { Registry } from "./registry.js"
import { Router } from "./router.js"
import { TaskQueue } from "./task-queue.js"
import { Watchdog } from "./watchdog.js"
import { GC } from "./gc.js"
import { StateManager } from "./state.js"
import { BudgetManager } from "./budget.js"
import { AuditLogger } from "./audit.js"
import { Telemetry } from "./telemetry.js"

type Client = {
  session: {
    create(params?: { directory?: string; title?: string; agent?: string }): Promise<{ data: any }>
    get(params: { sessionID: string; directory?: string }): Promise<{ data: any }>
    prompt(params: {
      sessionID: string
      directory?: string
      agent?: string
      parts: Array<{ type: string; text: string }>
    }): Promise<{
      data?: { info: any; parts: Array<{ type: string; text?: string }> }
      parts?: Array<{ type: string; text?: string }>
    }>
    promptAsync(params: {
      sessionID: string
      directory?: string
      agent?: string
      parts: Array<{ type: string; text: string }>
    }): Promise<{ data: void }>
  }
}

type OrchestratorConfig = {
  maxAgents?: number
  maxConcurrent?: number
  maxDepth?: number
  taskTimeoutSeconds?: number
  heartbeatWarningMs?: number
  zombieTimeoutMs?: number
  dailyLimitUsd?: number
  perAgentDailyUsd?: number
  perTaskMaxUsd?: number
  perTaskMaxTokens?: number
}

export class Orchestrator {
  dir: string
  registry: Registry
  router: Router
  taskQueue: TaskQueue
  watchdog: Watchdog
  gc: GC
  state: StateManager
  budget: BudgetManager
  audit: AuditLogger
  telemetry: Telemetry
  client: Client | null = null
  projectDir: string
  private config: OrchestratorConfig

  constructor(projectRoot: string, config?: OrchestratorConfig) {
    this.config = config ?? {}
    this.projectDir = projectRoot
    this.dir = path.join(projectRoot, ".opencode", "team")
    this.registry = new Registry()
    this.budget = new BudgetManager({
      daily_limit_usd: config?.dailyLimitUsd,
      per_agent_daily_usd: config?.perAgentDailyUsd,
      per_task_max_usd: config?.perTaskMaxUsd,
      per_task_max_tokens: config?.perTaskMaxTokens,
    })
    this.audit = new AuditLogger(this.dir)
    this.router = new Router(this.registry, this.dir, {
      maxMessagesPerMinute: 30,
      maxHop: 10,
    })
    this.taskQueue = new TaskQueue(this.registry, this.budget, {
      maxConcurrent: config?.maxConcurrent,
      maxDepth: config?.maxDepth,
      taskTimeoutSeconds: config?.taskTimeoutSeconds,
    })
    this.watchdog = new Watchdog(this.registry, this.audit, {
      heartbeatWarningMs: config?.heartbeatWarningMs,
      zombieTimeoutMs: config?.zombieTimeoutMs,
    })
    this.gc = new GC(this.dir, this.audit)
    this.state = new StateManager(this.dir)
    this.telemetry = new Telemetry(this.dir)
  }

  setClient(client: Client) {
    this.client = client
  }

  async start(): Promise<void> {
    await fs.promises.mkdir(this.dir, { recursive: true })
    await this.audit.init()
    await this.router.init()
    await this.state.init()
    await this.telemetry.init()
    const recovered = await this.state.recover()
    if (recovered?.agents) {
      this.registry.fromSnapshot(recovered.agents as Record<string, AgentInfo>)
    }
    this.watchdog.setOnZombie((agentId) => this.handleZombie(agentId))
  }

  stop(): void {
    this.watchdog.stop()
    this.gc.stop()
  }

  async spawn(input: {
    agent_id?: AgentID
    role: string
    capabilities: Partial<import("../protocol/messages.js").AgentCapabilities>
    model?: { provider_id: string; model_id: string }
  }): Promise<AgentID> {
    if (this.registry.list().filter((a) => a.status !== "dead").length >= (this.config.maxAgents ?? 10)) {
      throw new Error("Max agents exceeded")
    }
    const id = input.agent_id ?? `agent-${Date.now()}`
    const defaultCaps: import("../protocol/messages.js").AgentCapabilities = {
      tools: input.capabilities.tools ?? ["read", "glob", "grep", "list"],
      read: input.capabilities.read ?? true,
      write_own_workspace: input.capabilities.write_own_workspace ?? true,
      share_to_team: input.capabilities.share_to_team ?? false,
      delegate: input.capabilities.delegate ?? true,
      spawn_subagents: input.capabilities.spawn_subagents ?? false,
      max_delegation_depth: input.capabilities.max_delegation_depth ?? 2,
      disk_quota_mb: input.capabilities.disk_quota_mb ?? 500,
      protected_paths: input.capabilities.protected_paths ?? [],
    }
    const wsPath = path.join(path.dirname(this.dir), "workspaces", `workspace-${id}`)
    await fs.promises.mkdir(wsPath, { recursive: true })

    this.registry.register({
      id,
      role: input.role,
      capabilities: defaultCaps,
      workspace_path: wsPath,
      model: input.model,
    })
    await this.audit.append({ agent: id, action: "agent.spawn", target: wsPath })
    return id
  }

  async ensureSession(agentId: string): Promise<string | undefined> {
    const info = this.registry.getInfo(agentId)
    if (!info || info.status === "dead") return
    if (info.session_id) return info.session_id
    if (!this.client) return

    try {
      const created = await this.client.session.create({
        directory: this.projectDir,
        title: `Agent: ${agentId} (${info.role})`,
      })
      const sid = created.data?.id
      if (sid) {
        const agent = (this.registry as any).agents.get(agentId)
        if (agent) agent.session_id = sid
      }
      return sid
    } catch {
      return undefined
    }
  }

  async terminate(agentId: AgentID, reason: string, gracePeriodMs?: number): Promise<void> {
    const info = this.registry.getInfo(agentId)
    if (!info) return
    this.registry.updateStatus(agentId, "terminating")
    await this.audit.append({ agent: agentId, action: "agent.terminate", details: { reason, gracePeriodMs } })
    this.registry.updateStatus(agentId, "dead")
  }

  list(): AgentInfo[] {
    return this.registry.list()
  }

  getInfo(agentId: AgentID): AgentInfo | undefined {
    return this.registry.getInfo(agentId)
  }

  async promptAgent(agentId: string, prompt: string): Promise<string> {
    const info = this.registry.getInfo(agentId)
    if (!info) throw new Error(`Agent ${agentId} not found`)
    const sid = await this.ensureSession(agentId)
    if (!sid || !this.client) throw new Error(`Agent ${agentId} has no session`)

    const resp = await this.client.session.prompt({
      sessionID: sid,
      directory: this.projectDir,
      parts: [{ type: "text", text: prompt }],
    })
    const parts = resp.data?.parts ?? resp.parts ?? []
    return parts
      .filter((p: any) => p.type === "text" && p.text)
      .map((p: any) => p.text)
      .join("\n")
  }

  async sendToAgent(agentId: string, prompt: string): Promise<void> {
    const info = this.registry.getInfo(agentId)
    if (!info) return
    const sid = await this.ensureSession(agentId)
    if (!sid || !this.client) return
    await this.client.session.promptAsync({
      sessionID: sid,
      directory: this.projectDir,
      parts: [{ type: "text", text: prompt }],
    })
  }

  private async handleZombie(agentId: AgentID): Promise<void> {
    const info = this.registry.getInfo(agentId)
    if (info?.current_task_id) {
      this.taskQueue.cancel(info.current_task_id)
    }
    this.registry.updateStatus(agentId, "dead")
    await this.audit.append({ agent: agentId, action: "agent.crash", details: { reason: "zombie detected" } })
  }
}
