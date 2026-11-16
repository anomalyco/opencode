import { realpath, stat } from "node:fs/promises"
import { relative } from "node:path"
import { workspaceTarget } from "@opencode/plugin-browser/workspace"
import { fileURLToPath, pathToFileURL } from "node:url"
import { fileURLWithin } from "./policy"
import { previewResource } from "./preview"
import { remotePath } from "./remote-address"
import { artifactResource } from "./artifact-link"

export type PreviewSource =
  | { type: "local"; roots(): readonly string[] }
  | { type: "artifact"; id: string; read(route: string, method: string, signal: AbortSignal): Promise<Response> }
  | {
      type: "remote"
      prefix: string
      needsUpdate?(): boolean
      stat(path: string, signal: AbortSignal): Promise<number | null>
      read(path: string, range: string | undefined, signal: AbortSignal): Promise<Response>
    }

/** The grant must still belong to this binding after asynchronous path resolution. */
export async function resolvePreviewRequest(url: string, method: string, initiator: string | undefined, grants: ReadonlyMap<string, PreviewSource>, signal: AbortSignal) {
  if ((method !== "GET" && method !== "HEAD") || !URL.canParse(url)) return
  const host = new URL(url).host
  const grant = grants.get(host)

  if (!grant || signal.aborted || (initiator !== undefined && initiator !== `oc-preview://${host}`)) return

  if (grant.type === "artifact") {
    const item = artifactResource(url, host, grant.id)

    return item && { type: "artifact" as const, route: item.route, read: grant.read }
  }

  if (grant.type === "remote") {
    const origin = `oc-preview://${host}`

    const path = remotePath(url, `${origin}/`)

    if (!path) return
    const size = await grant.stat(path, signal)

    return size !== null && grants.get(host) === grant && !signal.aborted ? { type: "remote" as const, path, size, read: grant.read } : undefined
  }

  const roots = grant.roots()
  const file = previewResource(url, host, initiator, roots)

  if (!file) return
  const target = await workspaceFile(file, roots)

  return target && grants.get(host) === grant && !signal.aborted ? { type: "local" as const, ...target } : undefined
}

/** Resolve again at each authority boundary. A path checked when displayed may no longer name the same file. */
export async function workspaceFile(file: string, roots: readonly string[]) {
  if (!fileURLWithin(file, roots)) return

  try {
    const target = await workspaceTarget(fileURLToPath(file), roots)

    if (!target) return
    const info = await stat(target)

    // Hard links are regular workspace entries (also used by package managers); do not reject by link count.
    if (!info.isFile()) return
    const href = pathToFileURL(target).href
    const physical = (await Promise.all(roots.map(root => realpath(root)))).find(root => href.startsWith(`${pathToFileURL(root).href.replace(/\/$/, "")}/`))

    return physical ? { path: target, root: physical, relative: relative(physical, target), size: info.size } : undefined
  } catch {
    // Missing, unreadable, malformed or replaced between lookups: no file grant.
    return undefined
  }
}
