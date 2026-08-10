# Mixed V1/V2 Config Normalization Plan

Status: **Implemented and verified**

## Goal

Replace whole-document V1/V2 detection with one config-domain compatibility pipeline. Supported V1 fields, native V2 fields, and practical mixtures of both should load without an unrelated legacy key changing how the rest of the document is decoded.

## Decision

Normalize recognized fields independently into the encoded side of the V2 `Config.Info` schema, then perform one final complete-document V2 decode:

```text
JSON/JSONC encoded input
    -> parse and retain source-property presence
    -> validate each recognized field or collection entry
    -> migrate supported V1 candidates to V2 encoded values
    -> decode and re-encode native V2 candidates
    -> merge with native V2 precedence
    -> decode Config.Info once
    -> log redacted diagnostics
```

There is no whole-document version classification and no independent whole-document V1 and V2 decode.

The encoded boundary matters because schemas such as warming durations transform strings into runtime values. Decoded values must not be fed back into the encoded side of `Config.Info`.

## Behavior

| Situation                                         | Result                                              |
| ------------------------------------------------- | --------------------------------------------------- |
| Supported V1-only field                           | Migrate it to its canonical V2 destination.         |
| Native V2 field                                   | Preserve it after schema decode and encode.         |
| Disjoint V1 and V2 map entries                    | Preserve both.                                      |
| Same canonical scalar, map entry, or nested leaf  | Valid native V2 wins regardless of JSON key order.  |
| Malformed native value with valid legacy fallback | Skip native value, log it, and retain legacy value. |
| Malformed collection entry                        | Skip only the explicitly supported recovery unit.   |
| Unsupported accepted V1 setting                   | Omit it and log a redacted warning.                 |
| Unknown field                                     | Continue ignoring it for forward compatibility.     |

Valid supported V1 syntax does not warn merely because it is legacy.

## Field Precedence

| Destination              | Lowest to highest precedence                                             |
| ------------------------ | ------------------------------------------------------------------------ |
| `snapshots`              | `snapshot` < `snapshots`                                                 |
| `share`                  | `autoshare` < `share`                                                    |
| `references[name]`       | `reference[name]` < `references[name]`                                   |
| `agents[name]`           | `agent[name]` < `mode[name]` < `agents[name]`                            |
| `commands[name]`         | `command[name]` < `commands[name]`                                       |
| `providers[name]`        | `provider[name]` < `providers[name]`                                     |
| `permissions`            | `tools` rules < `permission` rules < native `permissions`                |
| `plugins`                | migrated `plugin` items < native `plugins` items                         |
| `media`                  | `attachment` < `media`                                                   |
| `experimental.policies`  | enabled-provider policies < disabled-provider policies < native policies |
| `mcp.servers[name]`      | direct legacy server < native `servers[name]`                            |
| `mcp.timeout.*`          | `experimental.mcp_timeout` < native timeout leaf                         |
| `compaction.keep.tokens` | `preserve_recent_tokens` < `keep.tokens`                                 |
| `compaction.buffer`      | `reserved` < `buffer`                                                    |

Ordered rules and plugin directives retain both forms, with migrated V1 entries first and native V2 entries last.

## Shared Shapes

### Skills

- A V2 array retains each valid string item.
- A V1 object combines valid `paths` followed by valid `urls`.
- Empty and unknown-only V1 objects normalize to an empty array under permissive excess-property handling.

### MCP

- Direct entries under `mcp` are V1 servers.
- Entries under `mcp.servers` are native V2 servers.
- Both sets are merged by server name, with a complete native server replacing a duplicate legacy server.
- A malformed native duplicate is skipped so a valid legacy server remains.
- Native global timeout leaves override only matching values migrated from `experimental.mcp_timeout`.
- Raw `type` and `enabled` discriminators preserve legacy servers that happen to be named `servers` or `timeout`.

### Compaction

- `preserve_recent_tokens` becomes `keep.tokens`.
- `reserved` becomes `buffer`.
- Native leaves win conflicts.
- `tail_turns` and `prune` remain unsupported and produce warnings.

### Experimental

- `subagent_depth` is shared.
- Legacy provider lists generate ordered canonical policies.
- Native policies follow generated policies.
- An explicit empty `enabled_providers` keeps deny-all behavior.
- A non-empty list with no valid items contributes no policy, avoiding accidental deny-all from malformed input.

## Recovery Units

Named commands, agents, providers, MCP servers, formatters, language servers, and references recover independently. Plugin, permission, skill, instruction, provider-ID, and policy arrays recover by item. Top-level legacy permissions recover by action/resource rule. Complex interiors of one agent, provider, command, or MCP server remain atomic rather than being recursively salvaged.

Every decoder preserves `propertyOrder: "original"` because V1 permission precedence depends on user order. Excess properties remain ignored except for the explicit unsupported inventory.

## Provider IDs

Provider ID compatibility remains a config migration concern only. Existing V1 agent, command, provider, and provider-policy adapters continue using the migration helper's retired-ID mapping.

The shared top-level `model` field remains exact because its string and object forms are valid native V2 syntax and provider declarations may come from a different config layer. It is never reinterpreted based on unrelated legacy fields.

This change does not add runtime provider aliases or modify provider policy evaluation, catalog state, model resolution, Sessions, plugins, Server behavior, or generation.

## Diagnostics

Diagnostics contain only source, JSON path, category, and action. They never include raw values because config may contain credentials after substitution.

Malformed JSON, empty content, and valid non-object roots reject one document with a source-aware warning. Malformed recognized fields and entries are skipped at their recovery boundary while unrelated valid configuration continues loading.

## Implementation

- Add a pure `ConfigNormalize.normalize` module under `packages/core/src/config/`.
- Reuse field migration primitives from `packages/core/src/v1/config/migrate.ts`.
- Replace `ConfigMigrateV1.isV1` in `packages/core/src/config.ts` with normalization and one final V2 decode.
- Log diagnostics uniformly for files, `OPENCODE_CONFIG_CONTENT`, and well-known virtual config.
- Add property and table-driven config normalization tests.
- Update migration and compaction documentation.

## Verification

The implementation must establish:

1. Valid native V2 config preserves decoded meaning after encoded normalization.
2. Supported V1 fields preserve existing behavior.
3. Adding a legacy field cannot change unrelated native field interpretation.
4. Native V2 wins canonical conflicts independent of key order.
5. One malformed entry does not remove valid siblings.
6. Mixed MCP, compaction, and experimental values normalize deterministically.
7. Diagnostics are precise and value-redacted.
8. False, zero, empty, and absent values retain distinct presence semantics.

Run from `packages/core`:

```sh
bun test test/config
bun typecheck
```

Run from `packages/www` after documentation changes:

```sh
bun typecheck
bun validate
bun run build
```

## Non-Goals

- Runtime provider alias resolution.
- Provider policy or catalog changes.
- Model resolver or Session changes.
- Plugin API changes.
- Server or Protocol changes.
- Generation lifecycle changes.
- Recursive V1/V2 inference inside one agent, provider, command, or model.
- Restoring removed V1 functionality.
- Rewriting user files on disk.
