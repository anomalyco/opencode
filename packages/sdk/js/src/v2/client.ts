export * from "./gen/types.gen.js"

import { createClient } from "./gen/client/client.gen.js"
import { type Config } from "./gen/client/types.gen.js"
import { OpencodeClient } from "./gen/sdk.gen.js"
export { type Config as OpencodeClientConfig, OpencodeClient }

function pick(value: string | null, fallback?: string, encode?: (value: string) => string) {
  if (!value) return
  if (!fallback) return value
  if (value === fallback) return fallback
  if (encode && value === encode(fallback)) return fallback
  return value
}

// Rewrite headers into query params so middleware can resolve workspace context.
// Applies to ALL HTTP methods (not just GET/HEAD) because InstanceMiddleware
// reads workspace info from both headers and query params on every request.
//
// NOTE: `workspace` (x-opencode-workspace) is NOT consumed by InstanceMiddleware,
// but it IS used by WorkspaceRouterMiddleware for workspace-based request routing.
// Removing it would break /experimental/workspace/* flows.
function rewrite(request: Request, values: { directory?: string; workspace?: string; multiRootWorkspace?: string }) {
  const url = new URL(request.url)
  let changed = false

  for (const [name, key] of [
    ["x-opencode-directory", "directory"],
    ["x-opencode-workspace", "workspace"],
    ["x-opencode-multiroot-workspace", "multiRootWorkspace"],
  ] as const) {
    const fallback =
      key === "directory" ? values.directory : key === "workspace" ? values.workspace : values.multiRootWorkspace
    const value = pick(request.headers.get(name), fallback, key === "directory" ? encodeURIComponent : undefined)
    if (!value) continue
    const paramKey = key === "multiRootWorkspace" ? "multiRootWorkspace" : key
    if (!url.searchParams.has(paramKey)) {
      url.searchParams.set(paramKey, value)
    }
    changed = true
  }

  if (!changed) return request

  const next = new Request(url, request)
  next.headers.delete("x-opencode-directory")
  next.headers.delete("x-opencode-workspace")
  next.headers.delete("x-opencode-multiroot-workspace")
  return next
}

export function createOpencodeClient(
  config?: Config & {
    directory?: string | (() => string | undefined)
    // NOTE: experimental_workspaceID is NOT consumed by InstanceMiddleware,
    // but it IS used by WorkspaceRouterMiddleware for workspace-based routing.
    // Removing it would break /experimental/workspace/* flows.
    experimental_workspaceID?: string | (() => string | undefined)
    multiRootWorkspaceID?: string | (() => string | undefined)
  },
) {
  if (!config?.fetch) {
    const customFetch = (req: Request) => {
      const extended = req as Request & { timeout?: boolean }
      extended.timeout = false
      return fetch(req)
    }
    config = {
      ...config,
      fetch: customFetch as typeof fetch,
    }
  }

  const resolveDirectory = () => (typeof config?.directory === "function" ? config.directory() : config?.directory)
  const resolveWorkspace = () =>
    typeof config?.experimental_workspaceID === "function"
      ? config.experimental_workspaceID()
      : config?.experimental_workspaceID
  const resolveMultiRoot = () =>
    typeof config?.multiRootWorkspaceID === "function" ? config.multiRootWorkspaceID() : config?.multiRootWorkspaceID

  const initialDirectory = resolveDirectory()
  if (initialDirectory) {
    config.headers = {
      ...config.headers,
      "x-opencode-directory": encodeURIComponent(initialDirectory),
    }
  }

  const initialWorkspace = resolveWorkspace()
  if (initialWorkspace) {
    config.headers = {
      ...config.headers,
      "x-opencode-workspace": initialWorkspace,
    }
  }

  const initialMultiRoot = resolveMultiRoot()
  if (initialMultiRoot) {
    config.headers = {
      ...config.headers,
      "x-opencode-multiroot-workspace": initialMultiRoot,
    }
  }

  const client = createClient(config)
  client.interceptors.request.use((request) => {
    const directory = resolveDirectory()
    const workspace = resolveWorkspace()
    const multiRootWorkspace = resolveMultiRoot()

    const headers = new Headers(request.headers)
    if (directory) headers.set("x-opencode-directory", encodeURIComponent(directory))
    else headers.delete("x-opencode-directory")
    if (workspace) headers.set("x-opencode-workspace", workspace)
    else headers.delete("x-opencode-workspace")
    if (multiRootWorkspace) headers.set("x-opencode-multiroot-workspace", multiRootWorkspace)
    else headers.delete("x-opencode-multiroot-workspace")

    const updated = new Request(request, { headers })
    return rewrite(updated, { directory, workspace, multiRootWorkspace })
  })
  client.interceptors.response.use((response) => {
    const contentType = response.headers.get("content-type")
    if (contentType === "text/html")
      throw new Error("Request is not supported by this version of OpenCode Server (Server responded with text/html)")

    return response
  })
  return new OpencodeClient({ client })
}
