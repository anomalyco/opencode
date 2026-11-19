import { realpath } from "node:fs/promises"
import { relative } from "node:path"
import { FileVerificationError } from "./file-verification"
import { openContained, openPreviewFile, previewAllowed, type HandlePath } from "./disk"
import { fileURLToPath } from "node:url"
import { fileURLWithin } from "./policy"
import { previewResource } from "./preview"
import { remotePath } from "./remote-address"
import { artifactResource } from "./artifact-link"

export type WorkspaceSource =
  | { type: "local"; roots(): readonly string[] }
  | {
      type: "remote"
      root: string
      prefix: string
      /** The size of the server's file at `path`, or null when it has none it can read. */
      stat(path: string, signal: AbortSignal): Promise<number | null>
      read(path: string, range: string | undefined, signal: AbortSignal): Promise<Response>
    }

/** What a grant lets its document load: the document's folder, entered once through the document itself. */
type PreviewScope = { document: string; takeEntry(): boolean; denied(): void }

export type PreviewSource =
  // `identity` names this machine's workspace folder as it was when the grant was made.
  | (Extract<WorkspaceSource, { type: "local" }> & PreviewScope & { identity: string })
  | (Extract<WorkspaceSource, { type: "remote" }> & PreviewScope)
  | { type: "artifact"; id: string; read(route: string, method: string, signal: AbortSignal): Promise<Response> }

/** The grant must still belong to this binding after asynchronous path resolution. */
export async function resolvePreviewRequest(
  url: string,
  method: string,
  initiator: string | undefined,
  grants: ReadonlyMap<string, PreviewSource>,
  signal: AbortSignal,
  verifier: HandlePath,
) {
  if ((method !== "GET" && method !== "HEAD") || !URL.canParse(url)) return
  const host = new URL(url).host
  const grant = grants.get(host)

  if (!grant || signal.aborted || (initiator !== undefined && initiator !== `oc-preview://${host}`)) return

  if (grant.type === "artifact") {
    const item = artifactResource(url, host, grant.id)

    return item && { type: "artifact" as const, route: item.route, read: grant.read }
  }

  if (grant.type === "remote") {
    const path = remotePath(url, `oc-preview://${host}/`)

    if (!path) {
      grant.denied()

      return
    }

    const entry = path === grant.document && initiator === undefined && grant.takeEntry()

    if (!previewAllowed(grant.root, grant.document, path, entry, "")) {
      grant.denied()

      return
    }

    const size = await grant.stat(path, signal)

    if (size === null || grants.get(host) !== grant || signal.aborted) return

    return { type: "remote" as const, path, size, read: grant.read }
  }

  if (!grant.identity) return
  const roots = grant.roots()
  const file = previewResource(url, host, initiator, roots)

  if (!file) {
    grant.denied()

    return
  }

  const root = roots.find((root) => fileURLWithin(file, [root]))

  if (!root) return
  const path = relative(root, fileURLToPath(file)).replaceAll("\\", "/")
  const entry = path === grant.document && initiator === undefined && grant.takeEntry()
  const target = await openPreviewFile(verifier, root, grant.document, path, entry, grant.identity).catch(FileVerificationError.orMissing)

  if (target === "denied") {
    grant.denied()

    return
  }

  if (!target) return

  if (grants.get(host) === grant && !signal.aborted) return { type: "local" as const, ...target }
  await target.file.close()
}

/** Resolve again at each authority boundary. A path checked when displayed may no longer name the same file. */
export async function workspaceFile(verifier: HandlePath, file: string, roots: readonly string[]) {
  const target = await openWorkspaceFile(verifier, file, roots)

  if (!target) return
  await target.file.close()

  return { path: target.path, size: target.size }
}

async function openWorkspaceFile(verifier: HandlePath, file: string, roots: readonly string[]) {
  const root = roots.find((root) => fileURLWithin(file, [root]))

  if (!root) return

  try {
    return await openContained(verifier, await realpath(root), relative(root, fileURLToPath(file)))
  } catch (error) {
    // Missing, unreadable, malformed or replaced between lookups: no file grant.
    return FileVerificationError.orMissing(error)
  }
}
