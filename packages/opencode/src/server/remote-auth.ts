import z from "zod"
import { NamedError } from "@opencode-ai/util/error"
import { Filesystem } from "@/util/filesystem"

type RemoteTokenInfo = {
  token: string
  directory: string
  sessionID?: string
  createdAt: number
  expiresAt: number
}

const DEFAULT_TTL_SECONDS = 60 * 60 * 12
const MAX_TTL_SECONDS = 60 * 60 * 24 * 7
const tokens = new Map<string, RemoteTokenInfo>()

export namespace RemoteAuth {
  export const InvalidTokenError = NamedError.create(
    "RemoteAuthInvalidTokenError",
    z.object({
      message: z.string(),
    }),
  )

  export const ScopeError = NamedError.create(
    "RemoteAuthScopeError",
    z.object({
      message: z.string(),
    }),
  )

  export type Info = RemoteTokenInfo

  function cleanup() {
    const now = Date.now()
    for (const [token, info] of tokens.entries()) {
      if (info.expiresAt <= now) tokens.delete(token)
    }
  }

  function generateToken() {
    return `${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`
  }

  export function create(input: { directory: string; sessionID?: string; ttlSeconds?: number }) {
    cleanup()
    const ttlSeconds = Math.max(60, Math.min(MAX_TTL_SECONDS, Math.trunc(input.ttlSeconds ?? DEFAULT_TTL_SECONDS)))
    const createdAt = Date.now()
    const info: Info = {
      token: generateToken(),
      directory: Filesystem.resolve(input.directory),
      sessionID: input.sessionID,
      createdAt,
      expiresAt: createdAt + ttlSeconds * 1000,
    }
    tokens.set(info.token, info)
    return info
  }

  export function tokenFromAuthorizationHeader(header?: string | null) {
    if (!header) return ""
    const value = header.trim()
    if (!value) return ""
    const [scheme, ...rest] = value.split(/\s+/)
    if (!scheme || scheme.toLowerCase() !== "bearer" || rest.length === 0) return ""
    return rest.join(" ").trim()
  }

  export function tokenFromRequest(request: Request, allowQuery = true) {
    const fromHeader = tokenFromAuthorizationHeader(request.headers.get("authorization"))
    if (fromHeader) return fromHeader
    if (!allowQuery) return ""
    try {
      return new URL(request.url).searchParams.get("token")?.trim() ?? ""
    } catch {
      return ""
    }
  }

  export function verify(token?: string | null) {
    if (!token) return
    cleanup()
    const info = tokens.get(token)
    if (!info) return
    if (info.expiresAt <= Date.now()) {
      tokens.delete(token)
      return
    }
    return info
  }

  export function verifyRequest(request: Request, allowQuery = true) {
    return verify(tokenFromRequest(request, allowQuery))
  }

  export function matchesScope(info: Info, input: { directory: string; sessionID?: string }) {
    if (Filesystem.resolve(input.directory) !== info.directory) return false
    return (input.sessionID ?? "") === (info.sessionID ?? "")
  }

  export function matchesRequest(info: Info, request: Request) {
    try {
      const url = new URL(request.url)
      const queryDirectory = url.searchParams.get("directory")
      const headerDirectory = request.headers.get("x-opencode-directory")
      if (queryDirectory && Filesystem.resolve(queryDirectory) !== info.directory) return false
      if (headerDirectory && Filesystem.resolve(headerDirectory) !== info.directory) return false
      if (!info.sessionID) return true

      const querySessionID = url.searchParams.get("sessionID")?.trim()
      const pathSessionID = url.pathname.match(/^\/session\/([^/]+)/)?.[1]
      const sessionID = querySessionID || pathSessionID
      return sessionID === info.sessionID
    } catch {
      return false
    }
  }

  export function isAllowedPath(path: string) {
    if (path === "/remote" || path.startsWith("/remote/")) return true
    if (path === "/event" || path.startsWith("/event/")) return true
    if (path === "/session" || path.startsWith("/session/")) return true
    if (path === "/permission" || path.startsWith("/permission/")) return true
    if (path === "/question" || path.startsWith("/question/")) return true
    if (path === "/log" || path.startsWith("/log/")) return true
    if (path === "/command" || path.startsWith("/command/")) return true
    return false
  }
}
