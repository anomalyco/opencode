import http from "node:http"
import crypto from "node:crypto"
import { Effect, Option, Predicate, Schema } from "effect"
import { WebSocket, WebSocketServer } from "ws"
import type { ExecuteTargetSelection } from "./execute.ts"
import type { CdpEvent, CdpResponse, JsonObject, TargetInfo } from "./protocol.ts"
import { parseJsonObject } from "./protocol.ts"
import type { OpenCodeBrowserSession } from "./relay-types.ts"
import { RelayErrorCode } from "./relay-schema.ts"

export const defaultHost = "127.0.0.1"
/** Not Browser Control's 19989, so an old relay can't hold OpenCode Browser's port. Keep in step with the extension. */
export const defaultPort = 19988
/** OpenCode Browser from the Chrome Web Store, and the unpacked build (its ID is pinned by the manifest key). */
export const chromeWebStoreExtensionOrigin = "chrome-extension://mfnicocicmmlkpjnaffgihfjhdgjkdjg"
export const stableUnpackedExtensionOrigin = "chrome-extension://afeafocngkodbmaipcngoamamfmekgfo"

export function chromeExtensionOriginForPath(extensionPath: string, platform: NodeJS.Platform = process.platform): string {
  const normalizedPath = platform === "win32" && /^[a-z]:/.test(extensionPath)
    ? extensionPath.charAt(0).toUpperCase() + extensionPath.slice(1)
    : extensionPath
  const pathBytes = platform === "win32" ? Buffer.from(normalizedPath, "utf16le") : normalizedPath
  const digest = crypto.createHash("sha256").update(pathBytes).digest()
  let extensionId = ""
  for (const byte of digest.subarray(0, 16)) {
    extensionId += String.fromCharCode(97 + (byte >> 4), 97 + (byte & 0x0f))
  }
  return `chrome-extension://${extensionId}`
}

const chromeExtensionOriginPattern = /^chrome-extension:\/\/[a-p]+$/

/**
 * Parses the operator-supplied `OPENCODE_BROWSER_EXTENSION_ORIGINS` value into a
 * de-duplicated list of `chrome-extension://<id>` origins to allowlist in
 * addition to the built-ins. Entries are separated by commas or whitespace;
 * anything that is not a bare `chrome-extension://` origin (web origins, paths,
 * scheme-less ids) is dropped so a malformed value can never widen the origin
 * check to a non-extension origin. Used for same-host unpacked installs where
 * the path-derived id cannot match the relay's own bundled path.
 */
export function parseAdditionalExtensionOrigins(raw: string | undefined): string[] {
  if (!raw) {
    return []
  }
  const seen = new Set<string>()
  const origins: string[] = []
  for (const token of raw.split(/[\s,]+/)) {
    const value = token.trim()
    if (!value || !chromeExtensionOriginPattern.test(value) || seen.has(value)) {
      continue
    }
    seen.add(value)
    origins.push(value)
  }
  return origins
}

const maxCliBodyBytes = 1_000_000

export class HttpRouteError extends Schema.TaggedError<HttpRouteError>()(
  "HttpApi.HttpRouteError",
  { message: Schema.String, status: Schema.Number, code: RelayErrorCode },
) {}

export function formatHostForUrl(host: string): string {
  if (host.includes(":") && !host.startsWith("[")) {
    return `[${host}]`
  }
  return host
}

export function validateHostHeader(options: {
  readonly hostHeader: string | undefined
  readonly host: string
  readonly port: number
}): string | undefined {
  const parsed = parseHostHeader(options.hostHeader)
  if (!parsed) {
    return "Invalid Host header"
  }
  if (parsed.port !== undefined && parsed.port !== options.port) {
    return "Invalid Host header port"
  }
  const allowedHosts = new Set(["localhost", "127.0.0.1", "::1", normalizeHostname(options.host)])
  if (!allowedHosts.has(parsed.hostname)) {
    return "Invalid Host header"
  }
  return undefined
}

export function validateBrowserFetchSite(request: http.IncomingMessage): string | undefined {
  const secFetchSite = request.headers["sec-fetch-site"]
  const value = Array.isArray(secFetchSite) ? secFetchSite[0] : secFetchSite
  if (!value || value === "same-origin" || value === "none") {
    return undefined
  }
  return "Cross-origin browser requests are not allowed"
}

export function validateWebSocketOrigin(options: {
  readonly origin: string | undefined
  readonly additionalChromeExtensionOrigins?: ReadonlySet<string>
  readonly allowAnyChromeExtension?: boolean
  readonly requireChromeExtension?: boolean
}): string | undefined {
  if (!options.origin) {
    return options.requireChromeExtension ? "Extension WebSocket origin is required" : undefined
  }
  if (
    options.origin === chromeWebStoreExtensionOrigin
    || options.origin === stableUnpackedExtensionOrigin
    || options.additionalChromeExtensionOrigins?.has(options.origin)
  ) {
    return undefined
  }
  if (options.allowAnyChromeExtension && options.origin.startsWith("chrome-extension://")) {
    return undefined
  }
  if (options.requireChromeExtension) {
    return "Extension WebSocket origin is not allowed"
  }
  return "WebSocket origin is not allowed"
}

function normalizeHostname(host: string): string {
  const value = host.trim().toLowerCase()
  if (value.startsWith("[") && value.endsWith("]")) {
    return value.slice(1, -1)
  }
  return value
}

function parseHostHeader(hostHeader: string | undefined): { readonly hostname: string; readonly port?: number } | undefined {
  const value = hostHeader?.trim().toLowerCase()
  if (!value) {
    return undefined
  }
  if (value.startsWith("[")) {
    const closingBracket = value.indexOf("]")
    if (closingBracket === -1) {
      return undefined
    }
    const hostname = value.slice(1, closingBracket)
    const rest = value.slice(closingBracket + 1)
    if (!hostname) {
      return undefined
    }
    if (!rest) {
      return { hostname }
    }
    if (!rest.startsWith(":")) {
      return undefined
    }
    const port = parsePort(rest.slice(1))
    return port === undefined ? undefined : { hostname, port }
  }
  if (value === "::1") {
    return { hostname: "::1" }
  }
  const colonCount = value.split(":").length - 1
  if (colonCount > 1) {
    return undefined
  }
  if (colonCount === 0) {
    return { hostname: value }
  }
  const [hostname, portText] = value.split(":")
  if (!hostname || portText === undefined) {
    return undefined
  }
  const port = parsePort(portText)
  return port === undefined ? undefined : { hostname, port }
}

function parsePort(value: string): number | undefined {
  if (!/^\d+$/.test(value)) {
    return undefined
  }
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return undefined
  }
  return port
}

export function listenHttpServer(options: {
  readonly server: http.Server
  readonly host: string
  readonly port: number
}): Effect.Effect<void, Error> {
  return Effect.callback<void, Error>((resume) => {
    const onError = (error: Error) => {
      resume(Effect.fail(error))
    }
    options.server.once("error", onError)
    options.server.listen(options.port, options.host, () => {
      options.server.off("error", onError)
      resume(Effect.void)
    })
    return Effect.sync(() => {
      options.server.off("error", onError)
    })
  })
}

export function closeHttpServer(server: http.Server): Effect.Effect<void, Error> {
  if (!server.listening) {
    return Effect.void
  }
  return Effect.callback<void, Error>((resume) => {
    server.close((error?: Error) => {
      if (error) {
        resume(Effect.fail(new Error("close http server", { cause: error })))
        return
      }
      resume(Effect.void)
    })
    return Effect.void
  })
}

export function closeWebSocketServer(server: WebSocketServer): Effect.Effect<void, Error> {
  return Effect.callback<void, Error>((resume) => {
    server.close((error?: Error) => {
      const nodeError = error as NodeJS.ErrnoException | undefined
      if (nodeError?.code === "ERR_SERVER_NOT_RUNNING") {
        resume(Effect.void)
        return
      }
      if (error) {
        resume(Effect.fail(new Error("close websocket server", { cause: error })))
        return
      }
      resume(Effect.void)
    })
    return Effect.void
  })
}

export function logCloseError(message: string) {
  return (effect: Effect.Effect<void, Error>): Effect.Effect<void> => {
    return Effect.catch(effect, (error) => {
      return Effect.sync(() => {
        console.error(message, error)
      })
    })
  }
}

export function sendJson(response: http.ServerResponse, value: unknown, status = 200): void {
  response.writeHead(status, { "content-type": "application/json" })
  response.end(JSON.stringify(value))
}

export function readJsonBody(request: http.IncomingMessage): Effect.Effect<JsonObject, Error> {
  const contentType = request.headers["content-type"]
  const contentTypeValue = Array.isArray(contentType) ? contentType[0] : contentType
  if (!contentTypeValue?.toLowerCase().includes("application/json")) {
    return Effect.fail(new HttpRouteError({ message: "Content-Type must be application/json", status: 415, code: "invalid-request" }))
  }
  return Effect.callback<JsonObject, Error>((resume) => {
    const chunks: Buffer[] = []
    let totalBytes = 0
    let completed = false
    const onData = (chunk: Buffer) => {
      if (completed) {
        return
      }
      totalBytes += chunk.byteLength
      if (totalBytes > maxCliBodyBytes) {
        completed = true
        request.destroy(new Error(`Request body exceeds ${maxCliBodyBytes} bytes`))
        resume(Effect.fail(new HttpRouteError({ message: `Request body exceeds ${maxCliBodyBytes} bytes`, status: 413, code: "invalid-request" })))
        return
      }
      chunks.push(chunk)
    }
    const onError = (error: Error) => {
      if (completed) {
        return
      }
      completed = true
      resume(Effect.fail(new Error("read request body", { cause: error })))
    }
    const onAbort = () => {
      if (completed) {
        return
      }
      completed = true
      resume(Effect.fail(new Error("request body aborted")))
    }
    const onClose = () => {
      if (completed || request.complete) {
        return
      }
      completed = true
      resume(Effect.fail(new Error("request closed before body completed")))
    }
    const onEnd = () => {
      if (completed) {
        return
      }
      completed = true
      const text = Buffer.concat(chunks).toString("utf8")
      if (!text.trim()) {
        resume(Effect.succeed({}))
        return
      }
      try {
        resume(Effect.succeed(parseJsonObject(text)))
      } catch (error) {
        resume(Effect.fail(new HttpRouteError({ message: "Invalid JSON body", status: 400, code: "invalid-request" })))
      }
    }
    request.on("data", onData)
    request.on("error", onError)
    request.on("aborted", onAbort)
    request.on("close", onClose)
    request.on("end", onEnd)
    return Effect.sync(() => {
      request.off("data", onData)
      request.off("error", onError)
      request.off("aborted", onAbort)
      request.off("close", onClose)
      request.off("end", onEnd)
    })
  })
}

const RawTargetSelection = Schema.Struct({
  urlIncludes: Schema.optionalKey(Schema.String),
  index: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
})
const decodeRawTargetSelection = Schema.decodeUnknownOption(RawTargetSelection)

const RawTargetInfo = Schema.Struct({
  targetId: Schema.String,
  type: Schema.Literals(["page", "iframe", "worker"]),
  title: Schema.optionalKey(Schema.String),
  url: Schema.String,
  canAccessOpener: Schema.optionalKey(Schema.Boolean),
  browserContextId: Schema.optionalKey(Schema.String),
  openerId: Schema.optionalKey(Schema.String),
  parentFrameId: Schema.optionalKey(Schema.String),
})
const decodeRawTargetInfo = Schema.decodeUnknownOption(RawTargetInfo)

export function optionalSessionId(value: JsonObject[string] | undefined): string | undefined {
  if (!Predicate.isString(value) || !value.trim()) {
    return undefined
  }
  const id = value.trim()
  if (!isValidSessionId(id)) {
    throw new HttpRouteError({
      message: "Session ids must use lowercase letters, numbers, and dashes, and be at most 63 characters",
      status: 400,
      code: "invalid-request",
    })
  }
  return id
}

export function isValidSessionId(id: string): boolean {
  if (id.length < 1 || id.length > 63 || id === "." || id === "..") return false
  if (/[A-Z/\\:\0-\x1f\x7f]/.test(id)) return false
  return /^(?:[\p{Extended_Pictographic}\u200d\ufe0f]+\s*)?[a-z0-9][a-z0-9\p{Extended_Pictographic}\u200d\ufe0f\s_-]*$/u.test(id)
}

export function requiredSessionId(value: JsonObject[string] | undefined): string {
  const id = optionalSessionId(value)
  if (!id) {
    throw new HttpRouteError({ message: "sessionId is required", status: 400, code: "invalid-request" })
  }
  return id
}

export function parseTargetSelection(value: JsonObject[string] | undefined): ExecuteTargetSelection | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!getObject(value)) {
    throw new HttpRouteError({ message: "targetSelection must be an object", status: 400, code: "invalid-request" })
  }
  const decoded = decodeRawTargetSelection(value)
  if (Option.isNone(decoded)) {
    throw new HttpRouteError({ message: "targetSelection.index must be a non-negative integer", status: 400, code: "invalid-request" })
  }
  const urlIncludes = decoded.value.urlIncludes ? decoded.value.urlIncludes : undefined
  const index = decoded.value.index
  if (urlIncludes && index !== undefined) {
    throw new HttpRouteError({ message: "Use only one target selector", status: 400, code: "invalid-request" })
  }
  return {
    ...(urlIncludes ? { urlIncludes } : {}),
    ...(index !== undefined ? { index } : {}),
  }
}

export function generateSessionId(existing: ReadonlyMap<string, OpenCodeBrowserSession>): string {
  const adjectives = ["amber", "brisk", "calm", "clever", "cosmic", "gentle", "lucky", "quiet", "rapid", "tidy"]
  const nouns = ["badger", "comet", "falcon", "otter", "panda", "raven", "sparrow", "tiger", "walrus", "wombat"]
  for (let attempt = 0; attempt < 100; attempt++) {
    const adjective = adjectives[Math.floor(Math.random() * adjectives.length)] ?? "calm"
    const noun = nouns[Math.floor(Math.random() * nouns.length)] ?? "otter"
    const suffix = String(Math.floor(Math.random() * 1000)).padStart(3, "0")
    const id = `${adjective}-${noun}-${suffix}`
    if (!existing.has(id)) {
      return id
    }
  }
  return `session-${Date.now().toString(36)}`
}

export function sendCdpResponse(socket: WebSocket, response: CdpResponse): void {
  socket.send(JSON.stringify(response))
}

export function sendCdpEvent(socket: Pick<WebSocket, "send">, event: CdpEvent): void {
  socket.send(JSON.stringify(event))
}

export function getObject(value: unknown): JsonObject | undefined {
  return Predicate.isObject(value) ? (value as JsonObject) : undefined
}

export function getString(object: JsonObject | undefined, key: string): string | undefined {
  const value = object?.[key]
  return Predicate.isString(value) ? value : undefined
}

export function getNumber(object: JsonObject | undefined, key: string): number | undefined {
  const value = object?.[key]
  return Predicate.isNumber(value) ? value : undefined
}

export function getIdText(object: JsonObject | undefined, key: string): string | undefined {
  const value = object?.[key]
  return Predicate.isNumber(value) || Predicate.isString(value) ? String(value) : undefined
}

export function headerValue(value: string | string[] | undefined): string | undefined {
  if (!Predicate.isString(value) || !value) return undefined
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function getTargetInfo(value: unknown): TargetInfo | undefined {
  return Option.match(decodeRawTargetInfo(value), {
    onNone: () => undefined,
    onSome: (info) => ({
      targetId: info.targetId,
      type: info.type,
      title: info.title ?? info.url,
      url: info.url,
      attached: true,
      canAccessOpener: info.canAccessOpener ?? false,
      ...(info.browserContextId === undefined ? {} : { browserContextId: info.browserContextId }),
      ...(info.openerId === undefined ? {} : { openerId: info.openerId }),
      ...(info.parentFrameId === undefined ? {} : { parentFrameId: info.parentFrameId }),
    }),
  })
}

export function isRestrictedTarget(targetInfo: TargetInfo): boolean {
  if (targetInfo.type !== "page" && targetInfo.type !== "iframe" && targetInfo.type !== "worker") {
    return true
  }
  return isRestrictedUrl(targetInfo.url)
}

const restrictedUrlPrefixes = ["chrome://", "chrome-extension://", "chrome-untrusted://", "devtools://", "edge://", "brave://"]

/** Browser-internal or other-extension documents that `chrome.debugger` refuses to expose. */
export function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) {
    return false
  }
  return restrictedUrlPrefixes.some((prefix) => url.startsWith(prefix))
}
