# Core Tool Architecture

`src/tool.ts` owns the Location-scoped tool service, registrations, effective lookup, execution, and terminal outcomes. This folder contains its supporting runtime modules and built-in plugins.

## Representations

- Plugin authors get schema-derived input types at the `ToolEditor.add` boundary through `Tool`.
- The heterogeneous Core registry deliberately erases registered definitions to `Tool.Info`. Use `any` at this internal boundary; do not replace it with `unknown`, JSON-value plumbing, casts, or compiled wrapper types solely to preserve type safety after registration.
- Executors return model content and metadata alongside declared machine output. Shipped built-ins and plugin tools use the same runtime shape after registration.
- `src/tool.ts` stores canonical Location registrations, derives LLM definitions, executes tools, and normalizes model content and images.
- Built-in tool plugins live in `tool/plugin`.

Do not add a second executable entry type, registry-owned executor, authorization callback, output-path callback, or legacy normalization path.

## Construction

Tool schemas use `input` and `output` terminology. Each tool carries its name, options, schemas, and executable behavior in one object.

Location-scoped built-in layers acquire `Permission.Service` and every other required Location service while the layer is constructed. The executor captures those services. Permission sources are always constructed from the canonical invocation context:

```ts
const source = {
  type: "tool" as const,
  messageID: context.messageID,
  id: context.id,
}
```

Leaves own resolution, permission, and side-effect ordering. Translate only expected typed errors into `ToolFailure`; do not use `catchCause`, because interruption and defects must survive. User declines from `Permission.assert` and question dismissals travel as defects beneath leaf `mapError` blankets and resurface as typed failures at `SessionModelRequest.executeTool`; leaves must never catch or convert them. A decline with feedback (`Permission.CorrectedError`) stays typed so the leaf converts it into `ToolFailure` and the model continues.

## Registration

Built-ins, plugins, and MCP install tools through `Tool.Service.transform`, adding complete tool objects to the editor. A tool may provide a namespace, which flattens direct model names to `<namespace>_<tool>`, and defaults into CodeMode (`codemode` defaults true; `codemode: false` keeps the tool on the provider's native tool list).

Namespace descriptions are registered once through `editor.namespace(...)`. Tool options continue to reference the namespace by string name; an unregistered namespace remains valid and simply has no namespace description.

The service uses shared `State` to replay synchronous transforms in registration order against a fresh editor. `Tool.Service.reload()` rebuilds from captured source data without changing registration precedence. Registrations are scoped and return a real, idempotent `dispose` Effect:

- The latest valid active registration for the same effective name wins.
- `update` and `remove` target effective names and do nothing for missing tools. Updates preserve the name and namespace; invalid updates leave the previous definition intact. Creating a tool requires `add`.
- Disposing a registration or closing its scope removes only its transform and rebuilds from the remaining transforms, revealing any earlier definition it overrode.
- Each model request captures the effective definitions and executors it advertises; later reloads and disposal affect later snapshots. Captured executors may still reference mutable producer-owned state.

MCP owns one stable tool transform that reads its latest discovered tools. Tool-list changes update that source and reload the tool state instead of re-registering at the end of the transform order. MCP refresh therefore preserves the precedence of later plugin overrides.

Type safety ends at registration. The registry validates model input and declared output at runtime and should not carry producer schema generics through storage or execution.

`Tool.Service` is Location-scoped. Do not make the registry process-global or construct a separate application-tool service for each Location.

## Permissions

The registry has no `Permission.Service` dependency and performs no execution authorization. Registration options may attach a permission action solely to preserve whole-tool definition filtering. Most registrations default to their effective name; `edit`, `write`, and `patch` use the shared `edit` action.

Tool filtering is catalog visibility, not execution authorization. A call still executes the captured tool's leaf policy if it reaches execution.

## Output

Built-ins return complete tool responses. `Tool.Snapshot.execute` is the local execution boundary. Generic output bounding is applied by the Session runner after execution.

Producer capture remains local to producers. Shell stores combined process output in its backing file and returns a bounded tail with the full-output path when truncated.

## Current Gaps

- Future Session-scoped registrations still need an explicit canonical registration design.
