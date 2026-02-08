/**
 * Fetch an upstream URL and follow redirects while keeping headers in sync.
 *
 * We use `redirect: "manual"` to prevent fetch from replaying requests with a
 * stale `Host` header when the redirect target changes origin.
 */
export async function fetchFollow(
  url: string,
  init: RequestInit & { duplex?: "half" },
  depth = 0,
): Promise<Response> {
  const res = await fetch(url, { ...init, redirect: "manual" })
  if (res.status < 300 || res.status >= 400) return res
  if (depth >= 5) return res

  const location = res.headers.get("location")
  if (!location) return res

  const nextUrl = new URL(location, url).toString()
  const status = res.status

  const method = String(init.method ?? "GET")
  const nextMethod = status === 303 ? "GET" : method
  const nextBody = status === 303 ? undefined : init.body

  const nextHeaders = (() => {
    const headers = new Headers(init.headers)
    headers.set("host", new URL(nextUrl).host)
    if (headers.has("origin")) headers.set("origin", new URL(nextUrl).origin)
    if (status === 303) {
      headers.delete("content-length")
      headers.delete("content-type")
    }
    return headers
  })()

  return fetchFollow(nextUrl, { ...init, method: nextMethod, body: nextBody, headers: nextHeaders }, depth + 1)
}
