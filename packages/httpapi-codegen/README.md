# @opencode-ai/httpapi-codegen

Build-time source generation for domain-oriented Promise and Effect APIs derived directly from `HttpApi` and Effect Schema contracts.

The package is private while its API is explored. Its tests are the executable specification for the generator. It must remain independent of OpenCode Core and use synthetic `HttpApi` fixtures.

## Settled rules

- Reflect one authoritative `HttpApi` into a shared contract with `compile(Api)`.
- Emit clients independently with `emitPromise(contract)` and `emitEffect(contract)`.
- Give each emitter its own public type projection; the shared contract, not a generated type package, is the common source.
- Generate a rich Effect client with decoded Effect-native values, runtime schemas, preserved transformations, and `HttpApiClient`.
- Generate a zero-Effect Promise client with structural wire-oriented values, direct `fetch`, and syntax parsing without runtime structural validation.
- Keep the Promise surface domain-oriented rather than Hey API compatible: methods return unwrapped values and reject with tagged declared errors or `ClientError`.
- Return Promise streams as lazy `AsyncIterable` values and Effect streams as `Stream` values. Neither runtime reconnects automatically.

- Flatten path, query, header, and payload fields into one input object.
- Reject duplicate field names across input channels.
- Emit no method argument for zero fields, an optional object when every field is optional, and a required object when any field is required.
- Unwrap exact `{ data: A }` success envelopes.
- Map no-content success to `void`.
- Preserve other single success values.
- Reject ambiguous multiple-success contracts.
- Expose streaming success as `Stream`, not `Effect<Stream>`.
- Reject schemas whose wire/domain transformation cannot be generated exactly.
- Map transport, unexpected-status, and response-decoding failures to one stable generated `ClientError`.
- Commit generated source for review; CI regenerates and fails when the worktree changes.
- Track generated files in `.httpapi-codegen.json` so regeneration removes only stale files previously owned by the generator.

## Boundary

This package generates only client APIs derived from `HttpApi`. It does not generate embedded-only capabilities. Networked and embedded OpenCode use the same generated Effect client against network and in-memory `HttpClient` transports respectively; the embedded host structurally extends that client with same-process capabilities.

Codegen generates every endpoint in the `HttpApi` it receives. OpenCode owns the product decision by composing the exact remote API before invoking the generator; the generic package has no endpoint filtering policy.

The existing public `generate(Api, { directory })` operation writes the rich Effect output and remains an Effect requiring `FileSystem`. The staged API uses pure `compile(Api)`, `emitEffect(contract)`, and `emitPromise(contract)` phases before `write(output, directory)`. Compiler tests inspect virtual files directly; writer tests use `FileSystem.makeNoop`.

Generation formats TypeScript with Prettier before writing. Output paths are flat, unique, and checked against traversal, reserved manifest names, and existing symbolic links.

Generated source starts with one self-contained module per `HttpApiGroup`, plus root client and index modules. Schema dependencies may be duplicated across group modules. Cross-group schema partitioning is deferred until measured output or bundle cost requires it.

Codegen preserves group and endpoint identifiers exactly. The composed remote `HttpApi` owns public names such as `session` and `get`; the generator performs no prefix stripping, casing conversion, or public-name annotation mapping.
