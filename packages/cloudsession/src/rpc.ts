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
  constructor(private env: Env) {
    super()
  }

  async createShare(sessionID: string): Promise<SyncInfo> {
    const { sessions, index } = this.storage()
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

    const initialIndex: SessionIndex = {
      id: shareID,
      sessionID,
      title: "",
      directory: "",
      messageCount: 0,
      partCount: 0,
      diffCount: 0,
      modelCount: 0,
      lastUpdated: now,
      syncCount: 0,
      createdAt: now,
    }

    await Promise.all([sessions.put(`share/${shareID}`, initial), index.put(`index/${shareID}`, initialIndex)])
    return info
  }

  async syncShare(shareID: string, secret: string, data: SyncData[]) {
    const { sessions, index } = this.storage()
    const agentSession = await sessions.get(`share/${shareID}`)
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

    for (const item of data) {
      if (item.type === "session") {
        next.session = item.data
        continue
      }

      if (item.type === "message") {
        const idx = next.messages.findIndex((message) => message.id === item.data.id)
        if (idx === -1) {
          next.messages.push(item.data)
          continue
        }
        next.messages[idx] = item.data
        continue
      }

      if (item.type === "part") {
        const idx = next.parts.findIndex((part) => part.id === item.data.id)
        if (idx === -1) {
          next.parts.push(item.data)
          continue
        }
        next.parts[idx] = item.data
        continue
      }

      if (item.type === "session_diff") {
        next.diffs = [...next.diffs, ...item.data]
        continue
      }

      if (item.type === "model") {
        for (const model of item.data) {
          const idx = next.models.findIndex((entry) => entry.id === model.id)
          if (idx === -1) {
            next.models.push(model)
            continue
          }
          next.models[idx] = model
        }
      }
    }

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

    await Promise.all([sessions.put(`share/${shareID}`, next), index.put(`index/${shareID}`, updatedIndex)])

    const doID = this.env.SESSIONS_BROADCAST.idFromName(shareID)
    const stub = this.env.SESSIONS_BROADCAST.get(doID)
    await stub.broadcast(data)

    return { success: true, syncCount: next.metadata.syncCount }
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

  private storage(): { sessions: StorageAdapter<AgentSession>; index: StorageAdapter<SessionIndex> } {
    return {
      sessions: createStorageAdapter<AgentSession>(this.env.SESSIONS_STORE),
      index: createStorageAdapter<SessionIndex>(this.env.SESSIONS_STORE),
    }
  }
}
