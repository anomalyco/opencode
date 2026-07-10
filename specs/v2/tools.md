# V2 Tools

Status: **Current semantic overview.** The Plugin package owns the public tool type; Core owns registration, settlement, and generic output bounding.

## Tool Definitions Are Opaque

V2 has one opaque type for locally executable tools. Typed tools declare codecs, execution, and optional model-facing projection together:

```ts
const read = Tool.make({
  description: "Read a file",
  input: Schema.Struct({ path: Schema.String }),
  output: Schema.Struct({ content: Schema.String }),
  execute: ({ path }, context) => readFile(path, context),
  toModelOutput: ({ output }) => [{ type: "text", text: output.content }],
})
```

`structured` and `toStructuredOutput` may expose a smaller validated result than the complete execution output. Dynamic MCP and manifest tools use the same opaque representation with runtime JSON Schema.

Built-ins and statically authored plugin tools use this same constructor and execution contract.

`Tool.Definition` is opaque and has exactly one executor. Its schemas and executor are not public fields. The Tool module privately derives model definitions and interprets invocations for the registry; callers normally rely on `Tool.make` inference rather than naming the carrier type.

Input and output codecs are self-contained. Schema conversion cannot require services. Tool dependencies are acquired during construction and captured by `execute`.

## Every Call Has Durable Identity

Every local tool receives the same concrete invocation context:

```ts
interface Tool.Context {
  readonly sessionID: Session.ID
  readonly agent: Agent.ID
  readonly assistantMessageID: SessionMessage.ID
  readonly toolCallID: string
}
```

`assistantMessageID` is the durable ID of the assistant message containing the call. The Session runner owns this association and supplies the complete context to the registry; the registry does not infer it.

Durable events call the invocation identifier `callID`; `Tool.Context.toolCallID` is the same value at the executor boundary.

Decoded tool input is passed separately to `execute`. Raw provider input and domain services do not belong in the invocation context.

Effect interruption is the cancellation mechanism. Tools may translate expected typed failures into `ToolFailure`, but must not translate interruption or defects into model-visible failures.

## Registrations Are Scoped

Tools are named when registered:

```ts
yield *
  tools.register({
    read,
    write,
    grep,
  })
```

The record key is the authored name. Registration normalizes it before deriving the effective model-facing name. A reusable tool value has no intrinsic name.

```ts
interface Tools {
  readonly register: (
    tools: Readonly<Record<string, Tool.AnyTool>>,
  ) => Effect.Effect<void, Tool.RegistrationError, Scope.Scope>
}
```

Registration replaces unsupported name characters with `_` and reserves `execute` for Code Mode.

A Location plugin receives only the narrow `Tools` registration capability, not the internal registry. Each activation acquires the Location's services, constructs its tools, and registers them in a fresh plugin-owned Scope.

Within one placement:

- The latest active registration for a name wins.
- Closing a registration removes only that registration.
- Closing the winner reveals the next-latest active registration.
- Mutating the caller's registration record later does not change the captured registration.

## Built-Ins Use The Same Contract

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

## Requests Capture Tool Values

The Location-scoped registry owns effective lookup and settlement. For each local call it:

1. Resolves one effective named registration.
2. Decodes provider input with the input codec.
3. Invokes the tool with the runner-supplied context.
4. Encodes the returned output with the output codec.
5. Projects encoded output into model-facing content.
6. Bounds the complete model-facing output.
7. Runs `execute.after` hooks with the bounded settlement.
8. Returns the settlement to the runner for durable publication.

Invalid input never invokes the tool. Invalid output never produces a successful settlement.

`toModelOutput` is pure and total. When omitted, the encoded output remains structured output; an encoded string is also projected as text. Projection does not receive invocation identity because presentation depends only on validated input and output.

Each model request captures the effective registered `Tool` value for every advertised name. Settlement executes those captured values; later registration changes affect later requests.

## Producers And The Registry Own Different Limits

Producers may cap capture or spool data before a complete tool result exists. For example, a process tool may retain output it cannot keep in memory. Producer limits must report their own loss accurately; they are separate from registry bounding and cannot claim to reconstruct bytes already discarded.

After projection, the registry bounds the channel sent to the provider. When content exists, only its textual parts are measured; structured metadata is retained unchanged without being double-counted, and native media remains unchanged under producer-owned limits. When content is empty, the structured output is measured. Oversized provider-facing text or structured output is retained in managed storage and replaced with a bounded text preview while structured metadata and media are preserved; if complete retention fails, settlement fails operationally rather than publishing lossy success. Managed paths never appear in `Tool.make`, tool output schemas, or projection callbacks solely for retention bookkeeping.

`execute.after` hooks receive the bounded settlement and its internal managed paths. Hooks may deliberately transform that settlement; the registry does not apply a second bounding pass afterward.

## Failures Preserve Interruptions

Outcomes remain distinct:

- `ToolFailure` is an expected model-visible failure.
- Interruption cancels the invocation and is not a tool result.
- Unexpected typed errors and defects follow the runner's operational failure policy.
- Unknown and invalid calls become explicit model-visible settlement errors without invoking a handler.

Leaf tools translate only errors they deliberately classify as recoverable. Broad cause-catching around an executor is invalid because it consumes interruption and defects.

## Laws

- **Single executor:** `Tool.make(config)` can invoke only `config.execute`.
- **Codec boundary:** execution observes decoded input; projection observes encoded output.
- **Durable identity:** invocation-owned records use the exact Session, agent, assistant message, and call IDs supplied by the runner.
- **Scoped registration:** closing a Scope removes exactly its registration and reveals any prior active overlay.
- **Captured execution:** a call executes the registered `Tool` value advertised in its model request.
- **Storage encapsulation:** domain output does not change according to model-output bounding or retention policy.
