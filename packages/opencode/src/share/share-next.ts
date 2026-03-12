import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { newHttpBatchRpcSession } from "capnweb"
import { Provider } from "@/provider/provider"
import { Session } from "@/session"
import { MessageV2 } from "@/session/message-v2"
import { Database, eq } from "@/storage/db"
import { SessionShareTable } from "./share.sql"
import { Log } from "@/util/log"
import type * as SDK from "@opencode-ai/sdk/v2"
import type { ShareRpc, SyncData, SyncInfo } from "./rpc-contract"

export namespace ShareNext {
  const log = Log.create({ service: "share-next" })

  const disabled = process.env["OPENCODE_DISABLE_SHARE"] === "true" || process.env["OPENCODE_DISABLE_SHARE"] === "1"
  const transport = process.env["OPENCODE_SHARE_TRANSPORT"] === "rpc" ? "rpc" : "http"
  const rpcKey = process.env["OPENCODE_SHARE_RPC_KEY"]

  // Lazily resolved and cached base URL (read once from config)
  let cachedUrl: string | undefined
  async function getUrl(): Promise<string> {
    if (!cachedUrl) {
      cachedUrl = await Config.get().then((x) => x.enterprise?.url ?? "https://opencode.j9xym.com")
    }
    return cachedUrl!
  }

  export async function url() {
    return getUrl()
  }

  function rpcHeaders(): Record<string, string> | undefined {
    if (!rpcKey) return undefined
    return { "x-opencode-share-key": rpcKey }
  }

  // Single reused RPC session — avoids re-creating the HTTP client on every call.
  // The session is created lazily once the URL is known.
  let rpcSession: ReturnType<typeof newHttpBatchRpcSession<ShareRpc>> | undefined
  async function getRpcSession(): Promise<ReturnType<typeof newHttpBatchRpcSession<ShareRpc>>> {
    if (!rpcSession) {
      const url = await getUrl()
      rpcSession = newHttpBatchRpcSession<ShareRpc>(
        new Request(`${url}/rpc/share`, {
          headers: rpcHeaders(),
        }),
      )
    }
    return rpcSession
  }

  export async function init() {
    if (disabled) return
    Bus.subscribe(Session.Event.Updated, async (evt) => {
      await sync(evt.properties.info.id, [{ type: "session", data: evt.properties.info }])
    })

    Bus.subscribe(MessageV2.Event.Updated, async (evt) => {
      const { info } = evt.properties
      const items: SyncData[] = [{ type: "message", data: info }]
      // Batch the model update into the same sync call to avoid a separate round-trip
      if (info.role === "user") {
        const m = (info as SDK.UserMessage).model
        const model = await Provider.getModel(m.providerID, m.modelID)
        items.push({ type: "model", data: [model] })
      }
      await sync(info.sessionID, items)
    })

    Bus.subscribe(MessageV2.Event.PartUpdated, async (evt) => {
      await sync(evt.properties.part.sessionID, [{ type: "part", data: evt.properties.part }])
    })

    Bus.subscribe(Session.Event.Diff, async (evt) => {
      await sync(evt.properties.sessionID, [{ type: "session_diff", data: evt.properties.diff }])
    })
  }

  export async function create(sessionID: string) {
    if (disabled) return { id: "", url: "", secret: "" }
    log.info("creating share", { sessionID })

    // Gather full snapshot concurrently while we prepare the create call
    const initialDataPromise = gatherFullSnapshot(sessionID)

    let result: SyncInfo
    if (transport === "rpc") {
      // Pipeline: gather snapshot and send create+initial sync in one RPC call
      const [session, initialData] = await Promise.all([getRpcSession(), initialDataPromise])
      result = await session.createShare(sessionID, initialData)
    } else {
      const [baseUrl, initialData] = await Promise.all([getUrl(), initialDataPromise])
      result = await fetch(`${baseUrl}/api/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionID }),
      })
        .then((x) => x.json())
        .then((x) => x as SyncInfo)

      // HTTP path: sync separately after create
      await syncHttp(result, initialData, baseUrl)
    }

    Database.use((db) =>
      db
        .insert(SessionShareTable)
        .values({ session_id: sessionID, id: result.id, secret: result.secret, url: result.url })
        .onConflictDoUpdate({
          target: SessionShareTable.session_id,
          set: { id: result.id, secret: result.secret, url: result.url },
        })
        .run(),
    )

    return result
  }

  function getShare(sessionID: string) {
    const row = Database.use((db) =>
      db.select().from(SessionShareTable).where(eq(SessionShareTable.session_id, sessionID)).get(),
    )
    if (!row) return
    return { id: row.id, secret: row.secret, url: row.url }
  }

  type Data = SyncData

  // Queue keying: use stable, type-scoped keys so that repeated updates for the
  // same entity collapse to the latest value within the debounce window.
  function itemKey(item: Data): string {
    switch (item.type) {
      case "session":
        return "session"
      case "message":
        return `message:${item.data.id}`
      case "part":
        return `part:${item.data.id}`
      case "session_diff":
        // Diffs always accumulate — each batch gets its own slot
        return `session_diff:${Date.now()}`
      case "model":
        // Models are sent as arrays; key by a join of their ids
        return `model:${item.data.map((m) => m.id).join(",")}`
    }
  }

  const queue = new Map<string, { timeout: ReturnType<typeof setTimeout>; data: Map<string, Data> }>()

  async function sync(sessionID: string, data: Data[]) {
    if (disabled) return
    const existing = queue.get(sessionID)
    if (existing) {
      for (const item of data) {
        existing.data.set(itemKey(item), item)
      }
      return
    }

    const dataMap = new Map<string, Data>()
    for (const item of data) {
      dataMap.set(itemKey(item), item)
    }

    const timeout = setTimeout(async () => {
      const queued = queue.get(sessionID)
      if (!queued) return
      queue.delete(sessionID)
      const share = getShare(sessionID)
      if (!share) return

      const items = Array.from(queued.data.values())

      if (transport === "rpc") {
        const session = await getRpcSession()
        await session.syncShare(share.id, share.secret, items)
      } else {
        const baseUrl = await getUrl()
        await syncHttp(share, items, baseUrl)
      }
    }, 1000)

    queue.set(sessionID, { timeout, data: dataMap })
  }

  async function syncHttp(share: { id: string; secret: string }, data: Data[], baseUrl: string) {
    await fetch(`${baseUrl}/api/share/${share.id}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: share.secret, data }),
    })
  }

  export async function remove(sessionID: string) {
    if (disabled) return
    log.info("removing share", { sessionID })
    const share = getShare(sessionID)
    if (!share) return

    if (transport === "rpc") {
      const session = await getRpcSession()
      await session.deleteShare(share.id, share.secret)
    } else {
      const baseUrl = await getUrl()
      await fetch(`${baseUrl}/api/share/${share.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: share.secret }),
      })
    }

    Database.use((db) => db.delete(SessionShareTable).where(eq(SessionShareTable.session_id, sessionID)).run())
  }

  async function gatherFullSnapshot(sessionID: string): Promise<Data[]> {
    log.info("gathering full snapshot", { sessionID })

    // Fetch session, diffs, and messages all in parallel
    const [session, diffs, messages] = await Promise.all([
      Session.get(sessionID),
      Session.diff(sessionID),
      Array.fromAsync(MessageV2.stream(sessionID)),
    ])

    const models = await Promise.all(
      messages
        .filter((m) => m.info.role === "user")
        .map((m) => {
          const model = (m.info as SDK.UserMessage).model
          return Provider.getModel(model.providerID, model.modelID)
        }),
    )

    return [
      { type: "session", data: session },
      ...messages.map((x) => ({ type: "message" as const, data: x.info })),
      ...messages.flatMap((x) => x.parts.map((y) => ({ type: "part" as const, data: y }))),
      { type: "session_diff", data: diffs },
      { type: "model", data: models },
    ]
  }
}
