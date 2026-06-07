# V2 Tools

## Design

V2 has one opaque type for locally executable tools:

```ts
type Tool<Input, Output>
type AnyTool = Tool<any, any>

const make: <
  Input extends Schema.Codec<any, any, never, never>,
  Output extends Schema.Codec<any, any, never, never>,
>(config: {
  readonly description: string
  readonly input: Input
  readonly output: Output
  readonly execute: (
    input: Schema.Type<Input>,
    context: Tool.Context,
  ) => Effect.Effect<Schema.Type<Output>, ToolFailure>
  readonly toModelOutput?: (input: {
    readonly input: Schema.Type<Input>
    readonly output: Output["Encoded"]
  }) => ReadonlyArray<Tool.Content>
}) => Tool<Input, Output>
```

Application tools, built-ins, and statically authored plugin tools use this same constructor and execution contract.

`Tool` is opaque and has exactly one executor. Its schemas and executor are not public fields. The Tool module privately derives model definitions and interprets invocations for the registry; it never embeds another executable tool representation.

Input and output codecs are self-contained. Schema conversion cannot require services. Tool dependencies are acquired during construction and captured by `execute`.

## Invocation Context

Every local tool receives the same concrete invocation context:

```ts
interface Tool.Context {
  readonly sessionID: Session.ID
  readonly agent: Agent.ID
  readonly assistantMessageID: Session.MessageID
  readonly toolCallID: ToolCall.ID
}
```

`assistantMessageID` is the durable ID of the assistant message containing the call. The Session runner owns this association and supplies the complete context to the registry; the registry does not infer it.

Decoded tool input is passed separately to `execute`. Raw provider input and domain services do not belong in the invocation context.

Effect interruption is the cancellation mechanism. Tools may translate expected typed failures into `ToolFailure`, but must not translate interruption or defects into model-visible failures.

## Registration

Tools are named when registered:

```ts
yield *
  tools.register({
    read,
    write,
    grep,
  })
```

The record key is the effective model-facing name. A reusable tool value has no intrinsic name.

```ts
interface Tools {
  readonly register: (
    tools: Readonly<Record<string, Tool.AnyTool>>,
  ) => Effect.Effect<void, Tool.RegistrationError, Scope.Scope>
}
```

Tool names use a conservative provider-neutral grammar and are validated at registration. Provider-specific restrictions that cannot be validated generically fail during request preparation with an explicit model-compatibility error.

Process application tools and Location tools expose the same `register` operation but retain separate services and stores. Registration placement determines scope, precedence, and authority; it does not change the tool type.

A Location plugin receives only the narrow `Tools` registration capability, not the internal registry. Its installation effect runs once per applicable Location, acquires that Location's services, constructs its tools, and registers them in the plugin-owned Scope.

Within one placement:

- The latest active registration for a name wins.
- Closing a registration removes only that contribution.
- Closing the winner reveals the next-latest active contribution.
- Mutating the caller's registration record later does not change the captured contribution.

Location registrations take precedence over process application registrations.

## Built-In Tools

Built-ins use the same tool API while capturing trusted Location services:

```ts
const filesystem = yield * FileSystem.Service
const permission = yield * PermissionV2.Service
const tools = yield * Tools.Service

yield *
  tools.register({
    grep: Tool.make({
      description: "Search file contents",
      input: Input,
      output: Output,
      execute: (input, context) =>
        Effect.gen(function* () {
          const root = yield* filesystem.resolveRoot(input)

          yield* permission.assert({
            sessionID: context.sessionID,
            agent: context.agent,
            source: {
              type: "tool",
              messageID: context.assistantMessageID,
              callID: context.toolCallID,
            },
            action: "grep",
            resources: [input.pattern],
            save: ["*"],
            metadata: { root: root.resource },
          })

          return yield* filesystem.grep(input, root)
        }).pipe(/* translate expected typed errors to ToolFailure */),
    }),
  })
```

Trusted tools formulate and sequence permission requests. `PermissionV2` evaluates policy and manages approval. The registry does not inject an `assertPermission` helper.

Sharing a tool type does not imply equal authority. Built-ins and trusted Location plugins may capture services that are not available to application tools.

## Execution

The Location-scoped registry owns effective lookup and settlement. For each local call it:

1. Resolves one effective named registration.
2. Decodes provider input with the input codec.
3. Invokes the tool with the runner-supplied context.
4. Encodes the returned output with the output codec.
5. Projects encoded output into model-facing content.
6. Bounds the complete model-facing output.
7. Persists the settlement and any internal managed-output references.

Invalid input never invokes the tool. Invalid output never produces a successful settlement.

`toModelOutput` is pure and total. When omitted, the encoded output remains structured output; an encoded string is also projected as text. Projection does not receive invocation identity because presentation depends only on validated input and output.

Provider-turn materialization captures the effective registration identity for each advertised name without retaining its handler. Settlement rejects the call as stale if that registration was removed or replaced, including when closing an overlay reveals the previously effective registration. The current handler is captured only after this check; detaching or replacing it afterward does not affect the running invocation.

## Output Bounding

Tools return complete validated domain output. They do not truncate model-facing output or manage retention files.

After projection, one generic settlement boundary bounds textual and structured provider context. Supported inline media remains native up to the producer's media limit and is never encoded into a text preview. Structured data duplicated by native media content is omitted from provider settlement accounting and storage. Oversized textual or structured values are materialized in managed storage and replaced with bounded previews or references; if complete retention fails, settlement fails operationally rather than publishing lossy success. Managed paths are internal settlement metadata and never appear in `Tool.make`, tool output schemas, or projection callbacks solely for retention bookkeeping.

Model-output bounding is not producer memory management. Processes and streaming sources may need separate capture or spooling limits before a tool result exists. Those limits must be modeled at the producer boundary and must not masquerade as model-output truncation. A producer cannot claim a complete retained output after it has already discarded bytes.

## Failure Semantics

Outcomes remain distinct:

- `ToolFailure` is an expected model-visible failure.
- Interruption cancels the invocation and is not a tool result.
- Unexpected typed errors and defects follow the runner's operational failure policy.
- Unknown, invalid, and stale calls become explicit model-visible settlement errors without invoking a handler.

Leaf tools translate only errors they deliberately classify as recoverable. Broad cause-catching around an executor is invalid because it consumes interruption and defects.

## Laws

- **Single executor:** `Tool.make(config)` can invoke only `config.execute`.
- **Codec boundary:** execution observes decoded input; projection observes encoded output.
- **Durable identity:** invocation-owned records use the exact Session, agent, assistant message, and call IDs supplied by the runner.
- **Scoped registration:** closing a Scope removes exactly its registration and reveals any prior active overlay.
- **Captured execution:** registration changes cannot alter an invocation after effective lookup.
- **Stale rejection:** a call never executes a registration other than the one advertised for its provider turn.
- **Storage encapsulation:** domain output does not change according to model-output bounding or retention policy.

## Follow-Up

Location plugin installation should receive the same narrow `Tools` capability. That requires a separate Location-layer ordering change so built-ins register before plugins without introducing a `PluginBoot -> Tools -> PluginBoot` dependency cycle. The carrier, registrar, and plugin-owned Scope semantics are already suitable; no tool-specific plugin hook is needed.
