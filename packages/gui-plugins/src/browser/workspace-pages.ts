import { relative } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"
import { openPreviewFile, previewAllowed, previewRoot, type HandlePath } from "./disk"
import type { createPreviews } from "./profile/previews"
import type { WorkspaceSource } from "./workspace-file"
import { fileURLWithin } from "./policy"
import { previewAddress, previewFile } from "./preview"
import { remotePath } from "./remote-address"
import { FileVerificationError } from "./file-verification"

/** Only main's explicit load mints an origin. Page navigation and history can use but never enlarge its grant. */
export function workspacePages(
  previews: Pick<ReturnType<typeof createPreviews>, "grant">,
  verifier: HandlePath,
  root: string,
  source: WorkspaceSource,
  lifetime: AbortSignal,
) {
  const grants = new Map<string, { document: string; identity: string; release(): void }>()
  let lastRoot: string | undefined
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
    async load(address: string, refused: () => void, retryFrom?: string) {
      const document = path(address)

      if (!document) return
      const old = retryFrom && this.host(retryFrom)
      const prior = retryFrom === undefined ? undefined : (old && grants.get(old)?.identity) || lastRoot

      // Only this machine's folder is pinned; a remote server answers for its own files on each request.
      const identity =
        source.type === "remote"
          ? undefined
          : (prior ?? (await previewRoot(root).then((pin) => pin.id, () => undefined)))

      if (lifetime.aborted || disposed) return

      // Reconnect/reload replaces this document; its origin and storage are not a second live grant.
      if (old) {
        grants.get(old)?.release()
        grants.delete(old)
      }

      lastRoot = identity
      let first = true
      let notified = false

      const scope = {
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
      }

      const grant = previews.grant(
        source.type === "remote"
          ? { ...source, ...scope }
          : // An unavailable initial bind must still let Chromium report a failed load. Never read without a pin.
            { ...source, ...scope, identity: identity ?? "" },
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
    async external(url: string, launch: (file: string) => Promise<void>) {
      const host = this.host(url)
      const grant = host && grants.get(host)
      const display = this.display(url)
      const file = display && path(display)

      if (source.type !== "local" || !grant || !file || !/\.html?$/i.test(file)) return false
      const opened = await openPreviewFile(verifier, root, grant.document, file, file === grant.document, grant.identity)

      if (!opened || opened === "denied") return false
      await using _handle = opened.file

      // Launch the verified physical HTML document, never an HTML-named link's non-HTML target.
      if (lifetime.aborted || grants.get(host) !== grant || !/\.html?$/i.test(opened.path)) return false
      await launch(opened.path)

      return true
    },
    async exists(url: string, signal: AbortSignal) {
      const host = this.host(url)
      const grant = host && grants.get(host)
      const display = this.display(url)
      const file = display && path(display)

      if (!grant || !file) return false
      const doc = grant.document

      if (source.type === "remote") return Number.isSafeInteger(await source.stat(file, signal))
      const opened = await openPreviewFile(verifier, root, doc, file, file === doc, grant.identity).catch(FileVerificationError.orMissing)

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
