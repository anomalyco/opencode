import { realpath } from "node:fs/promises"
import { relative } from "node:path"
import { openContained } from "@opencode/util/contained-file"
import { FileVerificationError } from "@opencode/util/file-verification"
import { openPreviewFile, previewAllowed } from "@opencode/util/preview-scope"
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
      pin(document: string, signal: AbortSignal): Promise<string | undefined>
      needsUpdate?(): boolean
      stat(path: string, signal: AbortSignal, document?: string, entry?: boolean, identity?:string): Promise<number | null | "denied">
      read(
        path: string,
        range: string | undefined,
        signal: AbortSignal,
        document: string,
        entry: boolean,
        identity: string,
      ): Promise<Response>
    }

export type PreviewSource =
  | (WorkspaceSource & { localRoots?: readonly string[]; document: string; identity: string; takeEntry(): boolean; denied(): void })
  | { type: "artifact"; id: string; read(route: string, method: string, signal: AbortSignal): Promise<Response> }

/** The grant must still belong to this binding after asynchronous path resolution. */
export async function resolvePreviewRequest(
  url: string,
  method: string,
  initiator: string | undefined,
  grants: ReadonlyMap<string, PreviewSource>,
  signal: AbortSignal,
) {
  if ((method !== "GET" && method !== "HEAD") || !URL.canParse(url)) return
  const host = new URL(url).host
  const grant = grants.get(host)

  if (!grant || signal.aborted || (initiator !== undefined && initiator !== `oc-preview://${host}`)) return

  if (grant.type === "artifact") {
    const item = artifactResource(url, host, grant.id)

    return item && { type: "artifact" as const, route: item.route, read: grant.read }
  }

  if (!grant.identity) return

  if (grant.type === "remote") {
    const origin = `oc-preview://${host}`

    const local = grant.localRoots && previewResource(url, host, initiator, grant.localRoots)

    const path = grant.localRoots
      ? local && relative(grant.root, fileURLToPath(local)).replaceAll("\\", "/")
      : remotePath(url, `${origin}/`)

    if (!path) {
      grant.denied()

      return
    }

    const entry = path === grant.document && initiator === undefined && grant.takeEntry()

    if (!previewAllowed(grant.root, grant.document, path, entry, "")) {
      grant.denied()

      return
    }

    const size = await grant.stat(path, signal, grant.document, entry, grant.identity)

    if (size === "denied") {
      grant.denied()

      return
    }

    if (size === null || grants.get(host) !== grant || signal.aborted) return

    return {
      type: "remote" as const,
      path,
      size,
      read: async (path: string, range: string | undefined, signal: AbortSignal) => {
        const response = await grant.read(path, range, signal, grant.document, entry, grant.identity)

        if (response.headers.get("x-opencode-preview-denied") === "1" && grants.get(host) === grant) grant.denied()

        return response
      },
    }
  }

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
  const target = await openPreviewFile(root, grant.document, path, entry, grant.identity).catch(FileVerificationError.orMissing)

  if (target === "denied") {
    grant.denied()

    return
  }

  if (!target) return

  if (grants.get(host) === grant && !signal.aborted) return { type: "local" as const, ...target }
  await target.file.close()
}

/** Resolve again at each authority boundary. A path checked when displayed may no longer name the same file. */
export async function workspaceFile(file: string, roots: readonly string[]) {
  const target = await openWorkspaceFile(file, roots)

  if (!target) return
  await target.file.close()

  return { path: target.path, size: target.size }
}

async function openWorkspaceFile(file: string, roots: readonly string[]) {
  const root = roots.find((root) => fileURLWithin(file, [root]))

  if (!root) return

  try {
    return await openContained(await realpath(root), relative(root, fileURLToPath(file)))
  } catch (error) {
    // Missing, unreadable, malformed or replaced between lookups: no file grant.
    return FileVerificationError.orMissing(error)
  }
}
