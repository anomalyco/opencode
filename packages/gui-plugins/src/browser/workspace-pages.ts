import { relative } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"
import { openPreviewFile, previewAllowed } from "@opencode/util/preview-scope"
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
  const grants = new Map<string, { document: string; release(): void }>()
  const remote = source.type === "remote" ? source.prefix : undefined
  const roots = source.type === "local" ? [root] : []

  const path = (address: string) =>
    remote
      ? remotePath(address, remote)
      : fileURLWithin(address, roots)
        ? relative(root, fileURLToPath(address)).replaceAll("\\", "/")
        : undefined

  return {
    load(address: string, refused: () => void) {
      const document = path(address)

      if (!document) return
      let first = true
      let notified = false

      const grant = previews.grant(
        {
          ...source,
          document,
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

      grants.set(grant.host, { document, release: grant.release })

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
      const doc = host && grants.get(host)?.document
      const display = this.display(url)
      const file = display && path(display)

      if (!doc || !file) return false

      if (source.type === "remote") return Number.isSafeInteger(await source.stat(file, signal, doc, file === doc))
      const opened = await openPreviewFile(root, doc, file, file === doc).catch(() => undefined)

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
