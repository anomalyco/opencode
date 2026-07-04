# OpenAPI Follow-ups

The initial adapter intentionally skips operations it cannot execute correctly. Future work may add:

- Cookie parameters, authentication, and cookie-header merging.
- Matrix, label, space-delimited, pipe-delimited, `allowReserved`, and parameter `content` serialization.
- External references and complete nested `$defs` support.
- Relative or templated server URLs and server variables.
- Base URLs containing query strings or fragments.
- Runtime response-schema validation and full content negotiation.
- SSE, WebSocket, and other streaming transports.
- Recovery of responses rejected by a status-filtering `HttpClient`.
- Configurable request and response size limits.
- Strict UTF-8 and empty-body validation for JSON responses.
- Compile-time rejection of parameter schemas with nested values unsupported by their serialization style.
- Complete malformed-security-scheme validation and broader auth-combination coverage.
