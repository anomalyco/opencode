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
  sharedRoots: readonly string[] = [],
) {
  const grants = new Map<string, { root: string; document: string; identity: string; release(): void }>()
  const lastRoots = new Map<string, string>()
  let disposed = false
  const remote = source.type === "remote" ? source.prefix : undefined
  const roots = source.type === "local" ? [root, ...sharedRoots.filter((item) => item !== root)] : []

  const locate = (address: string) => {
    if (remote) {
      const file = remotePath(address, remote)

      return file ? { root, file } : undefined
    }

    const matched = roots.find((candidate) => fileURLWithin(address, [candidate]))

    if (!matched) return
    const file = relative(matched, fileURLToPath(address)).replaceAll("\\", "/")

    return file ? { root: matched, file } : undefined
  }

  return {
    async load(address: string, refused: () => void, retryFrom?: string) {
      const target = locate(address)

      if (!target) return
      const old = retryFrom && this.host(retryFrom)
      const previous = old ? grants.get(old) : undefined

      const prior =
        retryFrom === undefined
          ? undefined
          : (previous?.root === target.root ? previous.identity : undefined) || lastRoots.get(target.root)

      // Only this machine's folder is pinned; a remote server answers for its own files on each request.
      const identity =
        source.type === "remote"
          ? undefined
          : (prior ?? (await previewRoot(target.root).then((pin) => pin.id, () => undefined)))

      if (lifetime.aborted || disposed) return

      // Reconnect/reload replaces this document; its origin and storage are not a second live grant.
      if (old) {
        grants.get(old)?.release()
        grants.delete(old)
      }

      if (identity !== undefined) lastRoots.set(target.root, identity)
      let first = true
      let notified = false

      const scope = {
        document: target.file,
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
          : // An unavailable initial bind must still let Chromium report a failed load. Never read without a pin,
            // and never let one root's grant read files from another allowed root.
            {
              type: "local",
              roots: () => (source.roots().includes(target.root) ? [target.root] : []),
              sharedRoots,
              ...scope,
              identity: identity ?? "",
            },
        lifetime,
      )

      grants.set(grant.host, { root: target.root, document: target.file, identity: identity ?? "", release: grant.release })

      return previewAddress(address, grant.host, remote ? [] : [target.root], remote)
    },
    host(url: string) {
      if (!url.startsWith("oc-preview://") || !URL.canParse(url)) return
      const host = new URL(url).host

      return grants.has(host) ? host : undefined
    },
    display(url: string) {
      const host = this.host(url)
      const grant = host && grants.get(host)
      const display = grant && previewFile(url, host, remote ? [] : [grant.root], remote)
      const target = display && locate(display)

      return grant &&
        target &&
        target.root === grant.root &&
        previewAllowed(
          grant.root,
          grant.document,
          target.file,
          target.file === grant.document,
          remote ? "" : homedir(),
          remote ? [] : sharedRoots,
        )
        ? display
        : undefined
    },
    permits(current: string, display: string) {
      const host = this.host(current)
      const grant = host && grants.get(host)
      const target = locate(display)

      return (
        !!grant &&
        !!target &&
        target.root === grant.root &&
        previewAllowed(
          grant.root,
          grant.document,
          target.file,
          grant.document === target.file,
          remote ? "" : homedir(),
          remote ? [] : sharedRoots,
        )
      )
    },
    async external(url: string, launch: (file: string) => Promise<void>) {
      const host = this.host(url)
      const grant = host && grants.get(host)
      const display = this.display(url)
      const target = display && locate(display)

      if (source.type !== "local" || !grant || !target || target.root !== grant.root || !/\.html?$/i.test(target.file))
        return false

      const opened = await openPreviewFile(
        verifier,
        grant.root,
        grant.document,
        target.file,
        target.file === grant.document,
        grant.identity,
        sharedRoots,
      )

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
      const target = display && locate(display)

      if (!grant || !target || target.root !== grant.root) return false
      const doc = grant.document

      if (source.type === "remote") return Number.isSafeInteger(await source.stat(target.file, signal))

      const opened = await openPreviewFile(
        verifier,
        grant.root,
        doc,
        target.file,
        target.file === doc,
        grant.identity,
        sharedRoots,
      ).catch(FileVerificationError.orMissing)

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
