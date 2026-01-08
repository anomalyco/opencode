import { Bus } from "../bus"
import { Installation } from "../installation"
import { Instance } from "../project/instance"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { Log } from "../util/log"

export namespace Share {
  const log = Log.create({ service: "share" })

  interface ShareState {
    queue: Promise<void>
    pending: Map<string, any>
    subscriptions: (() => void)[]
    abortController: AbortController
    disposed: boolean
  }

  const state = Instance.state<ShareState>(
    () => ({
      queue: Promise.resolve(),
      pending: new Map(),
      subscriptions: [],
      abortController: new AbortController(),
      disposed: false,
    }),
    async (s) => {
      // Perform cleanup inline to avoid calling state() during Instance disposal.
      // Calling state() here could reinitialize after the Instance has been disposed.
      s.disposed = true
      s.abortController.abort()
      for (const unsub of s.subscriptions) {
        unsub()
      }
      s.subscriptions.length = 0
      s.pending.clear()
      s.queue = Promise.resolve()
      log.info("disposed share subscriptions (via Instance)")
    },
  )

  export async function sync(key: string, content: any) {
    const s = state()
    // Skip if already disposed
    if (s.disposed) return
    const signal = s.abortController.signal
    const [root, ...splits] = key.split("/")
    if (root !== "session") return
    const [sub, sessionID] = splits
    if (sub === "share") return
    const share = await Session.getShare(sessionID).catch(() => {})
    if (!share) return
    const { secret } = share
    s.pending.set(key, content)
    s.queue = s.queue
      .then(async () => {
        // Check if disposed before starting fetch
        if (signal.aborted) return
        const content = s.pending.get(key)
        if (content === undefined) return
        s.pending.delete(key)

        return fetch(`${URL}/share_sync`, {
          method: "POST",
          body: JSON.stringify({
            sessionID: sessionID,
            secret,
            key: key,
            content,
          }),
          signal,
        })
      })
      .then((x) => {
        if (x) {
          log.info("synced", {
            key: key,
            status: x.status,
          })
        }
      })
      .catch((err) => {
        // Ignore abort errors during disposal
        if (err.name === "AbortError") return
        log.error("sync error", { key, error: err })
      })
  }

  export function init() {
    // Fully dispose existing share state (subscriptions, pending map, queue, abort controller)
    // before re-init to prevent duplicates and orphaned requests
    dispose()
    const s = state()
    s.subscriptions.push(
      Bus.subscribe(Session.Event.Updated, async (evt) => {
        await sync("session/info/" + evt.properties.info.id, evt.properties.info)
      }),
    )
    s.subscriptions.push(
      Bus.subscribe(MessageV2.Event.Updated, async (evt) => {
        await sync(
          "session/message/" + evt.properties.info.sessionID + "/" + evt.properties.info.id,
          evt.properties.info,
        )
      }),
    )
    s.subscriptions.push(
      Bus.subscribe(MessageV2.Event.PartUpdated, async (evt) => {
        await sync(
          "session/part/" +
            evt.properties.part.sessionID +
            "/" +
            evt.properties.part.messageID +
            "/" +
            evt.properties.part.id,
          evt.properties.part,
        )
      }),
    )
  }

  export function dispose() {
    const s = state()
    // Mark as disposed to prevent new sync operations during cleanup
    s.disposed = true
    // Abort any in-flight fetch requests
    s.abortController.abort()
    // Create a new controller for potential re-init
    s.abortController = new AbortController()
    // Reset disposed flag to allow operations after re-init via init()
    s.disposed = false
    for (const unsub of s.subscriptions) {
      unsub()
    }
    s.subscriptions.length = 0
    s.pending.clear()
    s.queue = Promise.resolve()
    log.info("disposed share subscriptions")
  }

  export const URL =
    process.env["OPENCODE_API"] ??
    (Installation.isPreview() || Installation.isLocal() ? "https://api.dev.opencode.ai" : "https://api.opencode.ai")

  export async function create(sessionID: string) {
    return fetch(`${URL}/share_create`, {
      method: "POST",
      body: JSON.stringify({ sessionID: sessionID }),
    })
      .then((x) => x.json())
      .then((x) => x as { url: string; secret: string })
  }

  export async function remove(sessionID: string, secret: string) {
    return fetch(`${URL}/share_delete`, {
      method: "POST",
      body: JSON.stringify({ sessionID, secret }),
    }).then((x) => x.json())
  }
}
