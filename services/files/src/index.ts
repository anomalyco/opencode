export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers":
        "Range, If-Range, If-Match, If-None-Match, If-Modified-Since, If-Unmodified-Since",
      "Access-Control-Expose-Headers":
        "Accept-Ranges, Content-Length, Content-Range, Content-Disposition, ETag, Last-Modified",
    }

    if (!url.pathname.startsWith("/files/")) {
      return new Response(null, { status: 404, headers: cors })
    }
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: { ...cors, "Access-Control-Max-Age": "86400" },
      })
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, {
        status: 405,
        headers: { ...cors, Allow: "GET, HEAD, OPTIONS" },
      })
    }

    let key: string
    try {
      key = decodeURIComponent(url.pathname.slice("/files/".length))
    } catch {
      return new Response(null, { status: 400, headers: cors })
    }
    if (!key) return new Response(null, { status: 404, headers: cors })

    // Public object responses never vary by cookies, authorization, or origin.
    const cacheKey = new Request(url.href, { method: "GET" })
    const cacheControl = request.headers.get("Cache-Control") ?? ""
    const noStore = /\bno-store\b/i.test(cacheControl)
    const bypass = noStore || /\bno-cache\b|\bmax-age=0\b/i.test(cacheControl)
    if (
      !bypass &&
      !request.headers.has("If-Match") &&
      !request.headers.has("If-Unmodified-Since") &&
      !request.headers.has("If-Range")
    ) {
      const headers = new Headers()
      for (const name of ["If-None-Match", "If-Modified-Since", "Range"]) {
        const value = request.headers.get(name)
        if (value !== null) headers.set(name, value)
      }
      if (headers.has("If-None-Match")) headers.delete("If-Modified-Since")
      if (request.method === "HEAD") headers.delete("Range")
      const cached = await caches.default.match(new Request(cacheKey, { headers }))
      if (cached && !(request.method === "GET" && request.headers.has("Range") && cached.status === 200)) {
        if (request.method !== "HEAD") return cached
        await cached.body?.cancel()
        return new Response(null, cached)
      }
      await cached?.body?.cancel()
    }

    const object = await env.FILES.head(key)
    if (!object) {
      return new Response(null, {
        status: 404,
        headers: { ...cors, "Cache-Control": "no-store" },
      })
    }

    const headers = new Headers(cors)
    object.writeHttpMetadata(headers)
    headers.set("ETag", object.httpEtag)
    headers.set("Last-Modified", object.uploaded.toUTCString())
    headers.set("Accept-Ranges", "bytes")
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/octet-stream")
    if (!headers.has("Cache-Control")) headers.set("Cache-Control", "public, max-age=3600")

    const modified = Math.floor(object.uploaded.getTime() / 1000) * 1000
    const ifMatch = request.headers.get("If-Match")
    const ifUnmodifiedSince = request.headers.get("If-Unmodified-Since")
    if (
      (ifMatch !== null && !matches(ifMatch, object.httpEtag, false)) ||
      (ifMatch === null && ifUnmodifiedSince !== null && modified > Date.parse(ifUnmodifiedSince))
    ) {
      return new Response(null, { status: 412, headers })
    }
    const ifNoneMatch = request.headers.get("If-None-Match")
    const ifModifiedSince = request.headers.get("If-Modified-Since")
    if (
      (ifNoneMatch !== null && matches(ifNoneMatch, object.httpEtag, true)) ||
      (ifNoneMatch === null && ifModifiedSince !== null && modified <= Date.parse(ifModifiedSince))
    ) {
      return new Response(null, { status: 304, headers })
    }

    headers.set("Content-Length", String(object.size))
    if (request.method === "HEAD") return new Response(null, { headers })

    let range: { offset: number; length: number } | undefined
    const ifRange = request.headers.get("If-Range")
    const rangeHeader = request.headers.get("Range")
    // Ignore unsupported/malformed and multipart ranges; a full 200 is valid.
    const bytes = rangeHeader?.match(/^bytes=(\d*)-(\d*)$/)
    if (
      bytes &&
      (bytes[1] || bytes[2]) &&
      (ifRange === null ||
        ifRange === object.httpEtag ||
        (!ifRange.startsWith('"') && !ifRange.startsWith("W/") && modified <= Date.parse(ifRange)))
    ) {
      const offset = bytes[1] ? Number(bytes[1]) : Math.max(0, object.size - Number(bytes[2]))
      const end = bytes[1] && bytes[2] ? Math.min(Number(bytes[2]), object.size - 1) : object.size - 1
      if (offset >= object.size || end < offset) {
        headers.set("Content-Range", `bytes */${object.size}`)
        headers.set("Content-Length", "0")
        return new Response(null, { status: 416, headers })
      }
      range = { offset, length: end - offset + 1 }
      headers.set("Content-Range", `bytes ${offset}-${end}/${object.size}`)
      headers.set("Content-Length", String(range.length))
    }

    const body = await env.FILES.get(key, {
      range,
      onlyIf: { etagMatches: object.etag },
    })
    // An overwrite/delete between head and get must not mix metadata and bytes.
    if (!body || !("body" in body)) {
      return new Response(null, {
        status: 503,
        headers: { ...cors, "Cache-Control": "no-store", "Retry-After": "1" },
      })
    }
    const response = new Response(body.body, {
      status: range ? 206 : 200,
      headers,
      encodeBody: "manual",
    })
    // Cache only complete responses. Larger objects still stream directly from R2.
    if (
      !range &&
      !noStore &&
      object.size <= 512 * 1024 * 1024 &&
      !/\b(private|no-store|no-cache)\b/i.test(headers.get("Cache-Control")!)
    ) {
      ctx.waitUntil(
        caches.default.put(cacheKey, response.clone()).catch((error) => {
          console.error("Failed to cache public file", error)
        }),
      )
    }
    return response
  },
} satisfies ExportedHandler<{ FILES: R2Bucket }>

function matches(value: string, etag: string, weak: boolean) {
  return value.split(",").some((part) => {
    const tag = part.trim()
    return tag === "*" || (weak ? tag.replace(/^W\//, "") : tag) === etag
  })
}
