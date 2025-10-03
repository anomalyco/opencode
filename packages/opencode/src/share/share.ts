import { Bus } from "../bus"
import { Installation } from "../installation"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { Log } from "../util/log"

export namespace Share {
  const log = Log.create({ service: "share" })

  let queue: Promise<void> = Promise.resolve()
  const pending = new Map<string, any>()
  const attempts = new Map<string, number>()

  export async function sync(key: string, content: any) {
    const [root, ...splits] = key.split("/")
    if (root !== "session") return
    const [sub, sessionID] = splits
    if (sub === "share") return
    const share = await Session.getShare(sessionID).catch(() => {})
    if (!share) return
    const { secret } = share
    pending.set(key, content)
    queue = queue
      .then(async () => {
        await flush(key, sessionID, secret)
      })
      .catch((error) => {
        log.error("sync_failed", {
          key: key,
          error,
        })
      })
  }

  async function flush(key: string, sessionID: string, secret: string) {
    while (true) {
      const payload = pending.get(key)
      if (payload === undefined) {
        attempts.delete(key)
        return
      }

      const attempt = (attempts.get(key) ?? 0) + 1
      attempts.set(key, attempt)

      const response = await fetch(`${URL}/share_sync`, {
        method: "POST",
        body: JSON.stringify({
          sessionID: sessionID,
          secret,
          key: key,
          content: payload,
        }),
      }).catch((error) => error as Error)

      if (response instanceof Error || !response.ok) {
        log.error("sync_retry", {
          key: key,
          attempt,
          error: response instanceof Error ? response : response.status,
        })
        const delay = Math.min(30000, 1000 * 2 ** Math.min(attempt - 1, 5))
        await new Promise((resolve) => setTimeout(resolve, delay))
        continue
      }

      pending.delete(key)
      attempts.delete(key)
      log.info("synced", {
        key: key,
        status: response.status,
      })
      return
    }
  }

  export function init() {
    Bus.subscribe(Session.Event.Updated, async (evt) => {
      await sync("session/info/" + evt.properties.info.id, evt.properties.info)
    })
    Bus.subscribe(MessageV2.Event.Updated, async (evt) => {
      await sync("session/message/" + evt.properties.info.sessionID + "/" + evt.properties.info.id, evt.properties.info)
    })
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
    })
  }

  export const URL =
    process.env["OPENCODE_API"] ??
    (Installation.isSnapshot() || Installation.isDev() ? "https://api.dev.opencode.ai" : "https://api.opencode.ai")

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
