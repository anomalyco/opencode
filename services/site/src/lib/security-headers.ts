// Headers that protect visitors without changing how a page renders, on every response the site's
// Worker makes after the fixed-URL machine files (lib/meta.ts, whose headers are a contract). The
// static assets don't need them: a page's own response sets its referrer policy and framing, and
// HSTS applies to the whole host. Set in middleware.ts and, for the docs, docs/middleware.ts.
//
// - HSTS: the same max-age the Console already sends on this host; no includeSubDomains.
// - Framing: only the site itself, for the device preview (/devices) and the video editor.
// - Permissions: off for powerful features the site never uses. The microphone stays allowed for
//   voice mode; test/security-headers.test.ts fails if code starts using a blocked feature.
export const securityHeaders = {
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy": "frame-ancestors 'self'",
  "X-Frame-Options": "SAMEORIGIN",
  "Permissions-Policy": "camera=(), geolocation=(), payment=(), usb=()",
}

/** Adds the headers to the response being prepared (`event.response.headers`). */
export function setSecurityHeaders(headers: Headers) {
  Object.entries(securityHeaders).forEach(([name, value]) => headers.set(name, value))
}
