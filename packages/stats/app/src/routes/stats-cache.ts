import { LOCALE_HEADER } from "../lib/language"

const statsPageCacheControl = "public, max-age=60, s-maxage=300, stale-while-revalidate=86400"

export function setStatsPageCacheHeaders(headers: Headers | undefined) {
  if (!headers) return

  headers.set("Cache-Control", statsPageCacheControl)
  appendVary(headers, "Accept-Language", "Cookie", LOCALE_HEADER)
}

function appendVary(headers: Headers, ...values: string[]) {
  const existing = headers
    .get("vary")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean)

  headers.set(
    "vary",
    values
      .reduce(
        (result, value) =>
          result.some((item) => item.toLowerCase() === value.toLowerCase()) ? result : [...result, value],
        existing ?? [],
      )
      .join(", "),
  )
}
