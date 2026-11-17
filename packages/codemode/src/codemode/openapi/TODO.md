# OpenAPI Follow-ups

The initial adapter intentionally skips operations it cannot execute correctly. Future work may add:

- Cookie parameters, authentication, and cookie-header merging.
- Matrix, label, space-delimited, pipe-delimited, `allowReserved`, and parameter `content` serialization.
- External references and complete nested `$defs` support.
- `$anchor` and nested `$id` resource resolution in directional (`readOnly`/`writeOnly`) projection.
- Use-site cleanup for `allOf` branches that reference shared component schemas: per-direction component definitions are projected globally, so a directional annotation declared only at one use site cannot remove the property from a referenced component's definition.
- Hidden-name cleanup inside `then`/`else`/`dependentSchemas`/`dependentRequired`, which constrain the same instance as `allOf`; a hidden property may remain named in those keywords.
- Projection inside `not`/`if`/`contains`, whose semantics would invert or shift if constraints were removed; those subschemas pass through unchanged, and a `$ref` from such a context to a projected `$defs` or component definition still observes hiding.
- Iterative traversal for pathologically deep schema nesting: the directional scan and projection recurse per level and overflow the stack around ten thousand levels, below the pre-existing converter limit of roughly fifty thousand; `fromSpec` throws a catchable `RangeError` either way.
- Relative or templated server URLs and server variables.
- Base URLs containing query strings or fragments.
- Runtime response-schema validation and full content negotiation.
- Binary response values and explicit byte-oriented return types.
- SSE, WebSocket, and other streaming transports.
- Recovery of responses rejected by a status-filtering `HttpClient`.
- Configurable request and response size limits.
- Adapter-enforced redirect policy independent of the supplied `HttpClient`.
- Strict UTF-8 and empty-body validation for JSON responses.
- Compile-time rejection of parameter schemas with nested values unsupported by their serialization style; runtime rejects them before auth resolution.
- Complete malformed-security-scheme validation and broader auth-combination coverage.
