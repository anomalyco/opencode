export * as CodeModeApi from "./api.js"

import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer, Option, Result, Schema } from "effect"

export interface Interface {
  readonly fetch: (request: Request) => Effect.Effect<Response, Error>
}

/** In-process OpenCode HTTP API dispatcher for Code Mode `opencode://` fetch calls. */
export class Service extends Context.Service<Service, Interface>()("@opencode/CodeModeApi") {}

export const unavailable: Interface = {
  fetch: () => Effect.fail(new Error("OpenCode API is unavailable in this environment.")),
}

export const node = makeGlobalNode({
  service: Service,
  layer: Layer.succeed(Service, unavailable),
  deps: [],
})

export interface ParsedUri {
  readonly pathname: string
  readonly search: string
  readonly canonical: string
}

/**
 * Parse and normalize an `opencode://` URI into a canonical API pathname and query string.
 * Rejects non-empty hosts, credentials, and path traversal so policy checks and dispatch see the exact same path.
 */
export function parseUri(raw: string): Effect.Effect<ParsedUri, Error> {
  const parsed = URL.parse(raw)
  if (!parsed || parsed.protocol !== "opencode:") return Effect.fail(new TypeError(`Invalid opencode URI: ${raw}`))
  if (parsed.username || parsed.password)
    return Effect.fail(new TypeError("fetch cannot be used with credentials in the URL."))
  if (parsed.host)
    return Effect.fail(
      new TypeError(`Invalid opencode URI "${raw}": omit the host, for example "opencode:///api/session".`),
    )
  const rawPath = parsed.pathname || "/"
  if (rawPath.includes("//") || rawPath.includes("\\"))
    return Effect.fail(new Error(`Invalid opencode URI path: ${rawPath}`))
  const trimmed = rawPath.length > 1 && rawPath.endsWith("/") ? rawPath.slice(0, -1) : rawPath
  const segments = trimmed === "/" ? [] : trimmed.slice(1).split("/")
  for (const segment of segments) {
    const decoded = Result.try(() => decodeURIComponent(segment))
    if (Result.isFailure(decoded))
      return Effect.fail(new Error(`Invalid percent-encoding in opencode URI path: ${rawPath}`))
    if (
      decoded.success === "" ||
      decoded.success === "." ||
      decoded.success === ".." ||
      decoded.success.includes("/") ||
      decoded.success.includes("\\")
    )
      return Effect.fail(new Error(`Invalid segment in opencode URI path: ${rawPath}`))
  }
  const pathname = segments.length === 0 ? "/" : `/${segments.join("/")}`
  const search = parsed.search
  return Effect.succeed({
    pathname,
    search,
    canonical: `opencode://${pathname}${search}`,
  })
}

type RouteRule = {
  readonly methods: "*" | ReadonlyArray<string>
  readonly pattern: ReadonlyArray<string>
  readonly reason: string
}

// Routes that cannot be called by an agent over `opencode://` regardless of permission rules.
// This keeps an agent from approving its own prompts, rewriting permissions/config, reading raw credentials,
// or bypassing dedicated permission-checked tools.
const blockedRules: ReadonlyArray<RouteRule> = [
  {
    methods: ["POST"],
    pattern: ["api", "session", "*", "permission", "*", "reply"],
    reason: "Agents cannot reply to permission requests.",
  },
  {
    methods: ["PATCH", "DELETE"],
    pattern: ["api", "permission", "saved", "*"],
    reason: "Agents cannot modify saved permissions.",
  },
  {
    methods: ["POST", "DELETE"],
    pattern: ["api", "session", "*", "form", "*", "**"],
    reason: "Agents cannot reply to or cancel user forms.",
  },
  {
    methods: ["PATCH"],
    pattern: ["api", "experimental", "config"],
    reason: "Agents cannot modify server config via opencode://.",
  },
  {
    methods: "*",
    pattern: ["api", "credential", "**"],
    reason: "Credential endpoints are not accessible via opencode://.",
  },
  {
    methods: "*",
    pattern: ["api", "pair", "**"],
    reason: "Pairing endpoints are not accessible via opencode://.",
  },
  {
    methods: "*",
    pattern: ["auth", "connect", "**"],
    reason: "Authentication endpoints are not accessible via opencode://.",
  },
  {
    methods: "*",
    pattern: ["api", "fs", "**"],
    reason: "Use file tools or Bun file APIs instead of /api/fs.",
  },
  {
    methods: "*",
    pattern: ["api", "experimental", "fs", "**"],
    reason: "Use file tools or Bun file APIs instead of /api/experimental/fs.",
  },
  {
    methods: ["POST"],
    pattern: ["api", "shell"],
    reason: "Use the shell tool instead of POST /api/shell.",
  },
  {
    methods: ["POST"],
    pattern: ["api", "session", "*", "shell"],
    reason: "Use the shell tool instead of POST /api/session/:id/shell.",
  },
  {
    methods: "*",
    pattern: ["api", "pty", "**"],
    reason: "PTY endpoints are not accessible via opencode://.",
  },
  {
    methods: "*",
    pattern: ["api", "experimental", "persistent-pty", "**"],
    reason: "Persistent PTY endpoints are not accessible via opencode://.",
  },
  {
    methods: ["POST"],
    pattern: ["api", "experimental", "session", "*", "terminal"],
    reason: "Terminal creation is not accessible via opencode://.",
  },
  {
    methods: ["PUT", "DELETE"],
    pattern: ["api", "experimental", "mcp", "*"],
    reason: "Agents cannot add or remove MCP servers via opencode://.",
  },
  {
    methods: "*",
    pattern: ["api", "experimental", "client-mcp", "**"],
    reason: "Client MCP transport endpoints are not accessible via opencode://.",
  },
  {
    methods: ["POST", "DELETE"],
    pattern: ["api", "integration", "*", "connect", "**"],
    reason: "Integration connection endpoints are not accessible via opencode://.",
  },
  {
    methods: ["POST"],
    pattern: ["api", "experimental", "integration", "wellknown"],
    reason: "Well-known integration setup is not accessible via opencode://.",
  },
  {
    methods: ["POST"],
    pattern: ["api", "websearch"],
    reason: "Use the websearch tool instead of POST /api/websearch.",
  },
]

function matchesPattern(segments: ReadonlyArray<string>, pattern: ReadonlyArray<string>) {
  for (let i = 0; i < pattern.length; i++) {
    const token = pattern[i]
    if (token === "**") return true
    if (i >= segments.length) return false
    if (token !== "*" && token !== segments[i]) return false
  }
  return segments.length === pattern.length
}

function pathSegments(pathname: string) {
  const trimmed = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname
  return trimmed === "/" ? [] : trimmed.slice(1).split("/")
}

/** Returns why a route is blocked for agents over `opencode://`, or `undefined` if allowed by the static policy. */
export function blockedReason(method: string, pathname: string): string | undefined {
  const upper = method.toUpperCase()
  const segments = pathSegments(pathname)
  const matched = blockedRules.find(
    (rule) => (rule.methods === "*" || rule.methods.includes(upper)) && matchesPattern(segments, rule.pattern),
  )
  return matched?.reason
}

/** Whether an OpenAPI route (concrete path or `{param}` template) is blocked for agents over `opencode://`. */
export function isBlockedRoute(method: string, pathname: string): boolean {
  return blockedReason(method, pathname) !== undefined
}

export interface RequestCheckInput {
  readonly method: string
  readonly pathname: string
  readonly body?: string | Uint8Array<ArrayBuffer> | URLSearchParams
  readonly sessionID: string
}

/** Validate an agent `opencode://` request against hard-blocked routes and self-escalation payload checks. */
export function checkRequest(input: RequestCheckInput): Effect.Effect<void, Error> {
  const method = input.method.toUpperCase()
  const reason = blockedReason(method, input.pathname)
  if (reason !== undefined)
    return Effect.fail(new Error(`opencode:// ${method} ${input.pathname} is not allowed: ${reason}`))
  const segments = pathSegments(input.pathname)
  if (
    method === "POST" &&
    segments.length === 4 &&
    segments[0] === "api" &&
    segments[1] === "session" &&
    segments[2] === input.sessionID &&
    segments[3] === "agent"
  ) {
    return Effect.fail(new Error("Agents cannot switch their own session agent via opencode://."))
  }
  const mutatesSessionPermissions =
    (method === "POST" && segments.length === 2 && segments[0] === "api" && segments[1] === "session") ||
    (method === "PATCH" && segments.length === 3 && segments[0] === "api" && segments[1] === "session")
  if (mutatesSessionPermissions && payloadHasKey(input.body, "permissions")) {
    return Effect.fail(new Error("Agents cannot set or modify session permissions via opencode://."))
  }
  return Effect.void
}

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

function payloadHasKey(body: RequestCheckInput["body"], key: string) {
  if (body === undefined || body instanceof URLSearchParams) return false
  const text = typeof body === "string" ? body : new TextDecoder().decode(body)
  const parsed = decodeJson(text)
  return Option.isSome(parsed) && typeof parsed.value === "object" && parsed.value !== null && key in parsed.value
}
