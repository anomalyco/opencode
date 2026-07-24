# Core Tool Architecture

This folder owns Core's local tools, Location-scoped registrations, effective lookup, execution, and terminal outcomes.

## Representations

- `tool.ts` defines the structural canonical `Tool.make({ description, input, output?, execute })` tool. Executors return model content and metadata alongside declared machine output. Shipped built-ins and plugin tools use the same type.
- `tools.ts` exposes the registration-only `Tools.Service` view used by Location producers.
- `registry.ts` stores only canonical Location registrations, derives LLM definitions, executes tools, and applies generic output bounding.

Do not add a second executable entry type, registry-owned executor, authorization callback, output-path callback, or legacy normalization path.

## Construction

Tool schemas use `input` and `output` terminology. A tool carries schemas and executable behavior without public identity. A registration binds its name, namespace, CodeMode placement, and optional catalog permission action.

Location-scoped built-in layers acquire `PermissionV2.Service` and every other required Location service while the layer is constructed. The executor captures those services. Permission sources are always constructed from the canonical invocation context:

```ts
const source = {
  type: "tool" as const,
  messageID: context.messageID,
  callID: context.callID,
}
```

Leaves own resolution, permission, and side-effect ordering. Translate only expected typed errors into `ToolFailure`; do not use `catchCause`, because interruption and defects must survive. User declines from `PermissionV2.assert` and question dismissals travel as defects beneath leaf `mapError` blankets and resurface as typed failures at `SessionModelRequest.executeTool`; leaves must never catch or convert them. A decline with feedback (`PermissionV2.CorrectedError`) stays typed so the leaf converts it into `ToolFailure` and the model continues.

## Registration

Built-ins and plugin tools register through `Tools.Service.register({ [name]: tool })`. Registrations may provide a
namespace, which flattens direct model names to `<namespace>_<tool>`, and default into CodeMode (`codemode` defaults true;
`codemode: false` keeps the tool on the provider's native tool list).

Registrations are scoped:

- The latest active same-placement registration wins.
- Closing any registration removes only that registration and reveals the next active one.
- Each model request captures the effective tools it advertises; later registration changes affect later requests.

`ToolRegistry.Service` is Location-scoped. Do not make the registry process-global or construct a separate application-tool service for each Location.

## Permissions

The registry has no `PermissionV2.Service` dependency and performs no execution authorization. Registration options may attach a permission action solely to preserve whole-tool definition filtering. Most registrations default to their effective name; `edit`, `write`, and `patch` use the shared `edit` action.

Tool filtering is catalog visibility, not execution authorization. A call still executes the captured tool's leaf policy if it reaches execution.

## Output

Built-ins return complete tool responses. `ToolRegistry.ToolSet.execute` is the only local execution and generic model-output bounding boundary and owns managed retention paths.

Producer capture limits are separate. For example, Bash keeps `AppProcess.maxOutputBytes` and accurately reports stdout/stderr capture loss, but it does not run model-output truncation or return a managed `outputPath`.

## Current Gaps

- MCP and future Session-scoped registrations still need an explicit canonical registration design.
- The public Session result shape currently exposes managed `outputPaths`; full storage encapsulation requires a future opaque managed-output reference design.
