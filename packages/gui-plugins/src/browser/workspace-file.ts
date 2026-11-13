import { stat } from "node:fs/promises"
import { workspaceTarget } from "@opencode/plugin-browser/workspace"
import { fileURLToPath, pathToFileURL } from "node:url"
import { fileURLWithin } from "./policy"
import { previewResource } from "./preview"

/** The grant must still belong to this binding after asynchronous path resolution. */
export async function resolvePreviewRequest(url: string, method: string, initiator: string | undefined, grants: ReadonlyMap<string, () => readonly string[]>) {
  if ((method !== "GET" && method !== "HEAD") || !URL.canParse(url)) return
  const host = new URL(url).host
  const grant = grants.get(host)

  if (!grant) return
  const roots = grant()
  const file = previewResource(url, host, initiator, roots)

  if (!file) return
  const target = await workspaceFile(file, roots)

  return grants.get(host) === grant ? target : undefined
}

/** Resolve again at each authority boundary. A path checked when displayed may no longer name the same file. */
export async function workspaceFile(file: string, roots: readonly string[]) {
  if (!fileURLWithin(file, roots)) return

  try {
    const target = await workspaceTarget(fileURLToPath(file), roots)

    if (!target) return
    const info = await stat(target)

    // Hard links are regular workspace entries (also used by package managers); do not reject by link count.
    return info.isFile() ? { path: target, href: pathToFileURL(target).href, size: info.size } : undefined
  } catch {
    // Missing, unreadable, malformed or replaced between lookups: no file grant.
    return undefined
  }
}
