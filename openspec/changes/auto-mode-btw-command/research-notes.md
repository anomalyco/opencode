# Research: Auto Mode in the opencode Codebase

## Summary

The `auto-mode-btw-command` OpenSpec change proposes adding a classifier-based "auto mode" permission system to replace the blunt `--dangerously-skip-permissions` flag. As of now, **no `src/auto-mode/` directory or `src/auto-mode/rules.ts` file exists** — the entire auto-mode feature is still a proposal with zero implementation. The existing `--auto` flag in `run.ts` is a simple binary switch: when set, it auto-approves (`"once"`) every permission request; when unset, it auto-rejects them. There is no `defaultMode: "auto"` config option anywhere in the config schema. The permission system itself is well-structured with a ruleset-based evaluation pipeline using wildcard matching.

## Key Findings

### 1. `src/auto-mode/rules.ts` does NOT exist

- **No `src/auto-mode/` directory exists anywhere** in `packages/opencode/src/`. A glob for `**/auto-mode/**` returned zero results.
- The proposal (`openspec/changes/auto-mode-btw-command/proposal.md`) specifies this file should contain:
  - Rule categories: `safe` (file reads, local edits), `risky` (shell, network), `blocked` (downloads+exec, exfiltration, prod deploys, mass delete, IAM, force push)
  - An `evaluateAction(ruleCategory, action, context)` function
- The tasks file (`tasks.md`, line 6) lists this as Task 1.1 — **not yet started** (unchecked).

### 2. Permission system architecture (`src/permission/index.ts`)

The permission system is a mature Effect-based service with these key components:

- **`evaluate(permission, pattern, ...rulesets)`** (line 39-49): The core evaluation function. It uses `Wildcard.match` to check a permission+pattern pair against a ruleset, returning the **last matching rule** (`findLast`). If no rule matches, it returns a default `{ action: "ask", permission, pattern: "*" }`.

- **`Permission.Service.ask(input)`** (line 78-118): The main entry point. It iterates over request patterns, evaluates each against the ruleset:
  - `action: "deny"` → immediately fails with `DeniedError` (line 87-89)
  - `action: "allow"` → skips asking (line 91)
  - `action: "ask"` → queues a pending permission request, publishes `permission.asked` event, and awaits user reply (line 109-117)

- **`Permission.Service.reply(input)`** (line 120-178): Handles user replies. `"once"` resolves the deferred request without persisting. `"always"` persists the rule to `approved` state and auto-resolves all pending requests in the same session that would match. `"reject"` fails the deferred request and cascades reject to all pending requests in the same session.

- **`Permission.fromConfig(permission)`** (line 197-209): Converts config-format permissions (e.g., `{ read: "allow", bash: { "*": "ask" } }`) into the internal `PermissionV1.Rule[]` format.

- **`Permission.disabled(tools, ruleset)`** (line 215-224): Returns tool names that should be hidden when `pattern: "*"` and `action: "deny"`.

- **Wildcard expansion** (line 189-195): The `expand()` helper expands `~/` and `$HOME/` patterns in permission rules.

### 3. The `--auto` flag in `run.ts` (lines 231-235, 735-750)

The `--auto` flag is defined at **line 231-235**:

```ts
.option("auto", {
  type: "boolean",
  describe: "auto-approve permissions that are not explicitly denied",
  default: false,
})
```

It is used at **line 735-750** in the event loop handler:

```ts
if (event.type === "permission.asked") {
  if (args["auto"]) {
    await client.permission.reply({ requestID: permission.id, reply: "once" })
  } else {
    UI.println(...`permission requested: ...; auto-rejecting`)
    await client.permission.reply({ requestID: permission.id, reply: "reject" })
  }
}
```

**Current behavior**: `--auto` is a blunt instrument — it replies `"once"` (approve just this one time) to _every_ permission request, including dangerous ones like `doom_loop`. Without `--auto`, it prints a warning and auto-rejects everything.

**Note**: The describe text says "auto-approve permissions that are not explicitly denied" but the actual implementation does NOT check for explicit denies — it just approves everything. This is a documentation/implementation mismatch.

### 4. No `defaultMode: "auto"` config option exists

- **`packages/core/src/v1/config/config.ts`** (line 87-92) has a deprecated `mode` field:

  ```ts
  mode: Schema.optional(
    Schema.StructWithRest(
      Schema.Struct({ build: Schema.optional(ConfigAgentV1.Info), plan: Schema.optional(ConfigAgentV1.Info) }),
      [Schema.Record(Schema.String, ConfigAgentV1.Info)],
    ),
  ).annotate({ description: "@deprecated Use `agent` field instead." })
  ```

  This is about **agent mode** (`"primary"`, `"subagent"`, `"all"`), not permission mode.

- There is **no `permissions.defaultMode`** or similar config field in the schema. The config only has `permission` (line 125) which accepts the `ConfigPermissionV1.Info` type — a record of permission keys to action/pattern rules.

- The proposal (`proposal.md`, line 23) explicitly calls out `defaultMode: "auto"` as something to add to settings.

### 5. Build agent's permission ruleset (`src/agent/agent.ts`, lines 117-153)

The build agent (the default/primary agent) gets its permissions from merging three sources:

1. **`defaults`** (lines 117-134):
   - `"*": "allow"` — everything allowed by default
   - `doom_loop: "ask"` — repeated tool calls ask for permission
   - `external_directory: { "*": "ask", whitelistedDirs: "allow" }` — external dirs require approval
   - `question: "deny"` — interactive questions denied
   - `plan_enter/plan_exit: "deny"` — plan mode transitions denied
   - `read: { "*": "allow", "*.env": "ask", "*.env.example": "allow" }` — env files require approval

2. **Agent-specific overrides** (lines 143-149):
   - `question: "allow"` — build agent CAN ask questions (overrides default deny)
   - `plan_enter: "allow"` — build agent CAN enter plan mode
   - `plan_exit: "deny"` — but cannot exit plan mode

3. **`user`** (line 136): User-configured permissions from `cfg.permission`, applied last (highest precedence).

The merged ruleset is: `Permission.merge(defaults, Permission.fromConfig({ question: "allow", plan_enter: "allow" }), user)`

**Other agents** (lines 154-262):

- **plan** agent: denies all `edit` tools except `.opencode/plans/*.md`
- **general** subagent: denies `todowrite`
- **explore** subagent: denies everything except read-only tools (grep, glob, list, bash, webfetch, websearch, read)
- **compaction/title/summary** hidden agents: deny everything (`"*": "deny"`)

### 6. How permissions flow through tool execution (`src/session/tools.ts`)

When a tool is called, the `context.ask()` function (line 63-71) is invoked:

```ts
ask: (req) =>
  permission
    .ask({
      ...req,
      sessionID: input.session.id,
      tool: { messageID: input.processor.message.id, callID: options.toolCallId },
      ruleset: Permission.merge(input.agent.permission, input.session.permission ?? []),
    })
    .pipe(Effect.orDie)
```

The ruleset is the **agent's permission merged with the session's permission** (if any). The agent's permission is the ruleset defined in `agent.ts` for that agent type.

### 7. Subagent permission derivation (`src/agent/subagent-permissions.ts`)

When a subagent session is spawned via the task tool, permissions are derived from the parent:

- Parent's `deny` rules and `external_directory` rules are inherited
- `todowrite` is denied unless the subagent's own ruleset permits it
- `task` is denied unless the subagent's own ruleset permits it

### 8. ACP permission handling (`src/acp/permission.ts`)

The ACP (Agent Client Protocol) handler bridges permission requests to the ACP client's `requestPermission` API. It presents three options: "Allow once", "Always allow", "Reject". If the ACP client doesn't support `requestPermission`, it defaults to reject.

### 9. Doom loop detection (`src/session/processor.ts`, lines 524-546)

When the same tool call repeats DOOM_LOOP_THRESHOLD times, it triggers a `doom_loop` permission check. This is the only place where the `doom_loop` permission action is actually used.

## Relevant Prior Art

- **Claude Code's `auto` mode** is explicitly referenced in the proposal as the inspiration. It uses a classifier-based approach that auto-approves safe actions while routing risky ones through safety evaluation.
- **The existing `--auto` flag** in `run.ts` is a precursor — a binary auto-approve/auto-reject switch that predates the proposed classifier system.
- **The `--dangerously-skip-permissions` flag** is mentioned in the proposal as the flag to be replaced. It was not found in the current codebase (the grep for `dangerously-skip-permissions` only found it in the proposal text itself), suggesting it may have already been removed or renamed.

## Risks and Unknowns

1. **`--auto` flag description is misleading**: The describe text says "auto-approve permissions that are not explicitly denied" but the implementation approves _everything_ regardless of deny rules. This is a pre-existing bug in the current implementation.

2. **No existing auto-mode infrastructure**: The `src/auto-mode/` directory doesn't exist. The proposal calls for creating `rules.ts` (safety rules) and `service.ts` (AutoMode service) from scratch.

3. **Classifier rules are not defined**: The proposal mentions rule categories (safe/risky/blocked) but doesn't specify concrete rules. This is a significant design gap.

4. **Integration complexity**: The AutoMode service needs to integrate with the existing `Permission.ask()` flow, which means either wrapping the Permission service or injecting into the evaluation chain. The proposal says "safe actions skip `Permission.ask()`" but doesn't specify the mechanism.

5. **Config schema changes**: Adding `permissions.defaultMode` requires changes to both the config schema (`config.ts`) and the migration layer (`migrate.ts`).

6. **ACP compatibility**: The ACP permission handler (`src/acp/permission.ts`) currently only supports "once/always/reject" replies. If auto mode introduces new behaviors (e.g., auto-approve safe actions), the ACP handler may need updates.

7. **What "explicitly denied" means in context**: The current `--auto` flag doesn't check deny rules at all. The proposed system would need to distinguish between "explicitly denied by config" and "not explicitly allowed" — this is a semantic distinction the current implementation doesn't make.

## Recommendation

The architect should prioritize:

1. **Fix the `--auto` flag description** to match its actual behavior (or fix the implementation to match the description). This is a pre-existing inconsistency.

2. **Design the AutoMode service interface** before implementation. Key decisions:
   - Should `AutoMode` wrap `Permission.Service` or sit alongside it?
   - How does `defaultMode: "auto"` in config interact with `--auto` CLI flag?
   - What's the exact contract between "safe" auto-approve and "risky" ask-with-suggestion?

3. **Start with the ruleset** (`src/auto-mode/rules.ts`). Define concrete rule categories and the `evaluateAction` function signature. This is the core logic that everything else depends on.

4. **Plan the config schema changes** early. The proposal calls for `permissions.defaultMode` with values like `default`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`. This maps to the existing `PermissionV1.Action` type (`"allow"`, `"deny"`, `"ask"`) plus two new modes. Consider whether these should be new action values or handled differently.

5. **The tasks.md is a good starting point** but needs refinement on task 1.2 (AutoMode service integration) — specifically how the service plugs into the existing `Permission.ask()` flow in `session/tools.ts`.

<promise>RESEARCH_DONE</promise>
