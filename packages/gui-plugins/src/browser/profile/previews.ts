import type { Session } from "electron"
import { previewScheme } from "../scheme"
import type { PreviewSource } from "../workspace-file"
import { servePreview } from "./serve"
import { FileVerificationError } from "@opencode/util/file-verification"

export function createPreviews(session: Session, signal: AbortSignal) {
  signal.throwIfAborted()
  const grants = new Map<string, PreviewSource>()
  const failures = new Map<string, string>()

  const release = (host: string) => {
    if (!grants.delete(host)) return
    failures.delete(host)
    void session.clearStorageData({ origin: `${previewScheme}://${host}`, storages: ["localstorage", "indexdb", "cachestorage", "filesystem"] }).catch(() => undefined)
  }

  // File loaders reject for disappearing or unreadable files. Refuse the request without throwing into Electron.
  session.protocol.handle(previewScheme, (request) => {
    const host = new URL(request.url).host

    if (failures.get(host) === request.url) failures.delete(host)

    return servePreview(request, grants).catch((error) => {
      if (error instanceof FileVerificationError && grants.has(host)) failures.set(host, request.url)

      return Response.error()
    })
  })
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
    failure(url: string) {
      if (!URL.canParse(url)) return
      const request = new URL(url)
      request.hash = ""

      return failures.get(request.host) === request.href ? FileVerificationError.code : undefined
    },
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
