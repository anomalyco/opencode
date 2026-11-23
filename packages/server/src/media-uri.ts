import type { HttpServerRequest } from "effect/http"

const CAPABILITIES_HEADER = "x-opencode-capabilities"
const MEDIA_URI_CAPABILITY = "experimental-media-uri"

/**
 * Whether the client opted into `media:` refs. The session's own location decides whether its stored media is
 * actually left as refs (`experimental.media_blob`), so this only picks which read to call.
 */
export const wantsMediaRefs = (request: HttpServerRequest.HttpServerRequest) =>
  request.headers[CAPABILITIES_HEADER]?.split(",").some(
    (token) => token.trim().toLowerCase() === MEDIA_URI_CAPABILITY,
  ) ?? false
