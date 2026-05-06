# LLM House Style

Protocol files should look self-similar. Provider quirks belong behind named helpers so a new adapter can be reviewed by comparing the same sections across files.

## Protocol File Shape

Use this order for every protocol module:

1. Public model input
2. Request payload schemas
3. Streaming chunk schemas
4. Parser state
5. Request lowering
6. Stream parsing
7. Protocol and adapter
8. Model helper

## Rules

- Keep protocol files focused on the protocol. Move provider-specific projection, signing, media normalization, or other bulky transformations into `src/protocols/utils/*`.
- Use `Effect.fn("Provider.toPayload")` for request lowering entrypoints. Use `Effect.gen(function* () { ... })` for chunk processors that yield effects; keep purely synchronous processors as plain functions returning `Effect.succeed(...)`.
- Parser state owns terminal information. `processChunk` records finish reason, usage, and pending tool calls; `onHalt` emits the final `request-finish` event unless the provider has a documented reason to emit earlier.
- Emit exactly one terminal `request-finish` event for a completed response. If a provider splits reason and usage across chunks, merge them in parser state before flushing.
- Use shared helpers for repeated adapter policy such as tool enabling, text joining, usage totals, JSON parsing, and tool-call accumulation.
- Make intentional provider differences explicit in helper names or comments. If two protocol files differ visually, the reason should be obvious from the names.
- Keep tests in the same conceptual order as the protocol: basic prepare, tools prepare, unsupported lowering, text/usage parsing, tool streaming, finish reasons, provider errors.

## Review Checklist

- Can the file be skimmed side-by-side with `openai-chat.ts` without hunting for equivalent sections?
- Are provider quirks named, isolated, and covered by focused tests?
- Does request lowering validate unsupported common content at the protocol boundary?
- Does stream parsing emit stable common events without leaking provider chunk order to callers?
- Does `toolChoice: none` behavior read as intentional?
