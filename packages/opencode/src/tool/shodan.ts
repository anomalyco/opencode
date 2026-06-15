import * as Tool from "./tool"
import DESCRIPTION from "./shodan.txt"
import { Effect, Schema } from "effect"
import {
  ShodanClient,
  ShodanExploitsClient,
  auditLog,
  buildAuditEntry,
} from "@opencode/shodan"

// ─── Input Schema (Effect Schema, discriminated by `operation`) ───────────────

const HostInfo = Schema.Struct({
  operation: Schema.Literal("host_info"),
  ip: Schema.String.annotate({ description: "IP address to look up" }),
  history: Schema.optional(Schema.Boolean).annotate({ description: "Include historical banners" }),
  minify: Schema.optional(Schema.Boolean).annotate({ description: "Return only ports and general info" }),
})

const HostSearch = Schema.Struct({
  operation: Schema.Literal("host_search"),
  query: Schema.String.annotate({ description: "Shodan search query, e.g. 'apache port:443 country:ID'" }),
  facets: Schema.optional(Schema.String).annotate({ description: "Comma-separated facets, e.g. 'country:5,org:3'" }),
  page: Schema.optional(Schema.Number).annotate({ description: "Result page (1-based)" }),
})

const HostCount = Schema.Struct({
  operation: Schema.Literal("host_count"),
  query: Schema.String.annotate({ description: "Shodan search query (does NOT consume query credits)" }),
  facets: Schema.optional(Schema.String),
})

const DnsResolve = Schema.Struct({
  operation: Schema.Literal("dns_resolve"),
  hostnames: Schema.Array(Schema.String).annotate({ description: "List of hostnames to resolve" }),
})

const DnsReverse = Schema.Struct({
  operation: Schema.Literal("dns_reverse"),
  ips: Schema.Array(Schema.String).annotate({ description: "List of IPs to reverse-lookup" }),
})

const HoneypotScore = Schema.Struct({
  operation: Schema.Literal("honeypot_score"),
  ip: Schema.String.annotate({ description: "IP to check — returns 0.0 (not honeypot) to 1.0 (honeypot)" }),
})

const ExploitsSearch = Schema.Struct({
  operation: Schema.Literal("exploits_search"),
  query: Schema.optional(Schema.String).annotate({ description: "Text search query" }),
  port: Schema.optional(Schema.Number).annotate({ description: "Filter exploits by affected port" }),
  type: Schema.optional(Schema.Literals(["shellcode", "remote", "local", "dos", "webapps", "papers"])).annotate({
    description: "Exploit category",
  }),
  osvdb: Schema.optional(Schema.String).annotate({ description: "OSVDB ID" }),
  cve: Schema.optional(Schema.String).annotate({ description: "CVE ID" }),
})

const ApiInfo = Schema.Struct({ operation: Schema.Literal("api_info") })
const Ports = Schema.Struct({ operation: Schema.Literal("ports") })

export const Parameters = Schema.Union([
  HostInfo,
  HostSearch,
  HostCount,
  DnsResolve,
  DnsReverse,
  HoneypotScore,
  ExploitsSearch,
  ApiInfo,
  Ports,
])
export type Parameters = Schema.Schema.Type<typeof Parameters>

type ShodanMetadata = { operation: Parameters["operation"] }

const id = "shodan"

// Operations that touch live internet intelligence and warrant a louder prompt.
const HIGH_RISK = new Set(["host_search", "exploits_search"])

// The resource string surfaced in the permission prompt + audit log for a call.
function resourceOf(input: Parameters): string {
  switch (input.operation) {
    case "host_info":
    case "honeypot_score":
      return input.ip
    case "host_search":
    case "host_count":
      return input.query
    case "dns_resolve":
      return input.hostnames.join(", ")
    case "dns_reverse":
      return input.ips.join(", ")
    case "exploits_search":
      return input.query ?? input.cve ?? input.osvdb ?? (input.port != null ? `port:${input.port}` : input.type ?? "")
    default:
      return input.operation
  }
}

// ─── Tool ─────────────────────────────────────────────────────────────────────

export const ShodanTool = Tool.define<typeof Parameters, ShodanMetadata, never>(
  id,
  Effect.gen(function* () {
    // Instantiate the clients once at tool init (not per execution). The
    // registry only enables this tool when SHODAN_API_KEY is set; we still fail
    // clearly if it is somehow missing at construction time.
    const apiKey = process.env["SHODAN_API_KEY"]
    if (!apiKey) {
      return yield* Effect.die(
        new Error(
          "SHODAN_API_KEY environment variable is not set. " +
            "Obtain an API key at https://account.shodan.io and add it to your environment.",
        ),
      )
    }
    const client = new ShodanClient({ apiKey })
    const exploitsClient = new ShodanExploitsClient({ apiKey })

    const run = Effect.fn("ShodanTool.execute")(function* (input: Parameters, ctx: Tool.Context) {
      const resource = resourceOf(input)

      // Permission via the built-in daemoncode permission system (replaces the
      // custom `approved` flag) — the UI renders the real confirmation dialog.
      yield* ctx.ask({
        permission: id,
        patterns: [`${input.operation}:${resource}`],
        always: ["*"],
        metadata: { operation: input.operation, resource, risk: HIGH_RISK.has(input.operation) ? "high" : "moderate" },
      })

      // Audit (best-effort; never crashes the tool) inside the Effect runtime.
      yield* Effect.promise(() =>
        auditLog(buildAuditEntry(input.operation, input as Record<string, unknown>, true, { sessionId: ctx.sessionID })),
      )

      const output = yield* execute(input)
      return { title: `shodan ${input.operation}`, output, metadata: { operation: input.operation } }
    })

    const execute = (input: Parameters): Effect.Effect<string> =>
      Effect.gen(function* () {
        switch (input.operation) {
          case "host_info": {
            const result = yield* Effect.promise(() =>
              client.host(input.ip, { history: input.history, minify: input.minify }),
            )
            return JSON.stringify(result, null, 2)
          }
          case "host_search": {
            const result = yield* Effect.promise(() =>
              client.hostSearch(input.query, { facets: input.facets, page: input.page }),
            )
            return JSON.stringify(
              {
                total: result.total,
                returned: result.matches.length,
                facets: result.facets,
                matches: result.matches.map((m) => ({
                  ip: m.ip_str,
                  org: m.org,
                  isp: m.isp,
                  country: m.country_name,
                  city: m.city,
                  os: m.os,
                  ports: m.ports,
                  hostnames: m.hostnames,
                  vulns: m.vulns,
                })),
              },
              null,
              2,
            )
          }
          case "host_count": {
            const result = yield* Effect.promise(() => client.hostCount(input.query, { facets: input.facets }))
            return JSON.stringify(result, null, 2)
          }
          case "dns_resolve": {
            const result = yield* Effect.promise(() => client.resolve(...input.hostnames))
            return JSON.stringify(result, null, 2)
          }
          case "dns_reverse": {
            const result = yield* Effect.promise(() => client.reverseLookup(...input.ips))
            return JSON.stringify(result, null, 2)
          }
          case "honeypot_score": {
            const score = yield* Effect.promise(() => client.honeypotScore(input.ip))
            const label =
              score < 0.2
                ? "Very likely legitimate"
                : score < 0.5
                  ? "Possibly legitimate"
                  : score < 0.8
                    ? "Possibly a honeypot"
                    : "Very likely a honeypot"
            return JSON.stringify({ ip: input.ip, score, label }, null, 2)
          }
          case "exploits_search": {
            // At least one selector is required, otherwise the Exploits API
            // returns an unbounded/erroring result.
            if (
              input.query === undefined &&
              input.port === undefined &&
              input.type === undefined &&
              input.osvdb === undefined &&
              input.cve === undefined
            ) {
              return yield* Effect.die(
                new Error("exploits_search requires at least one of: query, port, type, osvdb, cve"),
              )
            }
            const queryArg =
              input.query ?? { port: input.port, type: input.type, osvdb: input.osvdb, cve: input.cve }
            const result = yield* Effect.promise(() => exploitsClient.search(queryArg))
            return JSON.stringify(
              {
                total: result.total,
                returned: result.matches.length,
                exploits: result.matches.map((e) => ({
                  id: e._id,
                  description: e.description,
                  type: e.type,
                  platform: e.platform,
                  date: e.date,
                  cve: e.cve,
                  source: e.source,
                })),
              },
              null,
              2,
            )
          }
          case "api_info": {
            const info = yield* Effect.promise(() => client.info())
            return JSON.stringify(info, null, 2)
          }
          case "ports": {
            const ports = yield* Effect.promise(() => client.ports())
            return JSON.stringify({ ports }, null, 2)
          }
        }
      })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Parameters, ctx: Tool.Context) => run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
import { z } from "zod"
import { ShodanClient } from "@opencode/shodan"
import { ShodanExploitsClient } from "@opencode/shodan"
import {
  assertPermission,
  auditLog,
  buildAuditEntry,
  ShodanPermissionDeniedError,
} from "@opencode/shodan"

// ─── Input Schema ─────────────────────────────────────────────────────────────

const ShodanInput = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("host_info"),
    ip: z.string().describe("IP address to look up"),
    history: z.boolean().optional().describe("Include historical banners"),
    minify: z.boolean().optional().describe("Return only ports and general info"),
    approved: z.boolean().describe("Must be true — user has explicitly approved this query"),
  }),
  z.object({
    operation: z.literal("host_search"),
    query: z.string().describe("Shodan search query, e.g. 'apache port:443 country:ID'"),
    facets: z.string().optional().describe("Comma-separated facets, e.g. 'country:5,org:3'"),
    page: z.number().int().positive().optional(),
    approved: z.boolean().describe("Must be true — user has explicitly approved this query"),
  }),
  z.object({
    operation: z.literal("host_count"),
    query: z.string().describe("Shodan search query (does NOT consume query credits)"),
    facets: z.string().optional(),
    approved: z.boolean().describe("Must be true — user has explicitly approved this query"),
  }),
  z.object({
    operation: z.literal("dns_resolve"),
    hostnames: z.array(z.string()).describe("List of hostnames to resolve"),
    approved: z.boolean().describe("Must be true — user has explicitly approved this query"),
  }),
  z.object({
    operation: z.literal("dns_reverse"),
    ips: z.array(z.string()).describe("List of IPs to reverse-lookup"),
    approved: z.boolean().describe("Must be true — user has explicitly approved this query"),
  }),
  z.object({
    operation: z.literal("honeypot_score"),
    ip: z.string().describe("IP to check — returns 0.0 (not honeypot) to 1.0 (honeypot)"),
    approved: z.boolean().describe("Must be true — user has explicitly approved this query"),
  }),
  z.object({
    operation: z.literal("exploits_search"),
    query: z.string().optional().describe("Text search query"),
    port: z.number().int().optional().describe("Filter exploits by affected port"),
    type: z
      .enum(["shellcode", "remote", "local", "dos", "webapps", "papers"])
      .optional()
      .describe("Exploit category"),
    osvdb: z.string().optional().describe("OSVDB ID"),
    cve: z.string().optional().describe("CVE ID"),
    approved: z.boolean().describe("Must be true — user has explicitly approved this query"),
  }),
  z.object({
    operation: z.literal("api_info"),
    approved: z.boolean().describe("Must be true"),
  }),
  z.object({
    operation: z.literal("ports"),
    approved: z.boolean().describe("Must be true"),
  }),
])

export type ShodanInput = z.infer<typeof ShodanInput>

// ─── Tool Definition ─────────────────────────────────────────────────────────

function getShodanClient(): ShodanClient {
  const apiKey = process.env["SHODAN_API_KEY"]
  if (!apiKey) {
    throw new Error(
      "SHODAN_API_KEY environment variable is not set. " +
        "Obtain an API key at https://account.shodan.io and add it to your environment.",
    )
  }
  return new ShodanClient({ apiKey })
}

function getExploitsClient(): ShodanExploitsClient {
  const apiKey = process.env["SHODAN_API_KEY"]
  if (!apiKey) throw new Error("SHODAN_API_KEY environment variable is not set.")
  return new ShodanExploitsClient({ apiKey })
}

export async function runShodanTool(input: ShodanInput): Promise<string> {
  // ── Permission gate ────────────────────────────────────────────────────────
  try {
    const opMap: Record<string, string> = {
      host_info: "hostInfo",
      host_search: "hostSearch",
      host_count: "hostCount",
      dns_resolve: "dnsResolve",
      dns_reverse: "dnsReverse",
      honeypot_score: "honeypotScore",
      exploits_search: "exploitsSearch",
      api_info: "apiInfo",
      ports: "ports",
    }
    assertPermission(opMap[input.operation] ?? input.operation, input.approved)
  } catch (err) {
    if (err instanceof ShodanPermissionDeniedError) {
      await auditLog(buildAuditEntry(input.operation, input as Record<string, unknown>, false))
      return `[SHODAN BLOCKED] ${err.message}`
    }
    throw err
  }

  // ── Audit log ─────────────────────────────────────────────────────────────
  await auditLog(buildAuditEntry(input.operation, input as Record<string, unknown>, true))

  // ── Execute ───────────────────────────────────────────────────────────────
  const client = getShodanClient()

  switch (input.operation) {
    case "host_info": {
      const result = await client.host(input.ip, {
        history: input.history,
        minify: input.minify,
      })
      return JSON.stringify(result, null, 2)
    }

    case "host_search": {
      const result = await client.hostSearch(input.query, {
        facets: input.facets,
        page: input.page,
      })
      return JSON.stringify(
        {
          total: result.total,
          returned: result.matches.length,
          facets: result.facets,
          matches: result.matches.map((m) => ({
            ip: m.ip_str,
            org: m.org,
            isp: m.isp,
            country: m.country_name,
            city: m.city,
            os: m.os,
            ports: m.ports,
            hostnames: m.hostnames,
            vulns: m.vulns,
          })),
        },
        null,
        2,
      )
    }

    case "host_count": {
      const result = await client.hostCount(input.query, { facets: input.facets })
      return JSON.stringify(result, null, 2)
    }

    case "dns_resolve": {
      const result = await client.resolve(...input.hostnames)
      return JSON.stringify(result, null, 2)
    }

    case "dns_reverse": {
      const result = await client.reverseLookup(...input.ips)
      return JSON.stringify(result, null, 2)
    }

    case "honeypot_score": {
      const score = await client.honeypotScore(input.ip)
      const label =
        score < 0.2 ? "Very likely legitimate" :
        score < 0.5 ? "Possibly legitimate" :
        score < 0.8 ? "Possibly a honeypot" :
                       "Very likely a honeypot"
      return JSON.stringify({ ip: input.ip, score, label }, null, 2)
    }

    case "exploits_search": {
      const exploitsClient = getExploitsClient()
      const queryArg =
        input.query ??
        ({
          ...(input.port !== undefined ? { port: input.port } : {}),
          ...(input.type ? { type: input.type } : {}),
          ...(input.osvdb ? { osvdb: input.osvdb } : {}),
          ...(input.cve ? { cve: input.cve } : {}),
        } as { port?: number; type?: string; osvdb?: string })

      const result = await exploitsClient.search(queryArg)
      return JSON.stringify(
        {
          total: result.total,
          returned: result.matches.length,
          exploits: result.matches.map((e) => ({
            id: e._id,
            description: e.description,
            type: e.type,
            platform: e.platform,
            date: e.date,
            cve: e.cve,
            source: e.source,
          })),
        },
        null,
        2,
      )
    }

    case "api_info": {
      const info = await client.info()
      return JSON.stringify(info, null, 2)
    }

    case "ports": {
      const ports = await client.ports()
      return JSON.stringify({ ports }, null, 2)
    }
  }
}
