import { relative } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"
import { openPreviewFile, previewAllowed, previewRoot } from "@opencode/util/preview-scope"
import type { createPreviews } from "./profile/previews"
import type { WorkspaceSource } from "./workspace-file"
import { fileURLWithin } from "./policy"
import { previewAddress, previewFile } from "./preview"
import { remotePath } from "./remote-address"
import { FileVerificationError } from "@opencode/util/file-verification"

/** Only main's explicit load mints an origin. Page navigation and history can use but never enlarge its grant. */
export function workspacePages(
  previews: ReturnType<typeof createPreviews>,
  root: string,
  source: WorkspaceSource,
  lifetime: AbortSignal,
  guarded: () => Extract<WorkspaceSource, { type: "remote" }> | undefined,
  previousRoot?: string,
) {
  const grants = new Map<string, { document: string; identity: string; reader: WorkspaceSource; release(): void }>()
  let lastRoot = previousRoot
  let exposed = false
  let disposed = false
  const remote = source.type === "remote" ? source.prefix : undefined
  const roots = source.type === "local" ? [root] : []

  const path = (address: string) =>
    remote
      ? remotePath(address, remote)
      : fileURLWithin(address, roots)
        ? relative(root, fileURLToPath(address)).replaceAll("\\", "/")
        : undefined

  return {
    used: () => exposed,
    identity: () => lastRoot,
    async load(address: string, refused: (guarded: boolean) => void, retryFrom?: string) {
      const document = path(address)

      if (!document) return
      exposed = true
      const restricted = guarded()
      const reader = restricted ?? source
      const old = retryFrom && this.host(retryFrom)
      const prior = retryFrom === undefined ? undefined : (old && grants.get(old)?.identity) || lastRoot
      const identity = prior ?? previousRoot ?? (reader.type === "remote" ? await reader.pin(document, lifetime) : await previewRoot(root).then(pin => pin.id, () => undefined))

      if (lifetime.aborted || disposed) return

      // Reconnect/reload replaces this document; its origin and storage are not a second live grant.
      if (old) {
        grants.get(old)?.release()
        grants.delete(old)
      }

      previousRoot = undefined
      lastRoot = identity
      let first = true
      let notified = false

      const grant = previews.grant(
        {
          ...reader,
          localRoots: restricted && source.type === "local" ? roots : undefined,
          document,
          // An unavailable initial bind must still let Chromium report a failed load. Never read without a pin.
          identity: identity ?? "",
          takeEntry() {
            const value = first
            first = false

            return value
          },
          denied() {
            if (notified || lifetime.aborted) return
            notified = true
            refused(!!restricted)
          },
        },
        lifetime,
      )

      grants.set(grant.host, { document, identity: identity ?? "", reader, release: grant.release })

      return previewAddress(address, grant.host, roots, remote)
    },
    host(url: string) {
      if (!url.startsWith("oc-preview://") || !URL.canParse(url)) return
      const host = new URL(url).host

      return grants.has(host) ? host : undefined
    },
    display(url: string) {
      const host = this.host(url)
      const grant = host && grants.get(host)
      const display = grant && previewFile(url, host, roots, remote)
      const file = display && path(display)

      return grant &&
        file &&
        previewAllowed(root, grant.document, file, file === grant.document, remote ? "" : homedir())
        ? display
        : undefined
    },
    permits(current: string, display: string) {
      const host = this.host(current)
      const grant = host && grants.get(host)
      const file = path(display)

      return (
        !!grant &&
        !!file &&
        previewAllowed(root, grant.document, file, grant.document === file, remote ? "" : homedir())
      )
    },
    async exists(url: string, signal: AbortSignal) {
      const host = this.host(url)
      const grant = host && grants.get(host)
      const display = this.display(url)
      const file = display && path(display)

      if (!grant || !file) return false
      const doc = grant.document

      if (grant.reader.type === "remote") return Number.isSafeInteger(await grant.reader.stat(file, signal, doc, file === doc, grant.identity))
      const opened = await openPreviewFile(root, doc, file, file === doc, grant.identity).catch(FileVerificationError.orMissing)

      if (!opened || opened === "denied") return false
      await opened.file.close()

      return true
    },
    dispose() {
      disposed = true
      grants.forEach((grant) => grant.release())
      grants.clear()
    },
  }
}
