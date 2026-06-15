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
