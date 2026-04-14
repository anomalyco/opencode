import type { AgentID, AgentInfo, AgentStatus, AgentCapabilities } from "../protocol/messages.js"

type RegistryAgent = AgentInfo & { registered_at: number }

export class Registry {
  private agents = new Map<AgentID, RegistryAgent>()

  register(
    info: Partial<AgentInfo> & { id: AgentID; role: string; capabilities: AgentCapabilities; workspace_path: string },
  ): AgentInfo {
    if (this.agents.has(info.id)) throw new Error(`Agent ${info.id} already registered`)
    const now = Date.now()
    const agent: RegistryAgent = {
      id: info.id,
      role: info.role,
      role_priority: info.role_priority ?? 10,
      status: "idle",
      capabilities: info.capabilities,
      model: info.model,
      workspace_path: info.workspace_path,
      current_task_id: undefined,
      session_id: info.session_id,
      pid: info.pid,
      connected_at: now,
      last_activity: now,
      tokens_used: { input: 0, output: 0, total: 0 },
      cost_used: 0,
      disk_used_mb: 0,
      active_worktrees: [],
      message_queue_size: 0,
      registered_at: now,
    }
    this.agents.set(info.id, agent)
    return { ...agent }
  }

  deregister(agentId: AgentID): void {
    const agent = this.agents.get(agentId)
    if (!agent) return
    agent.status = "dead"
  }

  updateStatus(agentId: AgentID, status: AgentStatus, taskId?: string): void {
    const agent = this.agents.get(agentId)
    if (!agent) throw new Error(`Agent ${agentId} not found`)
    agent.status = status
    agent.last_activity = Date.now()
    if (taskId !== undefined) agent.current_task_id = taskId
    else if (status === "idle") agent.current_task_id = undefined
  }

  getInfo(agentId: AgentID): AgentInfo | undefined {
    const agent = this.agents.get(agentId)
    return agent ? { ...agent } : undefined
  }

  list(): AgentInfo[] {
    return [...this.agents.values()].map((a) => ({ ...a }))
  }

  findByRole(role: string): AgentInfo[] {
    return this.list().filter((a) => a.role === role)
  }

  findByCapability(capability: string): AgentInfo[] {
    return this.list().filter((a) => a.capabilities.tools.includes(capability))
  }

  findIdle(): AgentInfo[] {
    return this.list().filter((a) => a.status === "idle")
  }

  recordHeartbeat(
    agentId: AgentID,
    heartbeat: {
      status: "idle" | "busy" | "waiting"
      current_task_id?: string
      tokens_used_session?: { input: number; output: number }
    },
  ): void {
    const agent = this.agents.get(agentId)
    if (!agent) throw new Error(`Agent ${agentId} not found`)
    agent.last_activity = Date.now()
    agent.status = heartbeat.status
    agent.current_task_id = heartbeat.current_task_id
    if (heartbeat.tokens_used_session) {
      agent.tokens_used.input = heartbeat.tokens_used_session.input
      agent.tokens_used.output = heartbeat.tokens_used_session.output
      agent.tokens_used.total = heartbeat.tokens_used_session.input + heartbeat.tokens_used_session.output
    }
  }

  incrementTokenUsage(agentId: AgentID, input: number, output: number): void {
    const agent = this.agents.get(agentId)
    if (!agent) throw new Error(`Agent ${agentId} not found`)
    agent.tokens_used.input += input
    agent.tokens_used.output += output
    agent.tokens_used.total += input + output
  }

  toSnapshot(): Record<string, AgentInfo> {
    const snap: Record<string, AgentInfo> = {}
    for (const [id, agent] of this.agents) {
      snap[id] = { ...agent }
    }
    return snap
  }

  fromSnapshot(snap: Record<string, AgentInfo>): void {
    this.agents.clear()
    for (const [id, info] of Object.entries(snap)) {
      this.agents.set(id, { ...info, registered_at: info.connected_at })
    }
  }
}
