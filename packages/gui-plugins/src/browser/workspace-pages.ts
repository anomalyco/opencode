import { relative } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"
import { openPreviewFile, previewAllowed, previewRoot } from "@opencode/util/preview-scope"
import type { createPreviews } from "./profile/previews"
import type { WorkspaceSource } from "./workspace-file"
import { fileURLWithin } from "./policy"
import { previewAddress, previewFile } from "./preview"
import { remotePath } from "./remote-address"

/** Only main's explicit load mints an origin. Page navigation and history can use but never enlarge its grant. */
export function workspacePages(
  previews: ReturnType<typeof createPreviews>,
  root: string,
  source: WorkspaceSource,
  lifetime: AbortSignal,
) {
  const grants = new Map<string, { document: string; identity: string; release(): void }>()
  let lastRoot: string | undefined
  const remote = source.type === "remote" ? source.prefix : undefined
  const roots = source.type === "local" ? [root] : []

  const path = (address: string) =>
    remote
      ? remotePath(address, remote)
      : fileURLWithin(address, roots)
        ? relative(root, fileURLToPath(address)).replaceAll("\\", "/")
        : undefined

  return {
    async load(address: string, refused: () => void, retryFrom?: string) {
      const document = path(address)

      if (!document) return
      const old = retryFrom && this.host(retryFrom)
      const prior = retryFrom === undefined ? undefined : (old && grants.get(old)?.identity) || lastRoot
      const identity = prior ?? (source.type === "remote" ? await source.pin(document, lifetime) : await previewRoot(root).then(pin => pin.id, () => undefined))

      if (lifetime.aborted) return
      lastRoot = identity
      let first = true
      let notified = false

      const grant = previews.grant(
        {
          ...source,
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
            refused()
          },
        },
        lifetime,
      )

      grants.set(grant.host, { document, identity: identity ?? "", release: grant.release })

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

      if (source.type === "remote") return Number.isSafeInteger(await source.stat(file, signal, doc, file === doc, grant.identity))
      const opened = await openPreviewFile(root, doc, file, file === doc, grant.identity).catch(() => undefined)

      if (!opened || opened === "denied") return false
      await opened.file.close()

      return true
    },
    dispose() {
      grants.forEach((grant) => grant.release())
      grants.clear()
    },
  }
}
