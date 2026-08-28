# @opencode-ai/codemode

- This local package owns confined execution over explicit schema-described tools. Applications own authorization, persistence, external authority, and tool-specific delivery semantics.
- Do not add a speculative generic permission or approval policy. A host omits tools it does not expose and enforces domain authorization inside each provided tool.
- Keep Code Mode unaware of host session, channel, and conversation models. The hosting application supplies trusted execution scope around it.
- Tool schemas are the model-facing Interface. Keep arguments minimal and natural to the operation; never add unrelated IDs as ambient capability tokens.

## OpenAPI

- Generate an operation only when its transport semantics are supported; otherwise return a precise `skipped` reason.
- Never guess parameter serialization or malformed security semantics. Unsupported serialization is skipped and malformed security fails closed.
- Render unresolved schema constructs as `unknown`, never as invented TypeScript names.
- Keep network reads bounded and map expected encoding, transport, and decoding failures to model-safe `ToolError` values.
- Test supported behavior directly; do not reproduce adapter algorithms in tests.

## Future Design Notes

- If a captured user-visible output channel returns (an earlier `output.text`/`output.file`/`output.image` API was removed from v1), keep `output` as its name, distinct from the program return value: `return` stays the structured result for the model, while `output.*` describes artifacts the host may render into a conversation or UI after execution. Keep this host-neutral and let applications decide how captured output is delivered. In v1, hosts collect media host-side (outside the sandbox) instead.
- Improve the sandbox failure taxonomy. Distinguish parse/compile mistakes, unsupported syntax, user-thrown errors, invalid returned data, tool refusal, tool internal failure, timeout, and genuine runtime defects so agents can recover accurately instead of treating everything as a generic execution failure.
- Preserve the public/private error split. Tool authors should be able to return a safe model-visible message while retaining a private cause for host diagnostics. Unknown host failures must remain sanitized by default.
- Think deliberately about richer binary boundaries before allowing `Blob`, `File`, `ArrayBuffer`, streams, or typed arrays beyond today's JSON-like values. If CodeMode supports binary tool args/results, use explicit tagged data shapes and clear size limits rather than relying on ambient runtime serialization.
- Keep host capabilities explicit. Globals such as `fetch`, `crypto`, filesystem handles, extra modules, or network clients should be opt-in runtime capabilities with obvious policy defaults, not ambient authority. Default to unavailable unless a host deliberately provides the capability.
- If `fetch` is added, model it as a host-provided outbound capability with policy controls: allowed origins, methods, headers, response size, timeout, and whether response bodies may be returned, emitted, or only summarized through a tool.
