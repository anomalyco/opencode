/**
 * Opviera platform constants.
 *
 * This CLI talks to exactly one place: the Opviera gateway. The base URL is compiled in and
 * overridable only by an env var, which exists for development and self-hosted deployments — it is
 * NOT a general "point me at any provider" switch. Everything else about provider selection is
 * removed elsewhere in the build (see the provider lock).
 */

/** Provider id used in the catalog, the config file, and as the auth.json key. */
export const PROVIDER_ID = "opviera"

export const DEFAULT_GATEWAY_URL = "https://gateway.opviera.com/gateway"

/**
 * Base URL including the `/gateway` mount — the Anthropic SDK appends `/v1`, so the wire path
 * ends up `<base>/v1/messages`, matching how the platform's own config recipes are built.
 */
export function gatewayUrl(): string {
  const raw = process.env["OPVIERA_GATEWAY_URL"]?.trim()
  return stripTrailingSlash(raw && raw.length > 0 ? raw : DEFAULT_GATEWAY_URL)
}

export function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "")
}

/**
 * Keys are `vsk_` + 40 hex characters. Checked client-side purely to give instant feedback on an
 * obvious paste error; the gateway is always the authority (it applies the identical rule before
 * any database lookup).
 */
const KEY_PATTERN = /^vsk_[0-9a-f]{40}$/

export function looksLikeApiKey(value: string): boolean {
  return KEY_PATTERN.test(value.trim())
}
