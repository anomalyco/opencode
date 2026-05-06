import { SessionID } from "@/session/schema"

type Rule = { method?: string; path: string; exact?: boolean; action: "local" | "forward" }

const RULES: Array<Rule> = [
  { path: "/experimental/workspace", action: "local" },
  { path: "/session/status", action: "forward" },
  { method: "GET", path: "/session", action: "local" },
]

export function isLocalWorkspaceRoute(method: string, path: string) {
  for (const rule of RULES) {
    if (rule.method && rule.method !== method) continue
    const match = rule.exact ? path === rule.path : path === rule.path || path.startsWith(rule.path + "/")
    if (match) return rule.action === "local"
  }
  return false
}

export function getWorkspaceRouteSessionID(url: URL) {
  if (url.pathname === "/session/status") return null

  const id = url.pathname.match(/^\/session\/([^/]+)(?:\/|$)/)?.[1]
  if (!id) return null

  return SessionID.make(id)
}

export function workspaceProxyURL(target: string | URL, requestURL: URL) {
  const proxyURL = new URL(target)
  proxyURL.pathname = `${proxyURL.pathname.replace(/\/$/, "")}${requestURL.pathname}`
  proxyURL.search = requestURL.search
  proxyURL.hash = requestURL.hash
  proxyURL.searchParams.delete("workspace")
  // The SDK rewrites the client's `x-opencode-directory` header into a
  // `?directory=` query before sending. When the request is then proxied
  // to a remote workspace, that local-machine path leaks through and the
  // remote falls back to `worktree="/"` because the path doesn't exist on
  // its filesystem — which corrupts downstream `path.relative()` callers
  // (notably `sessionListQuery`) and wipes the TUI's session list.
  // Strip it so the workspace adapter's `target.headers["x-opencode-directory"]`
  // (the workspace's directory on the remote) wins.
  proxyURL.searchParams.delete("directory")
  return proxyURL
}
