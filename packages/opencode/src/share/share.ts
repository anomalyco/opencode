import { Bus } from "../bus"
import { Installation } from "../installation"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { Log } from "../util/log"

export namespace Share {
  const log = Log.create({ service: "share" })

  let queue: Promise<void> = Promise.resolve()
  const pending = new Map<string, any>()
  // Generation counter to invalidate in-flight operations from previous init cycles
  let generation = 0
  let disposed = false

  // Store unsubscribe functions for cleanup
  const unsubscribers: Array<() => void> = []

  export async function sync(gen: number, key: string, content: any) {
    // Skip if disposed or wrong generation
    if (disposed || gen !== generation) return
    const [root, ...splits] = key.split("/")
    if (root !== "session") return
    const [sub, sessionID] = splits
    if (sub === "share") return
    const share = await Session.getShare(sessionID).catch(() => {})
    if (!share) return
    // Re-check after async operation
    if (disposed || gen !== generation) return
    const { secret } = share
    pending.set(key, content)
    queue = queue
      .then(async () => {
        // Check at start of queued operation
        if (disposed || gen !== generation) return
        const content = pending.get(key)
        if (content === undefined) return
        pending.delete(key)
        // Final check before network request
        if (disposed || gen !== generation) return

        return fetch(`${URL}/share_sync`, {
          method: "POST",
          body: JSON.stringify({
            sessionID: sessionID,
            secret,
            key: key,
            content,
          }),
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
  }

  export function init() {
    // Clean up any existing subscriptions before adding new ones
    dispose()
    disposed = false
    // Increment generation so in-flight operations from previous cycle are invalidated
    const gen = ++generation

    const unsub1 = Bus.subscribe(Session.Event.Updated, async (evt) => {
      await sync(gen, "session/info/" + evt.properties.info.id, evt.properties.info)
    })
    const unsub2 = Bus.subscribe(MessageV2.Event.Updated, async (evt) => {
      await sync(
        gen,
        "session/message/" + evt.properties.info.sessionID + "/" + evt.properties.info.id,
        evt.properties.info,
      )
    })
    const unsub3 = Bus.subscribe(MessageV2.Event.PartUpdated, async (evt) => {
      await sync(
        gen,
        "session/part/" +
          evt.properties.part.sessionID +
          "/" +
          evt.properties.part.messageID +
          "/" +
          evt.properties.part.id,
        evt.properties.part,
      )
    })
    unsubscribers.push(unsub1, unsub2, unsub3)
  }

  export function dispose() {
    disposed = true
    const toUnsubscribe = unsubscribers.splice(0)
    for (const unsub of toUnsubscribe) {
      try {
        unsub()
      } catch (error) {
        log.error("failed to unsubscribe", { error })
      }
    }
    pending.clear()
    queue = Promise.resolve()
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
