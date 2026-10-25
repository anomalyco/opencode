import path from "path"
import { Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { InstanceState } from "@/effect/instance-state"
import DESCRIPTION from "./http.txt"
import * as Tool from "./tool"

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024 // 5MB
const MAX_ECHO = 20_000 // characters of body echoed back
const DEFAULT_TIMEOUT = 30 * 1000
const MAX_TIMEOUT = 120 * 1000
const PROFILES = ".bolt/http-profiles.json"

export const Parameters = Schema.Struct({
  method: Schema.Literals(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
    .annotate({ description: "The HTTP method. Defaults to GET.", default: "GET" })
    .pipe(Schema.withDecodingDefault(Effect.succeed("GET" as const))),
  url: Schema.String.annotate({ description: "The fully-formed http:// or https:// URL to call" }),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)).annotate({
    description: "Optional request headers. Explicit headers win over profile headers with the same name.",
  }),
  body: Schema.optional(Schema.String).annotate({
    description: "Optional raw request body, sent as-is. Set a content-type header when sending JSON.",
  }),
  profile: Schema.optional(Schema.String).annotate({
    description: `Optional named auth profile from ${PROFILES} whose header templates are attached to the request.`,
  }),
  timeout: Schema.optional(Schema.Number).annotate({ description: "Optional timeout in seconds (max 120)" }),
})

/** Fill ${VAR} placeholders from the environment, reporting missing variables and the injected values. */
export function interpolate(
  template: string,
  env: Record<string, string | undefined>,
): { value: string; missing: string[]; used: string[] } {
  const missing: string[] = []
  const used: string[] = []
  const value = template.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => {
    const found = env[name]
    if (found === undefined) {
      missing.push(name)
      return ""
    }
    used.push(found)
    return found
  })
  return { value, missing, used }
}

/**
 * Resolve a named profile from the parsed profile file into concrete headers.
 * Returns the env values that were injected so callers can redact them from
 * anything echoed back.
 */
export function resolve(
  raw: unknown,
  name: string,
  env: Record<string, string | undefined>,
): { ok: true; headers: Record<string, string>; secrets: string[] } | { ok: false; reason: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: `${PROFILES} must contain a JSON object of profiles` }
  }
  const profile = (raw as Record<string, unknown>)[name]
  if (profile === undefined) {
    const available = Object.keys(raw).join(", ")
    return { ok: false, reason: `unknown profile "${name}" (available: ${available || "none"})` }
  }
  if (typeof profile !== "object" || profile === null || Array.isArray(profile)) {
    return { ok: false, reason: `profile "${name}" must be an object` }
  }
  const templates = (profile as Record<string, unknown>)["headers"] ?? {}
  if (typeof templates !== "object" || templates === null || Array.isArray(templates)) {
    return { ok: false, reason: `profile "${name}" headers must be an object` }
  }
  const headers: Record<string, string> = {}
  const secrets: string[] = []
  const missing: string[] = []
  for (const [key, template] of Object.entries(templates)) {
    if (typeof template !== "string") return { ok: false, reason: `profile "${name}" header "${key}" must be a string` }
    const filled = interpolate(template, env)
    missing.push(...filled.missing)
    secrets.push(...filled.used)
    headers[key] = filled.value
  }
  if (missing.length) {
    return {
      ok: false,
      reason: `profile "${name}" needs environment variables that are not set: ${missing.join(", ")}`,
    }
  }
  return { ok: true, headers, secrets }
}

/** Scrub secret values out of text that will be echoed back to the model. */
export function redact(text: string, secrets: string[]): string {
  return secrets
    .filter((secret) => secret.length >= 4)
    .reduce((acc, secret) => acc.replaceAll(secret, "[redacted]"), text)
}

/** One-line type description of a JSON value. */
function kind(value: unknown): string {
  if (value === null) return "null"
  if (Array.isArray(value)) {
    if (value.length === 0) return "array(0)"
    return `array(${value.length}) of ${kind(value[0])}`
  }
  return typeof value
}

/** Shape summary of a parsed JSON body: top-level keys and types. */
export function summarize(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return kind(value)
  const entries = Object.entries(value)
  if (entries.length === 0) return "object (empty)"
  return entries.map((entry) => `${entry[0]}: ${kind(entry[1])}`).join("\n")
}

export const HttpTool = Tool.define(
  "http",
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!params.url.startsWith("http://") && !params.url.startsWith("https://")) {
            throw new Error("URL must start with http:// or https://")
          }

          const ins = yield* InstanceState.context
          const profile = yield* Effect.gen(function* () {
            if (!params.profile) return { headers: {}, secrets: [] as string[] }
            const file = Bun.file(path.join(ins.worktree, PROFILES))
            if (!(yield* Effect.promise(() => file.exists()))) {
              throw new Error(`profile "${params.profile}" requested but ${PROFILES} does not exist`)
            }
            const raw = yield* Effect.promise((): Promise<unknown> => file.json())
            const resolved = resolve(raw, params.profile, process.env)
            if (!resolved.ok) throw new Error(resolved.reason)
            return { headers: resolved.headers, secrets: resolved.secrets }
          })

          yield* ctx.ask({
            permission: "http",
            patterns: [`${params.method} ${params.url}`],
            always: ["*"],
            metadata: { method: params.method, url: params.url, profile: params.profile },
          })

          // Explicit headers win over profile headers with the same name.
          const merged = { ...profile.headers, ...(params.headers ?? {}) }
          const request = HttpClientRequest.make(params.method)(params.url).pipe(
            params.body === undefined
              ? HttpClientRequest.setHeaders(merged)
              : (self) => HttpClientRequest.setHeaders(HttpClientRequest.bodyText(self, params.body!), merged),
          )

          const timeout = Math.min((params.timeout ?? DEFAULT_TIMEOUT / 1000) * 1000, MAX_TIMEOUT)
          const response = yield* http
            .execute(request)
            .pipe(Effect.timeoutOrElse({ duration: timeout, orElse: () => Effect.die(new Error("Request timed out")) }))

          const buffer = yield* response.arrayBuffer
          if (buffer.byteLength > MAX_RESPONSE_SIZE) throw new Error("Response too large (exceeds 5MB limit)")
          const text = new TextDecoder().decode(buffer)

          const injected = new Set(Object.keys(profile.headers).map((name) => name.toLowerCase()))
          const echo = Object.entries(merged).map(([name, value]) => {
            const hidden = name.toLowerCase() === "authorization" || injected.has(name.toLowerCase())
            return `${name}: ${hidden ? "[redacted]" : value}`
          })

          const parsed = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)(text)
          const body = text.length > MAX_ECHO ? text.slice(0, MAX_ECHO) : text
          const lines = [
            `status: ${response.status}`,
            "",
            "request headers:",
            ...(echo.length ? echo : ["(none)"]),
            "",
            "response headers:",
            ...Object.entries(response.headers).map(([name, value]) => `${name}: ${value}`),
          ]
          if (parsed._tag === "Some") lines.push("", "body shape:", summarize(parsed.value))
          lines.push("", "body:", body || "(empty)")
          if (text.length > MAX_ECHO)
            lines.push(`(body truncated: showing first ${MAX_ECHO} of ${text.length} characters)`)

          return {
            title: `${params.method} ${params.url} (${response.status})`,
            metadata: {
              status: response.status,
              bytes: buffer.byteLength,
              json: parsed._tag === "Some",
              profile: params.profile,
            },
            output: redact(lines.join("\n"), profile.secrets),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
