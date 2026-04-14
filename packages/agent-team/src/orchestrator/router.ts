import path from "path"
import fs from "fs"
import type { AgentID, MessageEnvelope } from "../protocol/messages.js"
import { Registry } from "./registry.js"

type InboxQueue = MessageEnvelope[]
type DeadLetter = MessageEnvelope & { dead_reason: string }

export class Router {
  private inboxes = new Map<AgentID, InboxQueue>()
  private deadLetters: DeadLetter[] = []
  private idempotencyKeys = new Set<string>()
  private rateLimitCounters = new Map<string, number[]>()
  private maxMessagesPerMinute: number
  private maxHop: number
  private defaultTTL: number
  private dir: string
  private registry: Registry

  constructor(
    registry: Registry,
    dir: string,
    config?: { maxMessagesPerMinute?: number; maxHop?: number; defaultTTL?: number },
  ) {
    this.registry = registry
    this.dir = dir
    this.maxMessagesPerMinute = config?.maxMessagesPerMinute ?? 30
    this.maxHop = config?.maxHop ?? 10
    this.defaultTTL = config?.defaultTTL ?? 86400
  }

  async init(): Promise<void> {
    const inboxDir = path.join(this.dir, "inbox")
    const deadDir = path.join(this.dir, "dead-letter")
    await fs.promises.mkdir(inboxDir, { recursive: true })
    await fs.promises.mkdir(deadDir, { recursive: true })
    await this.loadPersistedInboxes()
  }

  private async loadPersistedInboxes(): Promise<void> {
    const inboxDir = path.join(this.dir, "inbox")
    try {
      const files = await fs.promises.readdir(inboxDir)
      for (const file of files) {
        if (!file.endsWith(".jsonl")) continue
        const agentId = file.replace(".jsonl", "")
        const content = await fs.promises.readFile(path.join(inboxDir, file), "utf-8")
        const lines = content.split("\n").filter((l) => l.trim())
        const queue: InboxQueue = []
        for (const line of lines) {
          try {
            queue.push(JSON.parse(line))
          } catch {}
        }
        if (queue.length > 0) this.inboxes.set(agentId, queue)
      }
    } catch {}
  }

  route(envelope: MessageEnvelope): { ok: true; envelope: MessageEnvelope } | { ok: false; error: string } {
    if (envelope.from === envelope.to) return { ok: false, error: "Cannot send to yourself" }
    if (envelope.hop_count > this.maxHop) return { ok: false, error: "Max hop count exceeded" }
    if (this.idempotencyKeys.has(envelope.idempotency_key)) return { ok: false, error: "Duplicate message" }
    const rlKey = `${envelope.from}->${envelope.to}`
    if (!this.checkRateLimit(rlKey)) return { ok: false, error: "Rate limit exceeded" }
    if (envelope.ttl !== undefined && envelope.ttl <= 0) {
      this.moveToDeadLetter(envelope, "TTL expired")
      return { ok: false, error: "TTL expired" }
    }
    this.idempotencyKeys.add(envelope.idempotency_key)
    if (envelope.to === "broadcast") {
      return this.broadcastInternal(envelope)
    }
    const info = this.registry.getInfo(envelope.to as AgentID)
    if (!info || info.status === "dead") {
      this.moveToDeadLetter(envelope, `Agent ${envelope.to} not found or dead`)
      return { ok: false, error: `Agent ${envelope.to} not found` }
    }
    this.enqueue(envelope.to as AgentID, envelope)
    return { ok: true, envelope }
  }

  broadcast(envelope: MessageEnvelope): { ok: true; envelope: MessageEnvelope } | { ok: false; error: string } {
    if (this.idempotencyKeys.has(envelope.idempotency_key)) return { ok: false, error: "Duplicate message" }
    this.idempotencyKeys.add(envelope.idempotency_key)
    return this.broadcastInternal(envelope)
  }

  private broadcastInternal(
    envelope: MessageEnvelope,
  ): { ok: true; envelope: MessageEnvelope } | { ok: false; error: string } {
    const agents = this.registry.list().filter((a) => a.id !== envelope.from && a.status !== "dead")
    for (const agent of agents) {
      this.enqueue(agent.id, envelope)
    }
    return { ok: true, envelope }
  }

  private enqueue(to: AgentID, msg: MessageEnvelope): void {
    if (!this.inboxes.has(to)) this.inboxes.set(to, [])
    this.inboxes.get(to)!.push(msg)
    this.persistInboxMessage(to, msg)
  }

  private async persistInboxMessage(to: AgentID, msg: MessageEnvelope): Promise<void> {
    const filePath = path.join(this.dir, "inbox", `${to}.jsonl`)
    try {
      await fs.promises.appendFile(filePath, JSON.stringify(msg) + "\n")
    } catch {}
  }

  private moveToDeadLetter(envelope: MessageEnvelope, reason: string): void {
    this.deadLetters.push({ ...envelope, dead_reason: reason })
    const filePath = path.join(this.dir, "dead-letter", `${envelope.to}.jsonl`)
    fs.promises.appendFile(filePath, JSON.stringify({ ...envelope, dead_reason: reason }) + "\n").catch(() => {})
    if (envelope.from) {
      this.enqueue(envelope.from, {
        ...envelope,
        type: "dead_letter",
        from: "orchestrator" as AgentID,
        to: envelope.from,
        payload: { reason, original_envelope: envelope },
      } as MessageEnvelope)
    }
  }

  private checkRateLimit(key: string): boolean {
    const now = Date.now()
    const window = 60000
    let timestamps = this.rateLimitCounters.get(key) ?? []
    timestamps = timestamps.filter((t) => now - t < window)
    if (timestamps.length >= this.maxMessagesPerMinute) {
      this.rateLimitCounters.set(key, timestamps)
      return false
    }
    timestamps.push(now)
    this.rateLimitCounters.set(key, timestamps)
    return true
  }

  drain(agentId: AgentID): MessageEnvelope | undefined {
    const queue = this.inboxes.get(agentId)
    if (!queue || queue.length === 0) return undefined
    const info = this.registry.getInfo(agentId)
    if (!info || info.status !== "idle") return undefined
    return queue.shift()
  }

  clearInbox(agentId: AgentID): void {
    this.inboxes.delete(agentId)
  }

  getInboxSize(agentId: AgentID): number {
    return this.inboxes.get(agentId)?.length ?? 0
  }

  getDeadLetters(): DeadLetter[] {
    return [...this.deadLetters]
  }
}
