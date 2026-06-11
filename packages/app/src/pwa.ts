// Workbox `navigateFallbackAllowlist` for the PWA service worker.
//
// Only paths matching one of these patterns receive the SPA navigation
// fallback (`/index.html`) when an active service worker controls the client.
// All other paths (API, events, etc.) pass through to the network.
//
// This constant is the single source of truth: `vite.config.ts` imports it
// into the `VitePWA({ workbox: { navigateFallbackAllowlist } })` option so the
// allowlist is assertable in tests without evaluating the full Vite config.
//
// SPA routes (from app.tsx Route definitions):
//   - `/`                       (root)
//   - `/new-session`            (draft route)
//   - `/:dir/session/:id?`      (session view, optional id)
//   - `/:dir`                   (bare directory; `:dir` is a URL-safe base64 slug,
//                                a single `[A-Za-z0-9_-]+` segment — see
//                                packages/core/src/util/encode.ts). The negative
//                                lookahead excludes `/doc`, the one auth-protected
//                                single-segment server route reachable by top-level
//                                navigation (server docRoute). Other API
//                                single-segment paths are SSE/fetch/WS, never
//                                navigation requests, so the SW fallback never fires.
export const navigateFallbackAllowlist = [
  /^\/$/,
  /^\/new-session$/,
  /^\/[^/]+\/session(\/[^/]+)?$/,
  /^\/(?!doc$)[A-Za-z0-9_-]+$/,
]
