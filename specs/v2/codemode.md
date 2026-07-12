# Detailed Handoff: OpenCode V2 CodeMode Tool Catalog

## Purpose

This document captures the complete gang-grill outcome for redesigning V2 Tool registration, CodeMode catalog presentation, namespace semantics, and dynamic Instructions. It is intended to let a fresh implementation agent proceed without access to the original Slack conversation.

This is a design handoff, not an implementation report.

## Repository and tracking

- Repository: `anomalyco/opencode`
- Target branch: `v2`
- Latest ref inspected during discussion: `1c67004999` on 2026-07-10
- Primary tracker: https://github.com/anomalyco/opencode/issues/36196
- Related architecture tracker: https://github.com/anomalyco/opencode/issues/35364
- Source Slack thread: https://slack.com/archives/C0BE69AHCQP/p1783709543707769
- No implementation worktree, branch, commit, or PR remains from this session. A local implementation was started because of a misunderstanding, immediately stopped, and deleted. Nothing was pushed.

---

# Executive decision summary

1. **Tool remains the canonical capability.** CodeMode consumes Tools; ordinary Tool authors do not need to understand CodeMode.
2. **Tools enter CodeMode by default.** `codemode: false` opts a Tool into the provider's top-level/native Tool list.
3. **Tool definitions are flat objects.** Promise already has this public shape; Effect should support it too without requiring `Tool.make(...)` in ordinary usage.
4. **`namespace`, `codemode`, and `pinned` are first-class Tool-definition fields.**
5. **Namespaces are optional, explicitly describable, implicitly created, nested through dotted strings, and may themselves be callable Tools.**
6. **The provider-level `execute` Tool stays stable.** Dynamic Tool catalog text moves into one agent-filtered Instruction source.
7. **CodeMode owns catalog semantics and rendering.** OpenCode owns permission filtering, budget selection, and durable Instruction lifecycle.
8. **Small catalogs inline all signatures; large catalogs show compact namespace guidance plus pinned signatures, using a token budget rather than Tool count.**
9. **Catalog changes produce semantic Instruction deltas.** Use a full replacement when smaller or when compact/full mode changes.
10. **Search remains exactly as currently implemented for now.** Async Tool calls and `Promise.all` also remain.
11. **Persist one whole deterministic, content-addressed catalog snapshot initially.** Do not prematurely build per-Tool storage.
12. **No Tool watchers or execution wakeups.** Recompute from current visible Tools whenever an LLM request is already being built.

---

# Proposed public API shapes

The exact exported type names may change during implementation, but these call-site shapes were agreed.

## Canonical Tool definition

```ts
type ToolDefinition<Input, Output> = {
  name: string

  /** Dotted CodeMode path prefix, e.g. "slack.admin". */
  namespace?: string

  /** Defaults to true. False exposes the Tool directly to the provider. */
  codemode?: boolean

  /** Defaults to false. Valid only when codemode !== false. */
  pinned?: boolean

  description: string
  input: Schema.Codec<Input, unknown>
  output: Schema.Codec<Output, unknown>
  execute: (input: Input, context: ToolContext) => Promise<Output> | Effect.Effect<Output, ToolFailure, unknown>
}
```

Dynamic adapter-backed Tools retain the corresponding JSON Schema shape:

```ts
type DynamicToolDefinition = {
  name: string
  namespace?: string
  codemode?: boolean
  pinned?: boolean
  description: string
  jsonSchema: JsonSchema
  outputSchema?: JsonSchema
  execute: (input: unknown, context: ToolContext) => Promise<DynamicOutput> | Effect.Effect<DynamicOutput, ToolFailure>
}
```

The Promise and Effect APIs may still differ at the async boundary, but they should share the same flat declaration model.

## Promise plugin example

```ts
import { Plugin } from "@opencode-ai/plugin/v2"
import { Schema } from "effect"

export default Plugin.define({
  id: "slack-tools",

  setup: async (ctx) => {
    await ctx.tool.transform((draft) => {
      draft.namespace.add({
        name: "slack",
        description: "Read and act in Slack",
      })

      draft.add({
        name: "send",
        namespace: "slack",
        pinned: true,
        description: "Send a Slack message",
        input: Schema.Struct({
          channel: Schema.String,
          text: Schema.String,
        }),
        output: Schema.Struct({ sent: Schema.Boolean }),
        execute: async ({ channel, text }) => sendSlackMessage(channel, text),
      })

      draft.add({
        name: "edit",
        codemode: false,
        description: "Edit a file",
        input: EditInput,
        output: EditOutput,
        execute: edit,
      })
    })
  },
})
```

## Effect plugin example

The desired Effect shape is equally flat:

```ts
import { Plugin } from "@opencode-ai/plugin/v2/effect"
import { Effect, Schema } from "effect"

export default Plugin.define({
  id: "slack-tools",

  effect: Effect.fn(function* (ctx) {
    yield* ctx.tool.transform((draft) => {
      draft.namespace.add({
        name: "slack",
        description: "Read and act in Slack",
      })

      draft.add({
        name: "send",
        namespace: "slack",
        pinned: true,
        description: "Send a Slack message",
        input: Schema.Struct({
          channel: Schema.String,
          text: Schema.String,
        }),
        output: Schema.Struct({ sent: Schema.Boolean }),
        execute: ({ channel, text }) => sendSlackMessage(channel, text),
      })
    })
  }),
})
```

The group explicitly wants normal Effect usage not to require this nested construction:

```ts
draft.add("send", Tool.make({ ... }), options)
```

An opaque/private constructor may still exist internally; the public Draft interaction should be flat.

## Namespace declaration

```ts
type NamespaceDefinition = {
  name: string
  description: string
}

interface ToolDraft {
  add(tool: ToolDefinition | DynamicToolDefinition): void

  namespace: {
    add(namespace: NamespaceDefinition): void
  }
}
```

Explicit namespace registration is optional:

```ts
draft.namespace.add({
  name: "slack",
  description: "Read and act in Slack",
})
```

A Tool implicitly creates its namespace when metadata was not registered:

```ts
draft.add({
  name: "send",
  namespace: "slack",
  // ...
})
```

`description` was chosen over `summary` to match existing Tool, Skill, agent, and model-facing vocabulary.

## MCP registration example

MCP Tools are the primary immediate consumer:

```ts
await ctx.tool.transform((draft) => {
  for (const server of servers) {
    const configuredDescription = namespaceDescriptions[server.name]

    if (configuredDescription) {
      draft.namespace.add({
        name: server.name,
        description: configuredDescription,
      })
    }

    for (const remote of server.tools) {
      draft.add({
        name: remote.name,
        namespace: server.name,
        description: remote.description ?? "",
        jsonSchema: remote.inputSchema,
        outputSchema: remote.outputSchema,
        execute: (input, context) =>
          callMcpTool({
            server: server.name,
            tool: remote.name,
            input,
            context,
          }),
      })
    }
  }
})
```

MCP facts established during the grill:

- MCP Tools do not carry a protocol-level namespace field.
- OpenCode already carries each Tool's configured server name.
- The configured server name becomes the namespace.
- MCP servers may provide an initialization `instructions` string, but not the concise namespace description this design wants.
- Server `instructions` remain their existing Instruction source.
- Individual MCP Tools and JSON Schema properties can carry descriptions; these become catalog metadata.

---

# Namespace semantics

## Dotted nested paths

Use validated dotted namespace strings:

```ts
{
  name: "invite",
  namespace: "slack.admin.users",
}
```

Model-visible path:

```ts
tools.slack.admin.users.invite(...)
```

Arrays were considered and rejected for now:

```ts
namespace: ["slack", "admin", "users"] // not chosen
```

Validation should reject empty/invalid segments and must not silently normalize names.

## Callable namespaces

One path may be both a Tool and a namespace:

```ts
tools.slack.admin(...)
tools.slack.admin.invite(...)
```

This is valid JavaScript: functions can own properties. CodeMode currently treats a node as either a Tool leaf or a namespace branch, so supporting callable namespace nodes is a focused required CodeMode change.

Conceptual internal representation:

```ts
type ToolNode = {
  tool?: Tool
  children: Map<string, ToolNode>
}
```

The public host representation used by `@opencode-ai/codemode` was not settled. Do not assume the temporary API name `Tool.withChildren`; implement the smallest representation consistent with the canonical flat Tool registry.

## Scoped collisions

Exact same-path registrations keep current scoped semantics:

```text
latest active registration wins
plugin disposal reveals the previous registration
```

Apply the same rule to explicit namespace descriptions. An implicit namespace must never override explicit metadata.

The group initially considered rejecting Tool/namespace leaf-branch conflicts, then explicitly reversed that decision after recognizing callable objects. Parent and child paths must coexist.

---

# `codemode` and native Tool projection

## Defaults

```ts
draft.add(slackSend) // codemode defaults true

draft.add({
  ...edit,
  codemode: false,
})
```

- Ordinary visible Tools enter CodeMode by default.
- `codemode: false` opts into the provider's native Tool field.
- The `execute` Tool itself uses `codemode: false`; therefore it does not recursively appear inside CodeMode.
- If zero CodeMode Tools are visible to the selected agent, omit `execute`, omit CodeMode Instructions, and omit empty namespaces.
- Avoid exposing one capability both natively and through CodeMode.

The group considered names such as `exposure`, `surface`, `presentation`, `deferred`, and `group`. Final decisions:

- Never use `exposure`.
- Replace current `deferred` semantics with `codemode`.
- Spell `codemode` all lowercase.
- Replace `group` with `namespace`.

## Deferred native-name question

The exact provider Tool name for this shape was explicitly deferred:

```ts
{
  name: "invite",
  namespace: "slack.admin",
  codemode: false,
}
```

`slack_admin_invite` was recommended because it preserves current flattening, but the group requested implementation ignore this question for now.

---

# Pinned Tools

`pinned` is first-class Tool metadata:

```ts
draft.add({
  name: "read",
  namespace: "filesystem",
  pinned: true,
  description: "Read a file",
  input: ReadInput,
  output: ReadOutput,
  execute: read,
})
```

Meaning:

- Pinned CodeMode Tools receive complete model-facing signatures in dynamic Instructions even when the rest of the catalog is compact.
- Pinning affects model guidance only, not permission, execution, or provider-level placement.
- Permission filtering happens before pinned signatures are rendered.
- `pinned` only applies to CodeMode Tools.
- Reject this meaningless combination:

```ts
{ codemode: false, pinned: true }
```

Native Tools are already fully described in the provider Tool field.

---

# LLM request shape

## Current V2 behavior

Today V2 roughly sends:

```ts
LLM.request({
  system: [
    SystemPart.make(agentSystemOrProviderPrompt),
    SystemPart.make(initialInstructions),
  ],

  messages: sessionHistoryWithInstructionUpdates,

  tools: [
    directBuiltIns,
    {
      name: "execute",
      description: CodeMode.make({ tools }).instructions(),
      inputSchema: {
        type: "object",
        properties: { code: { type: "string" } },
        required: ["code"],
      },
    },
  ],
})
```

The dynamic CodeMode catalog currently lives inside `execute.description`, which changes the provider Tool definition whenever the catalog changes.

## Agreed target

Keep `execute` stable:

```ts
{
  name: "execute",
  description: `
Run confined JavaScript through { code }.
Call capabilities through tools.
Use the existing CodeMode search API to discover exact signatures.
Await important calls; use Promise.all for independent calls.
`,
  inputSchema: {
    type: "object",
    properties: { code: { type: "string" } },
    required: ["code"],
  },
}
```

The exact invariant prose can continue to come from CodeMode. It must not include changing Tool/namespace catalog data.

Dynamic catalog data becomes a durable Instruction source.

---

# CodeMode Catalog API and ownership

The exact public names below were illustrative, but the ownership boundary and data flow were agreed.

```ts
const visible = toolRegistry.materialize({
  agent,
  permissions,
})

const catalog = CodeMode.Catalog.build({
  tools: visible.codemodeTools,
  namespaces: visible.namespaces,
  tokenBudget: 2_000,
})
```

CodeMode should return a deterministic structured snapshot and pure renderers:

```ts
type CatalogSnapshot = {
  mode: "full" | "compact"
  namespaces: ReadonlyArray<{
    name: string
    description?: string
    toolCount: number
  }>
  tools: ReadonlyArray<{
    path: string
    description: string
    signature: string
    pinned: boolean
  }>
}

CodeMode.Catalog.diff(previous, current)
// {
//   added,
//   removed,
//   changed,
// }

CodeMode.Catalog.renderInitial(current)
CodeMode.Catalog.renderChanged(previous, current)
```

## Final ownership boundary

CodeMode owns:

- canonical Tool descriptors
- exact generated signatures
- namespace and pinned semantics
- search indexing
- full/compact planning
- catalog structural diffing
- canonical pure initial/update rendering

OpenCode owns:

- selected-agent and permission filtering
- supplying the configured/default token budget
- composing the CodeMode Instruction source
- durable value/hash persistence
- chronology and request delivery

This final boundary supersedes an earlier suggestion that OpenCode own catalog rendering.

---

# Dynamic Instruction source

Illustrative integration:

```ts
Instructions.make({
  key: "core/codemode",
  codec: CodeMode.Catalog.Snapshot,
  read: buildCurrentVisibleCodeModeCatalog(),
  render: {
    initial: CodeMode.Catalog.renderInitial,
    changed: CodeMode.Catalog.renderChanged,
  },
})
```

The key name `core/codemode` was illustrative rather than separately bikeshedded.

## Initial rendering

- If all visible signatures fit within the token budget, inline all full signatures.
- Otherwise render compact namespace guidance plus every pinned signature.
- Always determine size by estimated tokens, not Tool count.
- Initial recommended/default budget: 2,000 tokens.

Example compact shape:

```md
CodeMode catalog metadata follows. It describes callable APIs.

Namespaces:
- slack (23) — Read and act in Slack
- github.actions (14) — Manage GitHub Actions

Pinned:
- tools.filesystem.read(input: ...): Promise<...>
```

The exact fallback when a large namespace has no explicit description was explicitly deferred. A capped sorted Tool-name list plus `… +N` was recommended but not locked.

## Mid-conversation changes

Render semantic deltas:

```md
CodeMode catalog changed:

Added:
- tools.slack.canvas.create(...)

Removed:
- tools.slack.legacyPost

Changed:
- tools.github.issue.update(input: NewInput): Promise<NewOutput>
```

Use a full replacement when:

- the full rendering is smaller than the semantic delta, or
- the catalog crosses between full and compact rendering modes.

Tool permission changes and agent changes naturally appear as additions/removals because filtering happens before snapshot construction.

## No new lifecycle

Do not add Tool watchers, Session wakeups, timers, or a special "safe boundary" subsystem.

Immediately before each LLM request, when the runner is already doing ordinary request assembly:

```ts
const visible = toolRegistry.visibleFor(selectedAgent)
const catalog = CodeMode.Catalog.build(visible)
```

- If the Session is idle, nothing happens.
- An in-flight provider request remains unchanged.
- The next request sees the current catalog.
- If a removed Tool is somehow called and cannot resolve, an ordinary unknown-Tool failure is acceptable.

---

# Durable storage

The existing Instructions algebra already supplies previous and current typed values to pure renderers:

```ts
changed: (previous, current) =>
  CodeMode.Catalog.renderChanged(previous, current)
```

Expected flow:

1. Build deterministic model-facing catalog snapshot.
2. Canonically encode and hash it.
3. Store the snapshot once in global `instruction_blob`.
4. Persist only `{ "core/codemode": hash }` in the durable Instruction delta.
5. At request assembly, hydrate old/new values and render the semantic change.

Store only model-facing descriptor data:

- paths
- descriptions
- signatures
- namespace metadata
- pinned/full/compact planning state as needed for deterministic replay

Do not store:

- executors or closures
- raw OpenAPI specs
- credentials
- permission internals

Identical snapshots deduplicate globally across Sessions. Whole-snapshot replacement is accepted for the first version. If measured catalog churn later causes meaningful storage growth, consider per-Tool blobs plus a manifest; do not build that now.

---

# Search and language semantics

Several simplifications were explored and then explicitly deferred.

## Final search decision

Leave current search unchanged:

```ts
await tools.$codemode.search({
  query: "upload Slack file",
  namespace: "slack",
  limit: 10,
  offset: 0,
})
```

Current result remains the paginated object containing exact paths, descriptions, and signatures.

Ideas considered but not selected now:

```ts
search("upload Slack file")
search("ns:slack upload file")
```

A synchronous global `search` and plain-array result were discussed, briefly preferred, and then explicitly reverted in favor of leaving search alone.

## Async Tool calls

Keep normal JavaScript async semantics:

```ts
const user = await tools.slack.user({ id })
const messages = await tools.slack.messages({ user: user.id })
```

Keep explicit concurrency:

```ts
const [issue, pull] = await Promise.all([
  tools.github.issue({ number: 1 }),
  tools.github.pull({ number: 2 }),
])
```

Do not make Tool calls magically synchronous. Do not change the DSL to Haskell. Do not introduce Haxl-style query/command classification or batching without a demonstrated datasource need.

---

# Agent and permission behavior

Catalog construction must know the selected agent and its effective permissions.

```ts
const visible = toolRegistry.materialize({
  agent: selectedAgent,
  permissions: effectivePermissions,
})
```

Requirements:

- Denied Tools are omitted entirely from native definitions, CodeMode catalog, pinned signatures, search, and namespace counts.
- Denied subagents are omitted from the subagent Tool's available choices.
- Do not advertise a Tool and rely on a later denial for ordinary catalog visibility.
- Runtime authorization remains inside the canonical Tool/permission path. Catalog filtering is visibility, not the final authorization boundary.

---

# MCP metadata trust decision

Clarification:

- MCP servers do not provide a concise server description.
- MCP Tools may provide `description`.
- Tool input/output JSON Schema fields may provide `description`.
- Server initialization may provide `instructions`, which is separate.

The catalog may therefore contain configured third-party metadata such as:

```ts
tools.slack.send_message(input: {
  /** Channel to send into */
  channel: string
}): Promise<unknown> // Send a Slack message
```

The group explicitly decided to accept this as configured extension content and not add special security/sanitization machinery. A single stable framing sentence is fine; the overall token budget is sufficient bounding for now.

---

# Complete gang-grill decision log

## Q1 — Canonical Tool or separate CodeMode registry?

**Question:** Should Tools be canonical and CodeMode project them, or should CodeMode own a second registry?

**Answer:** Canonical Tool registry/type. Tool authors need not know CodeMode exists; CodeMode consumes canonical Tools downstream. Do not duplicate registration, permission, or execution paths.

## Q2 — Native versus CodeMode routing API?

**Question:** Should each Tool be annotated with placement or should a separate runtime policy decide?

**Answer:** Tools default into CodeMode. Add an opt-out boolean because some built-ins/custom edit Tools must remain provider-level. After rejecting several names, the group chose lowercase `codemode: false`.

Superseded names: `exposure`, `surface`, `presentation`, `route`, `deferred`.

## Q3 — What stays in `execute.description`?

**Question:** Should dynamic namespaces/signatures remain in the native Tool description?

**Answer:** No. Keep only invariant language/runtime/search/safety guidance in the stable native description. Move changing namespace summaries, counts, and signatures into Instructions.

## Q4 — Rename `execute`?

**Question:** Consider `run`, `exec`, or another name to distance it from "executor."

**Answer:** Keep `execute`.

## Q5 — Simplify search syntax?

**Question:** Replace `tools.$codemode.search(...)` with a global/string-based `search(...)`?

**Answer:** Final answer is no change for now. Keep current search API. Earlier preferences for synchronous/string search were superseded.

## Q6 — Grouping concept?

**Question:** `group`, `category`, `module`, or `namespace`?

**Answer:** `namespace`. It creates the actual callable path and is a first-class Tool concept. Remove current `group` wording.

## Q7 — Namespace registration spelling?

**Question:** `draft.namespace.add(...)` or `draft.addNamespace(...)`?

**Answer:** `draft.namespace.add(...)`.

## Q8 — Nested namespace representation?

**Question:** Dotted string or string array?

**Answer:** Validated dotted string. Arrays add ceremony without a demonstrated need.

## Q9 — Pinned Tool metadata?

**Question:** Should `pinned` be a first-class Tool field?

**Answer:** Yes. Default false. CodeMode-only. Pinned Tools retain full signatures in compact catalogs.

## Q10 — Namespace fallback without description?

**Question:** What is shown for implicit namespaces with no description?

**Answer:** Small catalogs inline all signatures. For large catalogs, a capped Tool-name fallback was recommended but exact rendering was later explicitly deferred.

## Q11 — Tool count or token budget?

**Question:** Decide full/compact mode using Tool count or estimated tokens?

**Answer:** Token budget. Initial recommendation/default: 2,000 tokens.

## Q12 — Delta or full replacement?

**Question:** How should catalog changes appear mid-conversation?

**Answer:** Semantic added/removed/signature-changed delta. Full replacement when smaller or when compact/full mode changes.

## Q13 — Diff/render ownership?

**Question:** CodeMode or OpenCode?

**Answer:** Final revised answer: CodeMode owns structured catalog semantics, diffing, planning, and canonical pure renderers. OpenCode filters visible Tools and transports snapshots through Instructions.

## Q14 — Synchronous search?

**Question:** Should local catalog search be synchronous?

**Answer:** Initially yes, but this was later explicitly superseded. Search stays current/async for now.

## Q15 — `summary` or `description`?

**Question:** Namespace metadata field name?

**Answer:** `description`.

## Q16 — Exact-path duplicate registration?

**Question:** Error or last registration wins?

**Answer:** Preserve current scoped latest-active-wins semantics; disposal reveals previous registration.

## Q17 — Tool path also a namespace?

**Question:** Reject leaf/branch conflict or permit both?

**Answer:** Permit both. JavaScript callable objects support properties. This reversed the initial rejection recommendation.

## Q18 — MCP description trust?

**Question:** Do MCP descriptions need special sanitization before system Instructions?

**Answer:** No extra machinery. Treat configured MCP Tool/schema descriptions as accepted extension metadata. Server `instructions` remain separate.

## Q19 — Search result plain array?

**Question:** Simplify search to a top-10 array?

**Answer:** No change for now. Keep current paginated search object.

## Q20 — Tool-change lifecycle?

**Question:** Watch Tools or wake Sessions when the catalog changes?

**Answer:** No. Recompute when already assembling each LLM request. Missing calls may fail normally.

## Q21 — Empty CodeMode behavior?

**Question:** What if no visible CodeMode Tools exist?

**Answer:** Omit `execute`, CodeMode Instructions, and empty namespaces.

## Q22 — Namespaced native Tool flattening?

**Question:** How should `{ namespace: "slack.admin", name: "invite", codemode: false }` lower to a provider Tool name?

**Answer:** Explicitly deferred/ignored. `slack_admin_invite` was recommended but not locked.

## Tangent — Haxl/Haskell DSL?

**Question:** Should implicit concurrency remove `await` or should CodeMode become Haskell/Haxl-like?

**Answer:** No. Keep JavaScript, `await`, and `Promise.all`. Haxl-style batching requires a real query/command distinction and demonstrated need.

---

# Explicitly deferred / ignored questions

The implementation handoff should not reopen these before useful progress:

1. Exact native/provider name for namespaced `codemode: false` Tools.
2. Exact compact fallback text when a large namespace has no explicit description.
3. Public OpenCode configuration path/name for the catalog token budget.
4. Simplified search syntax/result shape.
5. Per-Tool content-addressed blob storage.
6. Haxl-style query batching or synchronous-looking Tool calls.

Use the simplest compatible behavior, preserve current behavior where possible, and file narrow follow-ups if implementation genuinely forces a choice.

---

# Suggested implementation sequence

1. **Public Tool declarations**
   - Add flat Effect Draft declarations matching Promise ergonomics.
   - Add `namespace`, `codemode`, and `pinned` fields and validation.
2. **Namespace registry**
   - Add scoped `draft.namespace.add({ name, description })`.
   - Add implicit namespace creation from Tool declarations.
   - Add dotted-path validation.
3. **Callable namespace support**
   - Change CodeMode's tool tree/catalog/runtime representation so a node may hold both a Tool and children.
   - Do not settle an unnecessary host helper API before seeing the canonical registry adapter.
4. **Structured CodeMode catalog**
   - Separate invariant execute guidance from dynamic catalog data.
   - Preserve current search behavior.
   - Add deterministic snapshot, planning, diff, and pure render APIs.
5. **Tool materialization**
   - Partition selected-agent-visible Tools into native (`codemode: false`) and CodeMode sets.
   - Validate `pinned` combinations.
   - Omit empty CodeMode entirely.
6. **Instruction integration**
   - Compose the CodeMode source explicitly in `SessionRunner.loadInstructions`.
   - Persist deterministic descriptor-only snapshots through existing Instruction CAS.
   - Render initial/full/compact and semantic updates.
7. **MCP adapter**
   - Use server names as namespaces.
   - Keep server instructions in existing guidance source.
8. **Tests and docs**
   - Permission omission and agent switches.
   - Exact-path scoped overrides.
   - Callable parent/child paths.
   - Pinned validation.
   - Token-budget transitions.
   - Semantic delta versus full replacement.
   - Durable replay and blob deduplication.
   - Empty CodeMode behavior.
   - Update `packages/codemode/README.md`, `packages/codemode/codemode.md`, and relevant architecture notes.

---

# Verification and publication

- Create a dedicated branch/worktree from current `origin/v2`.
- Do not edit V1 `packages/opencode`.
- Run package tests from package directories, never repository root.
- Run `bun typecheck` from every changed package.
- Preserve one explicit `llm.stream(request)` per Physical Attempt.
- Run simplification review before publication.
- Push a dedicated branch and open a draft PR assigned to the requesting owner when requested.

## Suggested skills

- `opencode`
- `tdd`
- `codebase-design`
- `simplify`
