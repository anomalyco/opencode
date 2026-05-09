# Instance Route Parity

This directory contains the legacy Hono instance routes and the experimental Effect HttpApi implementation under `httpapi/`. Keep them behaviorally aligned.

- When adding, removing, or changing a legacy Hono route, update the matching Effect HttpApi group and handler in `httpapi/` in the same change unless the route is intentionally unsupported.
- When changing an Effect HttpApi route, verify the legacy Hono route has the same public behavior, request shape, response shape, status codes, and instance/workspace routing semantics.
- Keep OpenAPI/SDK-visible schemas aligned. If a difference is only an OpenAPI generation artifact, prefer fixing the source schema first; use `httpapi/public.ts` normalization only for compatibility shims that cannot be represented cleanly in the source schema.
- Add or update parity coverage in `test/server/httpapi-bridge.test.ts` or the focused HttpApi tests when behavior or schema parity could regress.
