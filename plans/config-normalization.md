# Mixed V1/V2 Config Normalization Plan

Status: **Implemented and verified**

## Goal

Replace whole-document V1/V2 detection with one compatibility pipeline that accepts native V2 configuration, supported V1 configuration, and practical mixtures of both without allowing an unrelated legacy key to change how the rest of the document is interpreted.

The loader should produce one canonical V2 `Config.Info`. Valid configuration should load quietly. Conflicts, malformed recognized values, and unsupported legacy settings should be logged without preventing unrelated valid settings from loading.

## Current Failure

`packages/core/src/config.ts` currently chooses one schema for the complete document:

```text
parse JSONC
    -> ConfigMigrateV1.isV1(raw)
    -> decode all as V1 and migrate, or decode all as V2
```

The decision is based on a small set of top-level keys plus one special `mcp` check. This makes mixed files unstable:

- A V1-only key such as `snapshot` sends native V2 fields through the V1 decoder.
- V2 fields ignored by the permissive V1 decoder can disappear silently.
- A V2-shaped shared field such as `skills` can make the entire V1-selected document fail.
- Shared fields such as `mcp`, `compaction`, and `experimental` may contain both old and new members, so a document-level answer is not meaningful.
- Adding or removing an unrelated key can change how a model or provider reference is migrated.

## Decision

Normalize recognized fields independently into the **encoded domain** of the V2 schema, then perform one final V2 decode:

```text
JSON/JSONC encoded input
    -> parse raw object and retain source-property presence
    -> decode each candidate once for validation and schema transforms
    -> encode each successful V2 candidate back to its V2 encoded form
    -> migrate successful V1 candidates into V2 encoded form
    -> merge canonical encoded candidates
    -> decode canonical Config.Info exactly once
    -> log normalization diagnostics
```

There is no whole-document version classification and no independent whole-document V1 and V2 decode.

The encoded boundary is required because V2 schemas are not all identity codecs. For example, `warming.interval` and `warming.duration` decode strings into Effect `Duration` values. Merging decoded values and passing them through `Config.Info` decoding again would reject valid configuration. Successful V2 candidates must therefore be re-encoded before assembly, while V1 migration helpers must continue returning values accepted by the encoded side of the destination V2 schemas.

The implementation may assemble a validated partial V1 value internally so the existing migration functions remain reusable. That is an implementation detail of field normalization, not a version decision for the source document.

## Agreed Behavior

| Decision | Behavior |
| --- | --- |
| Mixing depth | Support top-level mixing and explicitly modeled mixed shapes under `mcp`, `compaction`, and `experimental`. Do not recursively infer versions inside agents, providers, commands, or models. |
| Precedence | A valid native V2 value wins over the equivalent migrated V1 value regardless of JSON key order. |
| Invalid values | Skip malformed recognized values and continue loading unrelated valid configuration. |
| Recovery boundary | Recover only at the units listed in the recovery matrix below. Do not recursively salvage arbitrary nested values. |
| Permission safety | Permissions follow the same recovery policy as other fields; there is no fail-closed exception. |
| Ordered values | Keep both forms, with migrated V1 entries first and native V2 entries last. |
| Diagnostics | Log conflicts, skipped malformed values, and unsupported legacy settings. |
| Valid legacy syntax | Do not warn merely because supported V1 syntax was used. |
| Unsupported legacy behavior | Preserve the current migration scope. Do not rebuild removed V1 features as part of this change. |
| Provider identities | Config format normalization must not use specific provider IDs as version signals. Legacy provider compatibility belongs to model/provider selection after exact identity lookup. |

Malformed JSON cannot be recovered field-by-field. It should reject that document and produce a warning naming the source. Syntactically valid non-object roots such as `null`, arrays, strings, booleans, and numbers also return a rejected result with one document-level `invalid` diagnostic at root path `$`; they never disappear through an unadorned `undefined` result.

## Normalization Boundary

Add an internal compatibility module under `packages/core/src/config/`. It should follow the config module self-export convention and expose a pure normalization operation conceptually shaped like:

```ts
type Diagnostic = {
  kind: "conflict" | "invalid" | "unsupported"
  path: readonly string[]
  message: string
}

type Result =
  | {
      type: "normalized"
      // Every retained value is compatible with the encoded side of Config.Info.
      encoded: Readonly<Record<string, unknown>>
      diagnostics: readonly Diagnostic[]
    }
  | {
      type: "rejected"
      diagnostics: readonly Diagnostic[]
    }

function normalize(input: unknown): Result
```

The exact return type may remain a record internally to avoid a circular import with `Config.Info`, but its contract is a presence-aware partial `typeof Config.Info.Encoded`, never a partial `Config.Info.Type`. The separation is important:

- normalization remains pure and directly testable;
- filesystem paths and virtual source names remain loader concerns;
- logging stays at the effectful loading boundary;
- candidate decoders may use schema transforms without leaking decoded values into the assembled object;
- the final `Config.Info` decode remains the only complete-document decode and the invariant check for canonical output.

For a native candidate, validation follows `decode candidate -> encode candidate`. For a V1 candidate, validation follows `decode V1 candidate -> migrate to V2 encoded candidate`. Source paths and explicit property presence are retained separately because decoded `Schema.Class` values materialize absent optionals as `undefined`.

Every candidate decoder uses the loader's existing decode options:

```ts
{ errors: "all", onExcessProperty: "ignore", propertyOrder: "original" }
```

`propertyOrder: "original"` is a semantic requirement, not cosmetic. V1 permission migration and agent permission normalization iterate decoded records in user order, and runtime permission precedence is last-match. Granular decoding must preserve the original relative order of schema-declared and arbitrary action keys.

The normalizer should distinguish three categories of input.

### Unambiguous Legacy Fields

These fields are validated with their V1 field or entry schemas and migrated to their canonical destination:

| V1 source | V2 destination | Recovery unit | Precedence |
| --- | --- | --- | --- |
| `snapshot` | `snapshots` | Complete boolean | Below `snapshots` |
| `command` | `commands` | Named command | Below the same name in `commands` |
| `reference` | `references` | Named reference | Below the same name in `references` |
| `plugin` | `plugins` | List item | Before native `plugins` items |
| `autoshare` | `share` | Complete boolean | Below `share`; `false` contributes no explicit value |
| `agent` | `agents` | Named agent | Below `mode` and native `agents` |
| `mode` | `agents` | Named agent | Above `agent`, below native `agents`, and forces `mode: "primary"` |
| `provider` | `providers` | Named provider | Below the same name in native `providers` |
| `tools` | `permissions` | Named tool entry | Before legacy `permission` and native `permissions` |
| `permission` | `permissions` | Action/resource rule | After `tools`, before native `permissions` |
| `attachment` | `media` | Complete object | Below `media` |
| `enabled_providers` | `experimental.policies` | Provider-ID list item | Baseline deny and allows before disabled-provider denies and native policies |
| `disabled_providers` | `experimental.policies` | Provider-ID list item | After enabled-provider policies, before native policies |

The existing V1 migration helpers remain the source of truth for converting values. Refactor them into reusable field-level operations only where necessary; do not duplicate provider, model, agent, command, permission, or plugin conversion logic in the new normalizer.

Two coexistence rules intentionally differ from the current all-V1 migration:

- `reference` and `references` are merged by entry so disjoint definitions survive; native `references` wins duplicate names. The current migration replaces the complete legacy map whenever `references` is present.
- Native maps are merged over migrated maps by entry. The current detector instead sends the complete document through one schema and loses one side.

### Native V2 Fields

Native fields are validated against their V2 field or entry schemas, then re-encoded with the same schema before assembly. Unambiguous V2 fields include `snapshots`, `commands`, `agents`, `providers`, `permissions`, `media`, `plugins`, `websearch`, and `warming`.

Fields whose syntax and semantics are already shared, such as `$schema`, `shell`, `default_agent`, `autoupdate`, `share`, `enterprise`, `username`, `watcher`, `formatter`, `lsp`, `tool_output`, `instructions`, and `references`, pass through the V2 field decoder without being labeled V1 or V2.

`lsp` uses the V2 validation contract. The V1 schema additionally requires `extensions` for custom servers, but provenance is unknowable for this shared shape and V2 deliberately removed that requirement.

`model` is also shared. Its string shorthand is valid V2 syntax, so config normalization does not infer its provenance from unrelated fields or rewrite its provider ID during parsing.

### Shared Fields With Different Shapes

These fields need explicit bounded adapters.

#### Skills

- An array is the V2 shape and each valid string item is retained.
- Any plain object is the V1 shape. Valid string items from optional `paths` and `urls` become one array, preserving paths before URLs.
- An empty or unknown-only V1 object is valid under permissive excess-property handling and normalizes to an explicit empty array.
- Any other value is invalid and is skipped with a diagnostic.

One JSON property cannot contain both complete shapes, so no merge is required within one document.

#### MCP

- V1 server entries may appear directly under `mcp`.
- V2 servers appear under `mcp.servers`.
- V2 timeout configuration appears under `mcp.timeout`.
- V1 `experimental.mcp_timeout` contributes both catalog and execution timeout values.
- Direct V1 servers and V2 servers are combined by name.
- A valid V2 server replaces the complete migrated V1 server with the same name; server objects are not deep-merged.
- If a V2 duplicate is malformed, it is skipped and the valid legacy server remains available.
- Global timeout is merged by leaf: native `startup` has no legacy equivalent, while valid native `catalog` and `execution` values win only their corresponding migrated leaves.
- Empty compatibility containers such as `servers: {}` and `timeout: {}` are omitted rather than synthesized.

The reserved `servers` and `timeout` members use raw discriminators before permissive schema decoding:

1. An object with an own `type` value of `"local"` or `"remote"` is a direct V1 server using the reserved name.
2. An object with an own boolean `enabled` and no `type` is a V1 enabled-only entry using the reserved name; it is omitted with the normal unsupported diagnostic.
3. Otherwise `servers` is decoded as the V2 named-server map.
4. Otherwise `timeout` is decoded as the V2 timeout container. An empty object is valid; a non-empty object must contain at least one recognized `startup`, `catalog`, or `execution` leaf so an unknown-only object cannot decode to an empty timeout through excess-property ignoring.
5. A value failing its selected interpretation is skipped with an invalid diagnostic.

This ordering preserves valid local and remote V1 servers named `servers` or `timeout` without weakening forward-compatible excess-property handling elsewhere.

#### Compaction

- Shared leaves such as `auto` retain their meaning.
- V1 `preserve_recent_tokens` becomes `keep.tokens`.
- V1 `reserved` becomes `buffer`.
- Native `keep.tokens` and `buffer` win when both forms are valid.
- Unsupported legacy leaves such as `tail_turns` and `prune` retain current V2 behavior: omit them and log an unsupported diagnostic.
- Empty compatibility containers such as `keep: {}` are omitted instead of preserving artifacts created by the current whole-object migration.

#### Experimental

- Shared `subagent_depth` is retained.
- V1 provider enable/disable lists generate legacy policy entries.
- Native V2 policies are appended after generated legacy policies.
- V1 `mcp_timeout` contributes to canonical `mcp.timeout` rather than remaining under `experimental`.
- Other unsupported V1 experimental fields are omitted with diagnostics.

`enabled_providers` preserves a distinction between an explicitly empty valid list and a non-empty malformed list:

- an explicit empty list retains current behavior and emits the deny-all baseline;
- a mixed list emits the deny-all baseline plus allows for valid string items, while invalid items are skipped and logged;
- a non-empty list with no valid items contributes no policy, avoiding an accidental deny-all caused solely by malformed entries.

`disabled_providers` emits denies for valid string items only; an empty or wholly invalid list contributes no policies.

## Merge Semantics

Do not use a generic object spread or recursive deep merge. Merge according to the destination field's semantics.

| Destination kind | Rule |
| --- | --- |
| Scalar or atomic object | Use valid V2 when present; otherwise use valid migrated V1. |
| Named map | Union names; use the complete V2 entry for duplicate names. |
| Ordered rules/directives | Migrated V1 entries first, native V2 entries last. |
| Structured shared object | Merge explicitly modeled leaves only. |
| MCP server | Treat each server as atomic on a duplicate name. |

Precedence is applied after validation:

- If both candidates are valid and their canonical encoded values differ, retain V2 and log a conflict.
- If both candidates are valid and their canonical encoded values are deeply equal, retain V2 without a warning.
- If V2 is malformed and V1 is valid, skip V2, log the invalid path, and retain V1.
- If V1 is malformed and V2 is valid, skip V1, log the invalid path, and retain V2.

"Equal" means deep equality after candidate decode/encode and destination-specific omission of synthesized empty compatibility containers. Do not attempt a broader runtime-equivalence algorithm. Structurally different provider or model entries are conflicts even if a downstream consumer might currently treat them alike.

The normalizer must preserve source-property presence while merging. A decoded optional property represented as `undefined` must not erase a lower-precedence value that was actually present. False, zero, an empty string accepted by its schema, an empty array, and an explicitly empty map all count as present values.

The complete precedence chains are:

| Canonical destination | Lowest to highest precedence |
| --- | --- |
| `snapshots` | `snapshot` < `snapshots` |
| `share` | `autoshare` < `share` |
| `references[name]` | `reference[name]` < `references[name]` |
| `agents[name]` | `agent[name]` < `mode[name]` < `agents[name]` |
| `commands[name]` | `command[name]` < `commands[name]` |
| `providers[name]` | `provider[name]` < `providers[name]` |
| `permissions` | `tools` rules < `permission` rules < native `permissions` rules |
| `plugins` | migrated `plugin` items < native `plugins` items |
| `media` | `attachment` < `media` |
| `experimental.policies` | enabled-provider baseline/allows < disabled-provider denies < native policies |
| `mcp.servers[name]` | direct legacy server < native `servers[name]` |
| `mcp.timeout.*` | `experimental.mcp_timeout` < native timeout leaf |
| `compaction.keep.tokens` | `preserve_recent_tokens` < `keep.tokens` |
| `compaction.buffer` | `reserved` < `buffer` |

Current legacy precedence inside one V1 entry remains unchanged: `steps` wins over `maxSteps`; explicit agent permissions override normalized agent tools; explicit agent `temperature` and `top_p` override request option keys; provider `api` overrides `options.baseURL`; and a current provider ID declaration wins over its retired V1 alias before native `providers` is overlaid.

## Granular Validation

Validation recovers only at the boundaries in this matrix:

| Source | Independent recovery unit | Interior kept atomic |
| --- | --- | --- |
| Scalar fields and atomic objects | Complete field value | Entire value |
| `command`, `commands` | Named command | Command model selection and all command members |
| `agent`, `mode`, `agents` | Named agent | Request/options, nested permissions, and all agent members |
| `provider`, `providers` | Named provider | Models, variants, overlays, env, and every nested provider member |
| Direct V1 MCP and `mcp.servers` | Named server | Command, environment, headers, OAuth, and server timeout |
| `mcp.timeout` | Named timeout leaf | Numeric leaf |
| Formatter object | Named formatter | Complete formatter entry |
| LSP object | Named language server | Complete LSP entry |
| `reference`, `references` | Named reference | Complete string, Git, or local entry |
| `plugin`, `plugins` | List item | Complete string, tuple, or object item |
| Native `permissions` | Rule item | Complete rule |
| Top-level V1 `permission` | Action/resource pair | One effect value; nested agent permissions remain agent-atomic |
| Top-level V1 `tools` | Named tool/action | Boolean value |
| V1 `skills.paths`, `skills.urls`, native `skills` | String item | One string |
| `instructions` | String item | One string |
| `enabled_providers`, `disabled_providers` | Provider-ID item | One string while retaining source order |
| Native `experimental.policies` | Policy item | Complete policy |
| `watcher.ignore` | String item | One string |
| `compaction` | Recognized leaf | `keep.tokens` is one leaf |
| `experimental` | `subagent_depth`, `mcp_timeout`, or one policy item | No arbitrary recursive recovery |

One malformed model inside a provider therefore skips that named provider, not merely the model and not the complete `providers` map. One malformed nested permission inside an agent skips that named agent. These boundaries match the decision not to recursively infer or salvage arbitrary nested V1/V2 mixtures.

Candidate decoding retains the current permissive excess-property behavior rather than making every nested struct strict. Unknown top-level and nested fields remain ignored for forward compatibility. The normalizer separately recognizes and diagnoses only the explicit unsupported V1 inventory below. Intentional rest-property behavior must remain intact for V1 agent options, provider options, model options, model variant settings, arbitrary permission actions, and user-named records.

After invalid entries have been removed and encoded values merged, decode the complete canonical object as `Config.Info`. A failure at this stage indicates a normalizer invariant bug or an unsupported interaction; log it and reject the document rather than returning an unchecked partial value.

## Unsupported Legacy Inventory

"Unsupported" means accepted by a V1 schema but absent from canonical V2 behavior after the current migration and final V2 decode. These values are omitted and logged at their precise path; implementing replacements is outside this plan.

| Scope | Unsupported accepted values |
| --- | --- |
| Top level | `logLevel`, `server`, `small_model`, top-level `subagent_depth`, `layout` |
| V1 agent | `name` |
| V1 MCP | A direct enabled-only entry without `type` |
| V1 compaction | `tail_turns`, `prune` |
| V1 experimental | `disable_paste_summary`, `batch_tool`, `openTelemetry`, `primary_tools`, `continue_loop_on_deny` |
| V1 provider | `id`, `whitelist`, `blacklist` |
| V1 provider model | `release_date`, `attachment`, `reasoning`, `temperature`, `experimental`, non-`deprecated` `status`, boolean `interleaved` |

The following value-sensitive cases also require diagnostics instead of silent loss:

- a V1 model string that does not match the supported `provider/model` form;
- a V1 variant that is empty, contains `#`, or has no valid model reference;
- a legacy provider `options.headers` value that is not a plain object;
- non-string members inside a legacy provider `options.headers` object;
- a legacy provider `options.body` value that is not a plain object.

These overlay failures invalidate and skip the complete named provider according to the provider-atomic recovery boundary; they are not repaired by filtering only the malformed members.

Valid no-op values are not unsupported and remain quiet. In particular, `autoshare: false` contributes no explicit `share`, and empty legacy `api` or `npm` strings contribute no endpoint or package, matching current behavior.

The inventory is normative and should live next to the normalizer as data or explicit branches so tests can cover every item. Do not infer unsupported status merely because a property is unknown to the current binary.

## Provider Alias Boundary

The current V1 migration contains hardcoded aliases for providers that were consolidated in V2. Removing whole-document detection makes the shared top-level `model` field inherently version-neutral, so provider compatibility cannot depend on whether another V1 key happens to be present.

The generic normalizer never branches on a provider ID. Move the existing one-hop alias table behind a provider-owned compatibility selector and keep unambiguous V1 provider declarations, policies, agents, and commands using the existing migration behavior.

### Selection Result

The Location-scoped selector accepts a complete requested `Model.Ref`, including variant, plus an explicit selection mode:

| Mode | Meaning | Current consumers |
| --- | --- | --- |
| `configured` | Exact catalog provider/model presence is sufficient; later package and credential resolution may still fail. | `ModelResolver.resolve(explicit)` and explicit-model `Generate.text` |
| `available` | Provider authentication/disablement and model enablement filters must pass. | Explicit Session selection, configured defaults, and omitted-model generation |

The modes preserve current consumer behavior rather than silently making stateless explicit generation stricter. Both modes use the same identity, claim, policy, and alias rules.

The selector returns one of four states:

| State | Meaning |
| --- | --- |
| `exact` | The requested provider namespace and model satisfy the requested mode and are authoritative. |
| `legacy-provider` | The requested namespace is genuinely absent and a canonical alias target satisfying the requested mode was selected. |
| `fallback-blocked` | Aliasing is forbidden because the source namespace is claimed or a source-only policy denies compatibility. |
| `absent` | Neither an exact selection nor an eligible compatibility target exists. |

An alias is a fallback for an absent provider namespace, not a retry after an exact provider fails. Variant errors, package-load failures, and authorization failures after explicit selection are terminal and never trigger aliasing. An unsupported package is also terminal for explicit requests; omitted/configured-default selection retains its existing separate supported-model fallback described below.

### Namespace Claims And Policies

Final catalog absence is insufficient because provider policy filtering removes denied providers. Catalog rebuild state must retain a set of provider namespaces claimed before filtering; every provider/model update claims its namespace, and later removal does not erase that claim until the next rebuild. This preserves claims from native config and public plugins even if a later policy or transform removes the provider.

Claims are recorded from normalized canonical configuration and catalog transforms, never from raw source keys. A singular V1 declaration such as `provider["azure-cognitive-services"]` migrates to canonical `providers.azure` and claims only `azure`. A native declaration at `providers["azure-cognitive-services"]` retains and claims that exact namespace, blocking fallback. This distinction lets a V1 provider declaration and its unchanged shared model reference use compatibility while protecting an intentional native custom provider with the same old-looking ID.

The effective `provider.use` policy lookup should be extracted from `ConfigPolicyPlugin` and reused by the selector. Compatibility evaluates the requested source and canonical target together:

- the canonical target must be allowed by the effective policy sequence;
- a deny rule that matches the requested source but does not match the canonical target blocks aliasing;
- a baseline rule matching both source and target is governed by the target's later, more specific result.

This distinction preserves an intentional source-only deny while allowing migrated V1 `enabled_providers` behavior. For example, generated `deny "*"` plus `allow "azure"` permits `azure-cognitive-services` to resolve to `azure`, while an explicit deny matching only `azure-cognitive-services` blocks it.

Alias eligibility is therefore:

1. Try the exact provider and model using the explicit `configured` or `available` mode.
2. If exact selection succeeds, return `exact`.
3. If the exact namespace is claimed but does not satisfy the mode, return `fallback-blocked`.
4. If no one-hop compatibility edge exists, return `absent`.
5. Apply the joint source/target policy rule; a source-only deny returns `fallback-blocked`, and a denied target returns `absent`.
6. Look up the canonical target with the same model ID and requested variant under the same selection mode.
7. If the canonical target does not satisfy the mode, return `absent`.
8. Return `legacy-provider` with the canonical catalog identity.

The selector must not borrow provider settings or credentials from the absent legacy namespace. Legacy credential migration, if needed, is a separate explicit data migration.

The selector and claim logic never inspect raw config source keys. Normalized canonical documents and catalog transforms are the only claim inputs.

### Canonical Identity

On compatibility success:

- `Resolved.ref.providerID` is the canonical provider ID;
- `Resolved.ref.id` is the selected canonical catalog model ID;
- `Resolved.ref.variant` preserves the requested variant;
- runtime package, settings, headers, body, capabilities, cost, integration, and credentials come only from the canonical target;
- provider and model listing APIs continue omitting synthetic alias entries;
- the durable Session's selected model is not rewritten as a lookup side effect;
- new assistant and Step records use the canonical resolved identity.

The selection result also retains the transient requested ref and `via` value. Historical message conversion may treat the requested legacy ref and canonical ref as equivalent only when `via === "legacy-provider"`; it must not globally equate an exact custom provider using an old-looking ID with the canonical provider.

### Required Lookup Paths

Provider compatibility must be shared by every model-selection path rather than added only to `ModelResolver.resolve(requested)`:

| Consumer | Required behavior |
| --- | --- |
| Configured root default | Preserve the complete configured `Model.Ref`, including variant, and attempt compatibility before generic default fallback. |
| `ModelResolver.resolve(explicit)` | Use `configured` mode rather than raw `catalog.model.get`, preserving current explicit behavior. |
| `SessionRunnerModel.resolve` | Delegate explicit Session selection with `available` mode instead of independently scanning available models. |
| Stateless `Generate.text` | After plugin settlement, explicit model requests use `configured`; omitted requests resolve the configured default with `available` and then use the supported-model fallback. |
| Model-default server/plugin surfaces | Report the same canonical base provider/model selected for execution, within their existing `Model.Info` response contract. |
| Agents, commands, subagents, titles, compaction, and Session generation | Store exact refs and reach compatibility through the shared Session/model resolver path; do not add local alias rewrites. |

Catalog currently stores configured defaults without the variant and may replace an unresolved configured default with the newest available model before `ModelResolver` sees it. Extend internal `Catalog.DefaultModel` and `Draft.model.default` to carry an optional variant, and pass `ConfigModel.Selection.variant` from `ConfigProviderPlugin`. Expose the full configured ref to the authoritative selector so aliasing runs before generic fallback.

Update both `packages/plugin/src/effect/catalog.ts` and `packages/plugin/src/promise/catalog.ts` so `default.get()` includes optional `variant` and `default.set(providerID, modelID, variant?)` accepts it. A later transform calling the existing two-argument form intentionally clears any earlier variant; transform order therefore determines the complete default selection. Add transform-precedence tests for setting, replacing, and clearing variants.

Update the catalog transform adapter in `packages/core/src/plugin/host.ts` as part of the same change. Its `default.set` wrapper must accept the optional string, convert it with `Model.VariantID.make`, and forward it to the Core draft; `default.get` must expose the optional variant. Add Effect and Promise plugin runtime tests that set and read a variant through the host adapter and prove a later two-argument call clears it. Typechecking the interfaces alone is not sufficient because an adapter can silently ignore an optional third argument.

The configured variant remains internal execution selection. Existing model-default server and plugin surfaces return `Model.Info`, which cannot represent selected variant identity; they should return the canonical base model and keep their current contract. This plan does not add a `Model.Ref` to the public response and therefore does not require a Protocol or generated-client change.

For an explicit requested model, `fallback-blocked` and `absent` remain unavailable errors. For an omitted model, failure of the configured default may continue to the existing generic supported-model fallback; this is default selection, not alias resolution.

Configured-default resolution first runs compatibility in `available` mode. If the exact or aliased selected model has no supported runtime package, it then retains the current behavior of choosing the first supported available model. Explicit Session selection does not use this fallback: an available exact or aliased model with an unsupported package reaches the normal `UnsupportedPackageError`. Tests must cover exact and aliased configured defaults without packages as well as the corresponding explicit Session behavior.

This provider compatibility stage is required to preserve V1 model references, persisted Sessions, API callers, and native V2 references without teaching config format detection about provider IDs.

## Diagnostics

Diagnostics are internal values until the loader logs them. Each warning should include:

- the filesystem path or virtual source name;
- the precise JSON path;
- whether the value was invalid, conflicting, or unsupported;
- the action taken, such as "skipped V2 value and retained legacy value."

Diagnostics must not include raw configuration values because provider settings, headers, plugin options, and substituted configuration may contain credentials. Log source, path, category, and action only.

Do not warn for valid supported V1 syntax. Do not introduce a public API or TUI diagnostics surface in this change.

`parseInfo` currently has no source context and returns `undefined` silently. Replace it with a thin effectful loading operation, or return diagnostics to a shared effectful wrapper, so local files, `OPENCODE_CONFIG_CONTENT`, and well-known virtual configurations use the same behavior.

## Implementation Sequence

Each stage should keep pure V1 and pure V2 loading behavior covered before broadening mixed behavior.

### 1. Characterize Existing Compatibility

Add focused fixtures for every supported V1 field and record the result of the migration helper separately from the current loader result. This distinction matters because V1 `skills`, old compaction leaves, and `experimental.mcp_timeout` are supported by migration but do not currently trigger V1 detection on their own.

Record every entry in the unsupported inventory separately so warning behavior can be added without accidentally treating schema acceptance as supported behavior.

Add regression fixtures demonstrating current mixed-file failures, including:

```jsonc
{ "snapshot": false, "agents": { "reviewer": { "system": "Use V2" } } }
```

```jsonc
{
  "mcp": {
    "legacy": { "type": "local", "command": ["legacy"] },
    "servers": { "native": { "type": "local", "command": ["native"] } }
  }
}
```

```jsonc
{
  "compaction": {
    "preserve_recent_tokens": 1000,
    "keep": { "tokens": 2000 }
  }
}
```

### 2. Add Pure Candidate Decoders

Add field and entry decoding helpers that retain successful values and return path-aware diagnostics for failures. Native helpers must immediately re-encode successful decoded candidates. Establish every boundary in the recovery matrix before changing the loader.

Avoid generic recursive schema walking. The supported recovery boundaries should be visible in code and tests.

### 3. Add Canonical Normalization

Build the validated partial legacy value, pass it through reused V1 migration logic, validate and re-encode native V2 candidates, and apply the explicit encoded merge table. Add direct normalizer tests for each alias, shared shape, precedence case, recovery unit, unsupported item, and diagnostic.

Verify destination-specific canonical cleanup for empty `compaction.keep`, `mcp.servers`, and `mcp.timeout` containers. Do not add a generic empty-object stripping pass.

Add order-sensitive fixtures where known and arbitrary permission actions are deliberately interleaved in top-level `permission`, top-level `tools`, and nested agent permissions. Their emitted rule order must match source order after granular decoding.

### 4. Integrate The Loader

Replace the `isV1` branch in `packages/core/src/config.ts` with normalization followed by one `Config.Info` decode. Add source-aware warning logs for filesystem, environment-content, and well-known config sources.

Remove `ConfigMigrateV1.isV1` after all callers and tests have moved to normalization.

### 5. Isolate Provider Alias Compatibility

Move provider aliases behind the provider domain, add namespace claim retention and shared effective-policy lookup, preserve full configured default refs, and route every lookup path in the provider compatibility section through one selector.

Verify exact custom providers, claimed-but-unavailable providers, explicit policy denial of an absent source ID, configured defaults, persisted Sessions, stateless generation, historical message equivalence, canonical durable identities, and terminal post-selection failures.

Include paired fixtures proving that a singular V1 provider alias claims only its canonical migrated namespace and remains eligible for fallback, while a native plural provider declaration using the old-looking ID claims the exact namespace and blocks fallback.

Make `Generate.Service` depend on `PluginSupervisor.Service` and await `flush` before model selection. Bound the wait with the same five-second timeout used by the model-default handler and map timeout to `Generate.UnavailableError` with `service: "model.catalog"`. This covers direct Core callers as well as HTTP callers without relying on every transport handler to remember settlement. Test delayed successful settlement and failed or never-settled activation so direct Core callers cannot hang indefinitely. Add a Server generate-handler test proving a plugin-provided or plugin-transformed model is visible before selection.

Add policy fixtures for wildcard deny plus canonical allow, explicit source-only deny, denied canonical target, and a migrated V1 `enabled_providers` alias. Add list-recovery fixtures for explicit empty, mixed valid/invalid, and wholly invalid `enabled_providers`.

Add mode-specific fixtures proving disabled and unauthenticated exact providers retain current `configured` behavior for `ModelResolver`/Generate but are `fallback-blocked` in Session/default `available` mode. The same mode must govern an alias target. Policy tests should assert `fallback-blocked` explicitly rather than only observing resolution failure.

Add catalog claim-lifecycle fixtures proving `provider.update` followed by `provider.remove` still claims the namespace for that rebuild, `model.update` alone creates a claim, a public plugin claim survives later transform or policy removal, and a later rebuild clears the claim when no transform makes it again.

Add a multi-document alias-policy fixture preserving user-global-over-project precedence in addition to within-document last-match order.

### 6. Update Documentation

Update `packages/www/content/docs/migrate-v1.mdx` so it no longer says mixed field names are unsupported. Document the bounded rule: top-level forms may coexist, but nested mixing is interpreted only for `mcp`, `compaction`, and `experimental`; native V2 values win canonical conflicts.

Correct the existing statement that `compaction.prune` keeps its name. V2 has no native `prune` field. Update the fields-without-native-equivalents section to distinguish supported migration behavior from V1 fields that are accepted but currently ignored.

Reconcile the guide's opening compatibility promise with the normative inventory:

- supported V1 behavior normalized by this pipeline remains a compatibility contract;
- V1-schema-accepted fields in the unsupported inventory are intentionally ignored and now produce warnings;
- a regression in behavior listed as supported remains a compatibility bug and should be reported.

Update `packages/www/content/docs/config.mdx` and `packages/www/content/docs/(Configure)/models.mdx` to remove the current statement that a configured default model variant is ignored. Explain that execution retains the configured variant while model-default surfaces continue returning the canonical base `Model.Info` contract.

Extend the migration guide's provider section with the two consolidated provider mappings and the runtime boundary: a legacy reference falls back to its canonical provider only when the legacy namespace is absent, while a native provider explicitly configured under the old-looking ID remains exact and authoritative.

Update `packages/www/content/docs/(Configure)/compaction.mdx` to remove `prune` from native V2 examples and supported-field claims, matching the actual V2 schema.

Do not expand the migration guide with removed V1 features that remain unsupported.

## Verification Laws

The implementation is complete when tests establish these properties:

1. **V2 identity:** Encoding a valid native `Config.Info`, JSON-round-tripping it, normalizing its encoded value, and decoding it again preserves decoded meaning, including transformed schemas such as warming durations.
2. **V1 compatibility:** Every currently supported valid V1 field preserves existing execution behavior except the documented coexistence cleanup for `reference` plus `references` and synthesized empty compatibility containers. A shared top-level model keeps its requested provider ID in normalized config rather than adopting the current migration's provider rewrite; successful compatibility resolution and new durable assistant/Step identities must still be canonical.
3. **Unrelated-field independence:** Adding a V1-only field cannot change how an unrelated V2 field is interpreted.
4. **Disjoint preservation:** Disjoint valid V1 and V2 values both survive normalization.
5. **Native precedence:** Valid V2 wins every canonical collision independent of source key order.
6. **Ordered precedence:** Migrated V1 rules precede native V2 rules.
7. **Granular recovery:** One malformed collection entry does not remove valid siblings.
8. **Legacy fallback:** A malformed V2 collision does not erase a valid legacy value.
9. **Bounded nesting:** Mixed `mcp`, `compaction`, and `experimental` members normalize deterministically without recursively guessing other entry versions.
10. **Diagnostic precision:** Every skipped recognized value and every canonical conflict reports its source and JSON path without logging its value.
11. **Quiet compatibility:** Valid supported V1 and mixed syntax emits no migration warning by itself.
12. **Provider independence:** Provider aliases never influence config shape detection, and any exact namespace claim blocks alias fallback.
13. **Encoded assembly:** No decoded transformed value or `Schema.Class` instance is fed back into the encoded side of `Config.Info`.
14. **Presence:** False, zero, empty, and absent values follow their explicit source-presence rules.
15. **Canonical identity:** Successful provider compatibility returns and durably records canonical identity while retaining requested identity only as transient lookup context.

Retain the existing property test that arbitrary `ConfigV1.Info` values migrate to valid `Config.Info`. Add a corresponding property that generates decoded `Config.Info`, encodes it with `Schema.encodeSync(Config.Info)`, JSON-round-trips the encoded value, normalizes it, and compares decoded results. Add table-driven mixed fixtures for interactions that arbitrary independent schemas will not generate usefully.

Focused tests must cover warming encoding, `reference` plus `references`, `agent` plus `mode`, false/zero/empty presence, every recovery boundary, every unsupported diagnostic, local/remote/enabled-only MCP entries using both reserved names, timeout leaf precedence, canonical-equal duplicates, malformed JSON, valid non-object roots, all source labels, configured default variants and transform precedence, every model lookup path, bounded plugin settlement, both malformed provider-header cases, malformed provider body, and exact-provider claim blocking.

Invalid-root fixtures must cover filesystem config, `OPENCODE_CONFIG_CONTENT`, and well-known virtual config sources and assert one redacted root-path diagnostic for each.

Add a Core plugin-host test proving its default surface returns the canonical base model, a Server handler test proving `/api/model/default` returns the same base provider/model while leaving variant identity internal, and a Server generate-handler test proving selection waits for plugin settlement.

## Verification Commands

Run from package directories, never from the repository root:

```sh
cd packages/core
bun test test/config
bun test test/model-resolver.test.ts test/catalog.test.ts test/generate.test.ts test/location-layer.test.ts
bun test test/session-runner-message.test.ts test/session-runner.test.ts test/plugin.test.ts
bun typecheck
```

Run the model-default handler test and typecheck from `packages/server`:

```sh
bun test test/model.test.ts test/generate.test.ts
bun typecheck
```

If the migration documentation changes, also run from `packages/www`:

```sh
bun typecheck
bun validate
bun run build
```

Because the catalog draft type changes in both plugin APIs, run from `packages/plugin`:

```sh
bun test
bun typecheck
bun run build
```

This change does not alter the public Protocol or Server `HttpApi`, so client generation should not be necessary.

## Non-Goals

- Do not restore removed V1 settings or redesign their V2 replacements.
- Do not recursively support arbitrary V1/V2 mixtures inside agents, providers, commands, or models.
- Do not expose config diagnostics through Protocol, Server, CLI, or TUI APIs.
- Do not rewrite user configuration files on disk.
- Do not use source key order as semantic precedence.
- Do not retain whole-document V1/V2 detection as a fallback.

## Rejected Alternative

Partitioning and decoding the complete raw document independently as V1 and V2 remains rejected. Shared keys can contain mixed members, permissive excess-property handling can make both decodes appear successful while dropping data, and the two decoded results still require the same field-specific semantic merge rules. A correct implementation would therefore add a second decode pipeline around the field normalizer without improving behavior.
