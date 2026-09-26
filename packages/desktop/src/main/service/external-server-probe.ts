export * as ExternalServerProbe from "./external-server-probe"

export type Result = { readonly ready: true } | { readonly ready: false; readonly reason: string }

// One readiness probe against the external opencode server the desktop attaches to. Ready is exactly
// HTTP 200 from GET /api/info; 401/403/404, a refused connection, a DNS failure, and a timeout are all
// "not ready". The Basic header is attached only when a password exists, because the server may run
// passwordless and an empty-password header would be sent for no reason. `timeout` bounds a single
// attempt so a hung connection cannot stall the caller's retry loop.
export async function probe(url: string, password: string | null, timeout = 5_000): Promise<Result> {
  const headers = new Headers()
  if (password) headers.set("authorization", `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`)
  try {
    const response = await fetch(new URL("/api/info", url), {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(timeout),
    })
    return response.status === 200 ? { ready: true } : { ready: false, reason: `HTTP ${response.status}` }
  } catch (cause) {
    return { ready: false, reason: cause instanceof Error ? cause.message : String(cause) }
  }
}
