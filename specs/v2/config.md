# V2 Config Review

This document breaks the legacy configuration schema into small review groups. Work through one group at a time and decide whether each field should be ported as-is, removed, or redesigned for v2.

## Status Labels

- `pending`: not discussed yet
- `keep`: port with substantially the existing meaning
- `remove`: do not carry forward
- `redesign`: keep the capability with a different shape, scope, or owning module

## Schema Scope

Use one v2 config schema for now. Some fields, such as `autoupdate`, are intended for global/user configuration, but there is not yet enough benefit to enforce that with separate global and location schemas. Revisit this if more scope-sensitive fields survive the review.

V2 core discovers config documents named `opencode.json` or `opencode.jsonc` in the global config directory, ancestor project directories, and `.opencode` config directories. The legacy `config.json` filename is not supported in V2.

## Group 1: File Metadata

Small fields describing the config file itself rather than application behavior.

| Field     | Current Purpose                                            | Status | Notes                                                                                 |
| --------- | ---------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------- |
| `$schema` | JSON schema reference for editor validation and completion | keep   | Keep as read-only metadata; loading config must not insert it or create files for it. |

## Group 2: Process And Server Settings

Settings that affect process startup, shell execution, or network serving. Review global-only versus location-specific scope carefully.

| Field        | Current Purpose                                     | Status | Notes                                                                          |
| ------------ | --------------------------------------------------- | ------ | ------------------------------------------------------------------------------ |
| `shell`      | Default shell for terminal and shell tool execution | keep   | Port as effective config; shared shell choice is used throughout opencode.     |
| `logLevel`   | Intended logging level configuration                | remove | Do not port: no config consumer exists and logging initializes from CLI input. |
| `server`     | Hostname, port, mDNS, and CORS settings             | remove | Do not port: location config is loaded after the server is already running.    |
| `autoupdate` | Automatic update or notification behavior           | keep   | Global-only user preference; keep `true`, `false`, and `"notify"`.             |

## Group 3: Commands And Project Resources

Configuration that introduces location-scoped project resources or discoverable content.

| Field          | Current Purpose                         | Status   | Notes                                                                                                     |
| -------------- | --------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| `command`      | User-defined commands                   | remove   | Do not port as v2 config; named reusable user workflows belong to skills.                                 |
| `skills`       | Additional skill locations              | redesign | Replace `{ paths?, urls? }` with a single array of local path or remote URL discovery sources.            |
| `reference`    | Named git or local directory references | redesign | Rename to plural `references`; retain named local path and Git repository external-context entries.       |
| `instructions` | Additional ambient instruction sources  | keep     | Keep as one array of local paths, glob patterns, or remote URLs supplying automatically included context. |

V2 does not expose separate user-authored command configuration. Skills should cover named reusable prompt workflows, whether invoked directly by the user or loaded by an agent. Internal command routing and built-in commands may remain runtime concerns without creating a `command` or `commands` config field.

This intentionally does not port legacy command-only behavior such as per-command `model`, `agent`, `subtask`, prompt shell expansion, or positional/template substitution. If a related capability is needed in v2, it should be designed in the owning domain rather than preserved through a second workflow definition system.

Keep `skills` as discovery-source configuration rather than inline workflow definitions. Skill content remains owned by `SKILL.md`; each `skills` entry is either a local search root or a remote discovery URL. Direct invocation behavior can be designed separately without expanding the config shape.

```jsonc
{
  "skills": ["./team-skills", "~/shared-skills", "https://example.com/.well-known/skills/"],
}
```

Keep ambient instructions separate from skills. Instructions are automatically included as model context, while skills are loaded or invoked intentionally. Each source is unambiguously either a local path/glob or a URL, so v2 keeps the simple array shape:

```jsonc
{
  "instructions": [
    "CONTRIBUTING.md",
    "docs/guidelines.md",
    ".cursor/rules/*.md",
    "https://example.com/shared-rules.md",
  ],
}
```

Keep named external context references as a v2 configuration capability, renamed to plural `references` because it is a collection keyed by alias. References declare local directories or Git repositories that can later be addressed as `@alias` or `@alias/path` when the v2 runtime implements this behavior.

```jsonc
{
  "references": {
    "design-system": { "path": "../ui-library" },
    "sdk": { "repository": "github.com/example/sdk", "branch": "main" },
  },
}
```

Retain the compact string entry form as well: values starting with `.`, `/`, or `~` represent local paths, and other strings represent Git repositories.

## Group 4: Plugins

Plugin loading has source-path and scope-sensitive behavior, so it should be reviewed separately from other project resources.

| Field    | Current Purpose               | Status   | Notes                                                                                                       |
| -------- | ----------------------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| `plugin` | User-specified plugin modules | redesign | Rename to plural `plugins`; retain ordered loading with package strings or `{ package, options? }` entries. |

Plugin order remains part of the v2 configuration contract because hook registration and execution can depend on load order. Replace legacy option tuples with readable object entries:

```jsonc
{
  "plugins": [
    "opencode-helicone-session",
    {
      "package": "@my-org/audit-plugin",
      "options": {
        "endpoint": "https://audit.example.com",
      },
    },
  ],
}
```

The configured `plugins` list represents package-loaded plugins only. Local plugin code remains discovered from plugin directories such as `.opencode/plugins/`; v2 does not port arbitrary configured local paths or file URLs into this field.

## Group 5: Filesystem And Tool Runtime

Settings controlling local file observation, snapshots, language tooling, and tool output behavior.

| Field         | Current Purpose                         | Status   | Notes                                                                                                                                             |
| ------------- | --------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `watcher`     | Ignore patterns for filesystem watching | keep     | Keep `{ ignore?: string[] }`; this configures the filesystem watcher subsystem.                                                                   |
| `snapshot`    | Enable filesystem snapshot tracking     | redesign | Rename to plural `snapshots`; controls creation of snapshots used for undo and revert behavior.                                                   |
| `formatter`   | Configure formatters                    | keep     | Keep singular `boolean \| Record<string, entry>` shape; it configures built-in enablement and named formatter overrides.                          |
| `lsp`         | Configure language servers              | keep     | Keep singular `boolean \| Record<string, entry>` shape; custom servers need commands and file extensions.                                         |
| `attachment`  | Configure attachment/image processing   | redesign | Rename to plural `attachments`; retain `{ image?: { auto_resize?, max_width?, max_height?, max_base64_bytes? } }` for input normalization limits. |
| `tool_output` | Configure tool output truncation limits | keep     | Keep `{ max_lines?, max_bytes? }`; both positive thresholds apply to saved-preview truncation behavior.                                           |

`formatter` and `lsp` configure one project tooling subsystem each, so their singular names remain appropriate. `true` enables the built-in registrations, `false` disables them, and a keyed object enables built-ins while applying named overrides or custom registrations. Custom language servers must declare `extensions` so runtime file attachment is deterministic; validation of known built-in server IDs belongs with the eventual v2 LSP integration rather than the aggregate core config schema.

Rename legacy `attachment` to `attachments` in v2. This setting controls processing for the attachment domain and may expand beyond image handling, while singular `attachment` is already used as a model capability flag indicating whether one model accepts attachments.

```jsonc
{
  "formatter": {
    "prettier": { "disabled": true },
    "project": { "command": ["./scripts/format", "$FILE"], "extensions": [".foo"] },
  },
  "lsp": {
    "typescript": { "disabled": true },
    "project": { "command": ["project-language-server", "--stdio"], "extensions": [".foo"] },
  },
  "attachments": {
    "image": { "auto_resize": true, "max_width": 2000, "max_height": 2000 },
  },
  "tool_output": { "max_lines": 2000, "max_bytes": 51200 },
}
```

## Group 6: Sharing And Identity

Settings affecting sharing behavior or user/account identity rather than model execution.

| Field        | Current Purpose                                 | Status | Notes                                                                                                                  |
| ------------ | ----------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| `share`      | Session sharing behavior                        | keep   | Keep `"manual" \| "auto" \| "disabled"`; it controls manual sharing permission and automatic sharing of new sessions.  |
| `autoshare`  | Legacy automatic sharing flag                   | remove | Do not port deprecated alias; use `share: "auto"`.                                                                     |
| `enterprise` | Enterprise URL configuration                    | keep   | Keep `{ url?: string }`; currently selects the legacy sharing service endpoint when no organization account is active. |
| `username`   | Display username in conversations and telemetry | keep   | Keep string identity override; runtime may otherwise resolve an operating-system username.                             |

Retain `share` as the single session-sharing setting. `"manual"` permits explicit sharing, `"auto"` shares newly created top-level sessions, and `"disabled"` prevents sharing. Legacy `autoshare: true` is only an alias for `share: "auto"`, so v2 does not expose it.

Retain `enterprise.url` for legacy enterprise share hosting selection and `username` as a user-facing identity override. These remain separate from server authentication credentials; `username` identifies the user in conversation and telemetry behavior rather than HTTP basic-auth configuration.

```jsonc
{
  "share": "disabled",
  "enterprise": { "url": "https://share.example.com" },
  "username": "developer",
}
```

## Group 7: Providers And Model Selection

Provider catalog customization and model-choice configuration. The new core work has started here.

| Field                | Current Purpose                                   | Status   | Notes                                                                                                                        |
| -------------------- | ------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `provider`           | Custom provider configuration and model overrides | redesign | Rename to plural `providers` in v2; do not preserve the legacy singular key. Review nested provider/model fields separately. |
| `disabled_providers` | Disable automatically loaded providers            | redesign | Replace with `experimental.policies: [{ effect: "deny", action: "provider.use", resource: "..." }]`.                         |
| `enabled_providers`  | Restrict enabled providers to an allowlist        | redesign | Replace with ordered `provider.use` allow/deny statements and wildcard resources.                                            |
| `model`              | Default model selection                           | keep     | Keep as the fallback model when an active session or agent does not specify a model.                                         |
| `small_model`        | Small/utility model selection                     | remove   | Do not port; its only runtime consumer is title generation, which can use an explicit `title` agent model override.          |

Provider selection rules belong in `experimental.policies` rather than provider entries or repeated top-level provider fields. Initial proposed shape:

```jsonc
{
  "experimental": {
    "policies": [
      {
        "effect": "deny",
        "action": "provider.use",
        "resource": "*",
      },
      {
        "effect": "allow",
        "action": "provider.use",
        "resource": "anthropic",
      },
    ],
  },
}
```

See [provider-policy.md](./provider-policy.md) for the provider policy semantics and precedence rules.

Policy evaluation will consume authored config documents in reverse order while preserving statement order inside each document. The precedence of `.opencode` policy sources remains open until `.opencode` configuration is reviewed.

Provider configuration uses the plural `providers` key in v2. This intentionally differs from the legacy singular `provider` key; v2 does not add a compatibility alias while its configuration surface is still being defined.

Keep `model` as the default model fallback. It is application-wide behavior used when an active session or agent has no explicit model selection, so it does not belong inside any individual provider configuration.

Do not port `small_model`. In the current runtime it is only consulted while generating a session title: the `title` agent model wins first, then `small_model`, then automatic/current-model fallback. In v2, users who need a specific title model should configure the `title` agent directly rather than use a separate top-level model setting.

Provider, model, variant, and provisional agent `options` are authored as partial patches rather than fully materialized runtime option records. Users should be able to set only the override they need, such as a header or an AI SDK request option; catalog state supplies empty defaults and merges patches in configuration order.

Keep provider `env` as an authored list of recognized credential environment variable names. Built-in catalog providers already carry this metadata for automatic environment-backed availability, and configured providers may need to declare the same source. For a configured provider this is additive metadata, not a requirement that one of the variables exists: the provider may instead be usable through configured options, a stored account, or an endpoint that needs no credential.

Within configured models, nest the legacy upstream model identifier `id` under `api.id` with the rest of the model API override. Model `limit` is an authored patch, so an override may change only `context`, `input`, or `output`. Model `cost` accepts one simple pricing object or an array of tiered pricing entries; omitted cache prices default to zero.

Do not port legacy provider model `reasoning`, `temperature`, or `interleaved` flags as first-class config fields; provider/request behavior belongs in structured `options` or model variants. Do not port `release_date`, `status`, `experimental`, `whitelist`, or `blacklist` in this v2 surface.

```jsonc
{
  "providers": {
    "internal": {
      "env": ["INTERNAL_LLM_API_KEY"],
      "options": { "headers": { "Authorization": "Bearer {env:API_KEY}" } },
      "models": {
        "chat": {
          "api": { "id": "upstream-chat-model" },
          "limit": { "output": 32768 },
          "cost": { "input": 1.25, "output": 10 },
          "variants": [{ "id": "high", "aisdk": { "request": { "reasoningEffort": "high" } } }],
        },
      },
    },
  },
}
```

## Group 8: Agents And Permissions

Agent behavior and tool-access policy. Review together because agent configuration can contain permissions and model choices.

| Field           | Current Purpose                                     | Status   | Notes                                                                                                                       |
| --------------- | --------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| `default_agent` | Choose default primary agent                        | remove   | Do not retain a separate top-level selector; default choice should be designed with the v2 agent configuration model.       |
| `mode`          | Legacy agent configuration alias                    | remove   | Do not port deprecated alias; configure agents through the v2 agent surface only.                                           |
| `agent`         | Configure primary, subagent, and specialized agents | redesign | Rename to plural `agents`; retain a named map of built-in overrides and custom agent definitions.                           |
| `permission`    | Tool permission rules                               | redesign | Rename to plural `permissions`; replace legacy map shorthand with an ordered array of `{ action, resource, effect }` rules. |
| `tools`         | Legacy tool enable/disable map                      | remove   | Do not port boolean enable/disable alias; express tool access through permissions.                                          |

Do not port `default_agent` ahead of the v2 agent design. The legacy runtime uses it to choose a visible, non-subagent fallback instead of `build`, but exposing that selection as an isolated top-level field would pre-commit v2 to the legacy agent model before agents and their policy surface are defined together.

Do not port `mode`. The legacy loader already merges this deprecated alias into `agent`, and v2 should expose only one authoring surface for agent definitions.

Rename legacy `agent` to `agents` because the setting is a collection keyed by agent name. It should continue to support overriding built-in agents such as `build`, `plan`, and `title`, as well as declaring named custom agents. The nested entry schema remains open until agent-local `permission` and deprecated `tools` behavior are decided.

Keep nested `agents.<name>.mode` with values `"primary"`, `"subagent"`, or `"all"`. This identifies an agent's runtime role and is separate from the removed top-level legacy `mode` alias, which was an alternate container for agent definitions.

For named configurable entries across v2, use `disabled?: boolean` consistently when an entry should remain configured but inactive. Agent definitions should therefore redesign legacy `disable` as `disabled`; this matches formatters, language servers, future MCP server definitions, and configured model overrides. Runtime catalog state may still track active availability as `enabled`; that is not user-authored config.

Keep separate `model` and `variant` fields on agent definitions. A model reference uses `provider/model-id`, but model IDs may themselves contain slash-delimited segments, such as `openrouter/openai/gpt-5`; appending a variant to that string would be ambiguous.

Keep `color` on agent definitions. Agents are user-visible selectable entities, so a user-authored display color is appropriate metadata for the agent rather than an unrelated application presentation setting. Retain hex colors and named theme colors supported by the existing configuration.

Keep agent-local `options` provisionally using the same structured provider options shape available on configured providers and models: headers, body, and AI SDK provider/request overrides. Its long-term ownership remains open for team review because reusable provider-specific presets can instead be modeled as variants. Do not retain dedicated agent `temperature` or `top_p` fields.

Retain `description`, `hidden`, and `steps`; they define an agent's discoverability, visibility, and iteration budget rather than model request parameters. Rename legacy agent `prompt` to `system`, making clear that it supplies persistent system-level agent content without colliding with top-level ambient `instructions`. Remove deprecated `maxSteps` in favor of `steps`.

```jsonc
{
  "agents": {
    "reviewer": {
      "model": "openrouter/openai/gpt-5",
      "variant": "high",
      "options": {
        "headers": { "x-agent": "reviewer" },
        "body": {},
        "aisdk": { "provider": {}, "request": { "reasoningEffort": "high" } },
      },
      "description": "Review changes for correctness",
      "system": "Find regressions and missing tests.",
      "mode": "subagent",
      "color": "warning",
      "steps": 12,
      "disabled": false,
      "permissions": [{ "action": "edit", "resource": "*", "effect": "deny" }],
    },
  },
}
```

Do not port `tools`, either as a top-level setting or as an agent-entry alias. The legacy loader already converts tool booleans into permission rules, including collapsing write-adjacent tool names into `edit`; v2 should avoid carrying that lossy compatibility input forward.

Rename legacy `permission` to `permissions` and expose the normalized ordered ruleset already modeled by `PermissionV2.Ruleset`. Rules retain the interactive `"ask"` effect in addition to `"allow"` and `"deny"`; this is distinct from `experimental.policies`, whose provider enforcement currently needs only allow/deny decisions. The same `permissions` ruleset shape should be used inside future `agents` entries.

```jsonc
{
  "permissions": [
    { "action": "bash", "resource": "*", "effect": "ask" },
    { "action": "bash", "resource": "git status", "effect": "allow" },
  ],
}
```

## Group 9: Integrations

External protocol and server integration configuration.

| Field | Current Purpose                       | Status   | Notes                                                                                                                                                      |
| ----- | ------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mcp` | MCP server definitions and enablement | redesign | Keep opencode's explicit local/remote server entry format, nested under `mcp.servers`; use `disabled` for inactive entries and move timeout defaults here. |

Keep the opencode MCP server entry format instead of adopting the common `mcpServers` copy/paste shape. Local servers remain explicit `type: "local"` entries with command arrays and `environment`; remote servers remain explicit `type: "remote"` entries with `url`, `headers`, and optional `oauth`. Nest the server map under `mcp.servers` so protocol-wide settings such as timeout defaults can live under the same subsystem.

MCP timeouts have separate startup and request budgets, expressed in milliseconds. `startup` covers establishing the transport and completing MCP initialization. `request` applies independently to each post-initialization MCP request. A server may override either default without repeating the other.

```jsonc
{
  "mcp": {
    "timeout": { "startup": 30000, "request": 300000 },
    "servers": {
      "github": {
        "type": "local",
        "command": ["npx", "-y", "@github/github-mcp-server"],
        "environment": { "GITHUB_TOKEN": "{env:GITHUB_TOKEN}" },
        "disabled": false,
        "timeout": { "startup": 60000 },
      },
      "docs": {
        "type": "remote",
        "url": "https://docs.example.com/mcp",
        "headers": { "Authorization": "Bearer {env:DOCS_TOKEN}" },
        "oauth": {
          "client_id": "{env:MCP_CLIENT_ID}",
          "client_secret": "{env:MCP_CLIENT_SECRET}",
          "scope": "read write",
          "callback_port": 19876,
          "redirect_uri": "http://127.0.0.1:19876/mcp/oauth/callback",
        },
        "disabled": false,
        "timeout": { "request": 600000 },
      },
    },
  },
}
```

## Group 10: Conversation Lifecycle

Behavior affecting long-running conversations and context management.

| Field        | Current Purpose                                             | Status   | Notes                                                                                 |
| ------------ | ----------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------- |
| `compaction` | Automatic compaction, pruning, and context reserve settings | redesign | Group retained verbatim history under `keep` and rename context headroom to `buffer`. |

Retain the compaction capability but redesign the less clear limits. `keep.tokens` is the token budget for recent history serialized into the textual compaction checkpoint. `buffer` is the token headroom reserved so automatic compaction triggers before the input window is exhausted.

```jsonc
{
  "compaction": {
    "auto": true,
    "prune": true,
    "keep": {
      "tokens": 2000,
    },
    "buffer": 10000,
  },
}
```

## Group 11: Deprecated And Experimental Settings

Fields that should not be ported by inertia; each needs an explicit justification.

| Field                                | Current Purpose                         | Status   | Notes                                                                                                                       |
| ------------------------------------ | --------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| `layout`                             | Legacy layout selection                 | remove   | Do not port deprecated option; stretch layout is always used.                                                               |
| `experimental.disable_paste_summary` | Disable pasted-content summary behavior | remove   | Do not port; pasted-input presentation behavior belongs to the client/UI surface.                                           |
| `experimental.batch_tool`            | Enable batch tool                       | remove   | Do not port; batch tool is no longer a supported feature.                                                                   |
| `experimental.openTelemetry`         | Enable AI SDK telemetry spans           | remove   | Do not port; observability is process-level and should use standard OpenTelemetry environment or declarative configuration. |
| `experimental.primary_tools`         | Restrict tools to primary agents        | remove   | Do not port obsolete gating; agent tool access is configured through permissions.                                           |
| `experimental.continue_loop_on_deny` | Continue loop after denied tool call    | remove   | Do not port legacy denied-tool loop behavior.                                                                               |
| `experimental.mcp_timeout`           | MCP request timeout                     | redesign | Move to `mcp.timeout.request` for the default and `mcp.servers.<name>.timeout.request` for per-server overrides.            |

## Review Order

Work through the groups in this order unless a dependency between decisions becomes clear:

1. File Metadata
2. Process And Server Settings
3. Providers And Model Selection
4. Commands And Project Resources
5. Plugins
6. Filesystem And Tool Runtime
7. Sharing And Identity
8. Agents And Permissions
9. Integrations
10. Conversation Lifecycle
11. Deprecated And Experimental Settings
