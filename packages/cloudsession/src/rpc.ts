import { RpcTarget } from "capnweb"
import { v5 as uuidv5 } from "uuid"
import type { SessionBroadcast as SessionBroadcastType } from "./broadcast.ts"
import type { ProbeCallback, ProbeValueInput, ProbeValueOutput } from "./rpc-contract.ts"
import { createStorageAdapter, type StorageAdapter } from "./storage.ts"
import type { AgentSession, SessionIndex, SyncData, SyncInfo } from "./types.ts"

type Env = {
  SESSIONS_STORE: R2Bucket
  SESSIONS_SHARED_SECRET: string
  API_DOMAIN: string
  SESSIONS_BROADCAST: DurableObjectNamespace<SessionBroadcastType>
}

export class ShareRpcImpl extends RpcTarget {
  private readonly sessions: StorageAdapter<AgentSession>
  private readonly index: StorageAdapter<SessionIndex>

  constructor(private env: Env) {
    super()
    this.sessions = createStorageAdapter<AgentSession>(env.SESSIONS_STORE)
    this.index = createStorageAdapter<SessionIndex>(env.SESSIONS_STORE)
  }

  async createShare(sessionID: string, initialData?: SyncData[]): Promise<SyncInfo> {
    const shareID = sessionID.slice(-8)
    const secret = uuidv5(sessionID, this.env.SESSIONS_SHARED_SECRET)
    const now = Date.now()
    const info: SyncInfo = {
      id: shareID,
      secret,
      url: `https://${this.env.API_DOMAIN}/share/${shareID}`,
    }

    const initial: AgentSession = {
      session: {
        id: sessionID,
        slug: sessionID,
        projectID: "",
        directory: "",
        title: "",
        version: "1",
        time: {
          created: now,
          updated: now,
        },
      },
      messages: [],
      parts: [],
      diffs: [],
      models: [],
      metadata: {
        createdAt: now,
        lastUpdated: now,
        syncCount: 0,
        secret,
        sessionID,
      },
    }

    // Apply any initial data provided (pipeline create+sync into one round trip)
    if (initialData && initialData.length > 0) {
      applyData(initial, initialData)
      initial.metadata.syncCount = 1
    }

    const initialIndex: SessionIndex = {
      id: shareID,
      sessionID,
      title: initial.session.title,
      directory: initial.session.directory,
      messageCount: initial.messages.length,
      partCount: initial.parts.length,
      diffCount: initial.diffs.length,
      modelCount: initial.models.length,
      lastUpdated: now,
      syncCount: initial.metadata.syncCount,
      createdAt: now,
    }

    await Promise.all([
      this.sessions.put(`share/${shareID}`, initial),
      this.index.put(`index/${shareID}`, initialIndex),
    ])
    return info
  }

  async syncShare(shareID: string, secret: string, data: SyncData[]) {
    const agentSession = await this.sessions.get(`share/${shareID}`)
    if (!agentSession) {
      throw new Error("Share not found")
    }

    if (agentSession.metadata.secret !== secret) {
      throw new Error("Invalid secret")
    }

    const now = Date.now()
    const next: AgentSession = {
      ...agentSession,
      metadata: {
        ...agentSession.metadata,
        lastUpdated: now,
        syncCount: agentSession.metadata.syncCount + 1,
      },
    }

    applyData(next, data)

    const updatedIndex: SessionIndex = {
      id: shareID,
      sessionID: next.session.id,
      title: next.session.title,
      directory: next.session.directory,
      messageCount: next.messages.length,
      partCount: next.parts.length,
      diffCount: next.diffs.length,
      modelCount: next.models.length,
      lastUpdated: now,
      syncCount: next.metadata.syncCount,
      createdAt: next.metadata.createdAt,
    }

    await Promise.all([this.sessions.put(`share/${shareID}`, next), this.index.put(`index/${shareID}`, updatedIndex)])

    const doID = this.env.SESSIONS_BROADCAST.idFromName(shareID)
    const stub = this.env.SESSIONS_BROADCAST.get(doID)
    await stub.broadcast(data)

    return { success: true, syncCount: next.metadata.syncCount }
  }

  async deleteShare(shareID: string, secret: string): Promise<{ success: boolean }> {
    const agentSession = await this.sessions.get(`share/${shareID}`)
    if (!agentSession) {
      throw new Error("Share not found")
    }

    if (agentSession.metadata.secret !== secret) {
      throw new Error("Invalid secret")
    }

    await Promise.all([this.sessions.delete(`share/${shareID}`), this.index.delete(`index/${shareID}`)])

    return { success: true }
  }

  probeValue(input: ProbeValueInput): ProbeValueOutput {
    return {
      when: input.when.toISOString(),
      bytes: Array.from(input.bytes),
      size: input.bytes.byteLength,
      nested: input.nested,
    }
  }

  async probeCallback(cb: ProbeCallback): Promise<string> {
    return await cb("server-called")
  }
}

/**
 * Apply a batch of sync data items to an AgentSession in place.
 * Extracted so createShare and syncShare share the same merge logic.
 */
function applyData(session: AgentSession, data: SyncData[]): void {
  for (const item of data) {
    if (item.type === "session") {
      session.session = item.data
      continue
    }

    if (item.type === "message") {
      const idx = session.messages.findIndex((m) => m.id === item.data.id)
      if (idx === -1) {
        session.messages.push(item.data)
      } else {
        session.messages[idx] = item.data
      }
      continue
    }

    if (item.type === "part") {
      const idx = session.parts.findIndex((p) => p.id === item.data.id)
      if (idx === -1) {
        session.parts.push(item.data)
      } else {
        session.parts[idx] = item.data
      }
      continue
    }

    if (item.type === "session_diff") {
      session.diffs = [...session.diffs, ...item.data]
      continue
    }

    if (item.type === "model") {
      for (const model of item.data) {
        const idx = session.models.findIndex((m) => m.id === model.id)
        if (idx === -1) {
          session.models.push(model)
        } else {
          session.models[idx] = model
        }
      }
    }
  }
}
