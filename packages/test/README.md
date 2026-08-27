# Shared Test Support

This private workspace package contains test-only value builders. It has no runtime
dependencies and does not import a test runner, Core, or a UI framework.

## Session Message Expectations

```ts
import { Expected } from "@opencode-ai/test/session-message"

expect(messages).toMatchObject([Expected.user("Hello"), Expected.assistant("stop", [Expected.text("Hi")])])
```

`user`, `assistant`, `text`, and `reasoning` build partial expected values.
`completedTool(identity, fields)` and `failedTool(identity, fields)` add the tool
envelope and terminal status around the supplied state fields. For example,
`Expected.completedTool({ id: "call-echo" }, { input: { text: "Hi" } })` does not
add a name or expected output. They do not infer output from input or add IDs,
times, metadata, or other defaults.

Use ordinary object spread for additional assertions and pass asymmetric matchers
as values when useful. Omitted fields stay omitted; explicit `undefined` stays
explicit. These values can match both decoded Core messages and wire messages
without converting either representation.

These are not full input fixtures, provider-message builders, or custom matchers.
Keep `TestLLM` for provider scripts. Preserve each test's assertion method and all
asserted fields; do not weaken exact equality to adopt a builder. Keep short raw
literals when a builder would not improve readability.
