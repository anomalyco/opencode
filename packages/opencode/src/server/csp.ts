import { Flag } from "../flag/flag"

const SERVE_URL = Flag.OPENCODE_SERVE_DOMAIN ?? ""
const SERVE_WILDCARD = SERVE_URL ? `https://*.${SERVE_URL}` : ""
const PREVIEW_HOST = SERVE_URL && Flag.JUPYTERHUB_USER ? `https://${Flag.JUPYTERHUB_USER}.${SERVE_URL}` : ""
// `user.` is a literal subdomain (user-rails OAuth gate), unrelated to JUPYTERHUB_USER.
const USER_RAILS_HOST = SERVE_URL ? `https://user.${SERVE_URL}` : ""
// Sentry envelope ingest 엔드포인트. org ID(o1200796)는 고정이라 정확한 host 로 좁혀둔다.
const SENTRY_INGEST = "https://o1200796.ingest.us.sentry.io"

const origins = (...parts: string[]) => parts.filter(Boolean).join(" ")

// Both hosts required: preview iframe redirects through user-rails OAuth and frame-src is
// checked at every navigation step. Narrowing to just the pod broke auth in 410f7fe.
const FRAME_SRC = origins("'self'", PREVIEW_HOST, USER_RAILS_HOST)
// Wildcard kept until the previewReady fetch chain is measured in a browser Network tab.
const CONNECT_SRC = origins("'self'", "data:", SERVE_WILDCARD, SENTRY_INGEST)
const FRAME_ANCESTORS = origins("'self'", SERVE_URL)

const buildCsp = (hash = "") =>
  `frame-ancestors ${FRAME_ANCESTORS}; default-src 'self'; frame-src ${FRAME_SRC}; script-src 'self' 'wasm-unsafe-eval'${hash ? ` 'sha256-${hash}'` : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; media-src 'self' data:; connect-src ${CONNECT_SRC}`

export const DEFAULT_CSP = buildCsp()
export const csp = (hash = "") => buildCsp(hash)
