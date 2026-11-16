import type { Session } from "electron"
import { previewScheme } from "../scheme"
import type { PreviewSource } from "../workspace-file"
import { servePreview } from "./serve"

export function createPreviews(session: Session, signal: AbortSignal) {
  signal.throwIfAborted()
  const grants = new Map<string, PreviewSource>()

  const release = (host: string) => {
    if (!grants.delete(host)) return
    void session.clearStorageData({ origin: `${previewScheme}://${host}`, storages: ["localstorage", "indexdb", "cachestorage", "filesystem"] }).catch(() => undefined)
  }

  // File loaders reject for disappearing or unreadable files. Refuse the request without throwing into Electron.
  session.protocol.handle(previewScheme, (request) => servePreview(request, grants).catch(() => Response.error()))
  let active = true

  const dispose = () => {
    if (!active) return
    active = false
    signal.removeEventListener("abort", dispose)
    grants.forEach((_roots, host) => release(host))
    session.protocol.unhandle(previewScheme)
  }

  // Revoke synchronously, before async pane teardown can exceed the plugin host's reload deadline.
  signal.addEventListener("abort", dispose, { once: true })

  return {
    grant(source: PreviewSource, lifetime: AbortSignal) {
      signal.throwIfAborted()
      lifetime.throwIfAborted()
      const host = crypto.randomUUID()
      grants.set(host, source)

      const revoke = () => {
        lifetime.removeEventListener("abort", revoke)
        release(host)
      }

      // Revoke at detach, not after the attachment's asynchronous network finalizers complete.
      lifetime.addEventListener("abort", revoke, { once: true })

      return { host, release: revoke }
    },
    dispose,
  }
}
