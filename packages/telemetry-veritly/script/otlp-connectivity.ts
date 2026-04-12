/**
 * Debug OTLP → Axiom (or any OTLP/HTTP) from the **same env** as sdk-relay / OpenCode.
 *
 * Usage (repo root or this package):
 *   export OTEL_EXPORTER_OTLP_ENDPOINT=https://api.axiom.co
 *   export AXIOM_TOKEN=…
 *   export AXIOM_DATASET=…
 *   bun run otlp:connectivity
 *
 * Compares **fetch** (often works) vs **node:https** (what the OTLP HTTP exporter uses).
 * If fetch succeeds and https fails (or both fail), you know where to look (TLS, Bun vs Node, proxy).
 *
 * Sends **one real span** (`veritly.otlp-connectivity.ping`) so rows appear in Axiom. An empty
 * `resourceSpans: []` batch can return 200 but show nothing in the dataset UI.
 */
import { randomBytes } from "node:crypto"
import dns from "node:dns/promises"
import https from "node:https"
import { otlpTraceExporterOptions, sanitizeOtlpUrlForDiag } from "../src/otlp.ts"

/** One minimal OTLP/JSON span. Axiom expects **hex** trace/span IDs (32 / 16 hex chars), not base64. */
function minimalExportTraceBody(): string {
  const traceId = randomBytes(16).toString("hex")
  const spanId = randomBytes(8).toString("hex")
  const start = BigInt(Date.now()) * 1_000_000n
  const end = start + 1_000_000n
  return JSON.stringify({
    resourceSpans: [
      {
        resource: {
          attributes: [
            {
              key: "service.name",
              value: { stringValue: "veritly.otlp-connectivity" },
            },
          ],
        },
        scopeSpans: [
          {
            spans: [
              {
                traceId,
                spanId,
                name: "veritly.otlp-connectivity.ping",
                kind: 1,
                startTimeUnixNano: String(start),
                endTimeUnixNano: String(end),
                status: { code: 1 },
              },
            ],
          },
        ],
      },
    ],
  })
}

async function main() {
  const o = otlpTraceExporterOptions()
  if (!o) {
    console.error(
      "[otlp-connectivity] No traces URL. Set OTEL_EXPORTER_OTLP_ENDPOINT or OTEL_EXPORTER_OTLP_TRACES_ENDPOINT.",
    )
    process.exit(2)
  }

  const url = o.url
  const u = new URL(url)
  console.log("[otlp-connectivity] target:", sanitizeOtlpUrlForDiag(url))
  console.log("[otlp-connectivity] timeoutMillis (env):", o.timeoutMillis)

  try {
    const addrs = await dns.lookup(u.hostname, { all: true })
    console.log("[otlp-connectivity] dns", u.hostname, addrs)
  } catch (e) {
    console.error("[otlp-connectivity] dns FAILED", e)
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(o.headers ?? {}),
  }

  const minimalJsonBody = minimalExportTraceBody()
  console.log(
    `[otlp-connectivity] In Axiom: dataset=${process.env.AXIOM_DATASET ?? "(unset)"} — query last 15m, filter span name contains "veritly.otlp-connectivity"`,
  )

  const tFetch = Date.now()
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: minimalJsonBody,
      signal: AbortSignal.timeout(Math.min(o.timeoutMillis, 30_000)),
    })
    const text = await res.text()
    console.log(
      `[otlp-connectivity] fetch OK ${Date.now() - tFetch}ms status=${res.status} body_snip=${JSON.stringify(text.slice(0, 160))}`,
    )
  } catch (e) {
    console.error(`[otlp-connectivity] fetch FAIL ${Date.now() - tFetch}ms`, e)
  }

  await new Promise<void>((resolve) => {
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      resolve()
    }

    const tHttps = Date.now()
    const req = https.request(
      url,
      {
        method: "POST",
        headers,
        timeout: o.timeoutMillis,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (c: Buffer) => chunks.push(c))
        res.on("end", () => {
          const buf = Buffer.concat(chunks)
          console.log(
            `[otlp-connectivity] node https OK ${Date.now() - tHttps}ms status=${res.statusCode} body_snip=${JSON.stringify(buf.toString("utf8").slice(0, 160))}`,
          )
          done()
        })
      },
    )
    req.setTimeout(o.timeoutMillis, () => {
      console.error(`[otlp-connectivity] node https socket timeout after ${Date.now() - tHttps}ms`)
      req.destroy()
      done()
    })
    req.on("error", (e) => {
      console.error(`[otlp-connectivity] node https FAIL ${Date.now() - tHttps}ms`, e)
      done()
    })
    req.write(minimalJsonBody)
    req.end()
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
