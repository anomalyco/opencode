import { Schema } from "effect"

export const ConnectionUrl = Schema.String.check(
  Schema.makeFilter((value) => (isConnectionUrl(value) ? undefined : "an HTTP(S) origin URL")),
)

export function normalizeConnectionUrl(value: string) {
  if (!isConnectionUrl(value)) throw new Error(`Invalid connection URL: ${value}`)
  return new URL(value).origin
}

function isConnectionUrl(value: string) {
  if (!URL.canParse(value)) return false
  const url = new URL(value)
  if (url.protocol !== "http:" && url.protocol !== "https:") return false
  return !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash
}
