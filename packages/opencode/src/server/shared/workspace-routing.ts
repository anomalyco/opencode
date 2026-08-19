import { SessionID } from "@/session/schema"

type Rule = { method?: string; path: string; exact?: boolean; action: "local" | "forward" }

const RULES: Array<Rule> = [
  { path: "/experimental/workspace", action: "local" },
  { path: "/session/status", action: "forward" },
  { method: "GET", path: "/session", action: "local" },
]

export function isLocalWorkspaceRoute(method: string, path: string) {
  if (/^\/session\/[^/]+\/remote$/.test(path)) return true
  for (const rule of RULES) {
    if (rule.method && rule.method !== method) continue
    const match = rule.exact ? path === rule.path : path === rule.path || path.startsWith(rule.path + "/")
    if (match) return rule.action === "local"
  }
  return false
}

export function getWorkspaceRouteSessionID(url: URL) {
  if (url.pathname === "/session/status") return null

  const id =
    url.pathname.match(/^\/session\/([^/]+)(?:\/|$)/)?.[1] ??
    url.pathname.match(/^\/remote\/session\/([^/]+)(?:\/|$)/)?.[1] ??
    url.pathname.match(/^\/experimental\/session\/([^/]+)\/background$/)?.[1]
  if (!id) return null

  return SessionID.make(id)
}

export function workspaceProxyURL(target: string | URL, requestURL: URL) {
  const proxyURL = new URL(target)
  proxyURL.pathname = `${proxyURL.pathname.replace(/\/$/, "")}${requestURL.pathname}`
  proxyURL.search = requestURL.search
  proxyURL.hash = requestURL.hash
  proxyURL.searchParams.delete("workspace")
  // The `directory` param is the *host's* working directory (e.g. a Windows
  // path like `F:\proj`). It is meaningless — and dangerous — on the remote:
  // the sandbox would `path.resolve` it against its own cwd, producing a bogus
  // path like `/home/daytona/workspace/repo/F:\proj` that does not exist and
  // crashes prompt handling. Drop it so the remote falls back to its own
  // project root. This mirrors ProxyUtil.headers stripping `x-opencode-directory`.
  proxyURL.searchParams.delete("directory")
  return proxyURL
}
