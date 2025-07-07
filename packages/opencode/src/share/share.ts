import { Bus } from "../bus"
import { Installation } from "../installation"
import { Session } from "../session"
import { Storage } from "../storage/storage"
import { Log } from "../util/log"

export namespace Share {
  const log = Log.create({ service: "share" })

  let queue: Promise<void> = Promise.resolve()
  const pending = new Map<string, any>()

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
        const content = pending.get(key)
        if (content === undefined) return
        pending.delete(key)

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
    Bus.subscribe(Storage.Event.Write, async (payload) => {
      await sync(payload.properties.key, payload.properties.content)
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
