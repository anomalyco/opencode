# Provider Policy

Status: **Implemented.**

## Purpose

Policies control whether an operation on a named resource is allowed. Statements are authored in configuration files or delivered by the connected OpenCode Console, and applied by a terminal plugin.

The supported actions are:

```text
action:   provider.use
resource: provider ID, such as openai or company-ai

action:   tool.use
resource: <permission action>:<resource>, such as shell:sudo * or edit:*.env

action:   integration.use
resource: mcp:<server ID>, plugin:<unversioned package or absolute local path>,
          hosted:<integration ID>, or skill:<skill ID>
```

Provider configuration and provider policy remain separate:

- `providers` describes endpoints, options, and model overrides.
- `experimental.policies` determines whether an operation using a provider is allowed.

A provider can be correctly configured and have valid credentials while policy still denies its use.

## Goals

- Replace legacy `enabled_providers` and `disabled_providers`.
- Keep the default experience unchanged when users specify no policy.
- Support wildcard matching for actions and resources.
- Provide one small policy vocabulary that can later cover operations such as `plugin.load` or `mcp.connect`.
- Let user policy override repository policy, and later allow organization-managed policy to override both.
- Keep evaluation simple: matching statements are applied in order and the last match wins.

## Non-Goals

- Policies do not configure endpoints, credentials, models, or provider options.
- Policies do not make unusable resources usable.
- Policies do not currently provide conditions, principals, approval prompts, or enforced configuration values.
- A `tool.use` statement never grants access; permissions and saved approvals still decide `allow` versus `ask`.

## Statement Shape

```jsonc
{
  "experimental": {
    "policies": [
      {
        "effect": "deny",
        "action": "provider.use",
        "resource": "openai",
      },
    ],
  },
}
```

```ts
interface PolicyInfo {
  effect: "allow" | "deny"
  action: "provider.use" | "tool.use" | "integration.use"
  resource: string
}
```

`ConfigPolicy` owns the statement schema; `action` is a closed set and a statement with any other value is dropped during normalization with a diagnostic. The policy plugin interprets `provider.use` after all other catalog transforms have run and `tool.use` after every other permission evaluation hook.

## Matching

Both `action` and `resource` use opencode's existing wildcard matching behavior.

Examples:

| Action         | Resource           | Matches                                                         |
| -------------- | ------------------ | --------------------------------------------------------------- |
| `provider.use` | `openai`           | Only use of provider ID `openai`                                |
| `provider.use` | `company-*`        | Use of provider IDs such as `company-us` and `company-eu`       |
| `tool.use`     | `shell:git push *` | The `shell` permission for `git push` with or without arguments |
| `tool.use`     | `*`                | Every permission check on every resource                        |

No pattern-specific precedence exists. A specific resource does not automatically beat a wildcard resource. Written/evaluation order controls the result.

## Evaluation

To evaluate an operation and resource:

1. Start with `allow`.
2. Consider every statement whose `action` and `resource` match the requested action and resource.
3. Each matching statement replaces the current decision with its `effect`.
4. The last matching statement determines the result.

Conceptually:

```ts
function evaluate(action: string, resource: string, fallback: Policy.Effect, statements: Policy.Info[]) {
  return (
    statements.findLast(
      (statement) => Wildcard.match(action, statement.action) && Wildcard.match(resource, statement.resource),
    )?.effect ?? fallback
  )
}
```

Each caller supplies the default effect appropriate for its operation. Catalog provider use supplies `"allow"`, so no provider policy statements means normal behavior continues: otherwise usable providers are allowed.

## Ordering Within One Config Document

Statements remain in the order written by the user.

To deny all providers except Anthropic:

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

Result:

```text
provider.use / anthropic -> allow
provider.use / openai    -> deny
```

To allow internal providers except experimental ones:

```jsonc
{
  "experimental": {
    "policies": [
      { "effect": "deny", "action": "provider.use", "resource": "*" },
      { "effect": "allow", "action": "provider.use", "resource": "company-*" },
      { "effect": "deny", "action": "provider.use", "resource": "company-experimental-*" },
    ],
  },
}
```

Result:

```text
company-stable: allowed
company-experimental-fast: denied
openai: denied
```

## Ordering Across Authored Config Documents

Ordinary settings and policies have different precedence needs:

- Ordinary settings are read forward, so location-specific settings override user-global settings.
- Policies are read by reversing authored config documents, so user-global policy can override repository policy.
- Statements inside each document keep their written order.

At minimum, this means a repository cannot silently re-enable something the user denied globally.

Project config:

```jsonc
{
  "experimental": {
    "policies": [{ "effect": "allow", "action": "provider.use", "resource": "openai" }],
  },
}
```

User-global config:

```jsonc
{
  "experimental": {
    "policies": [{ "effect": "deny", "action": "provider.use", "resource": "openai" }],
  },
}
```

Result:

```text
provider.use / openai -> deny
```

The relative policy precedence of direct project files and `.opencode` files is intentionally deferred until `.opencode` configuration is reviewed.

## Organization-Managed Policy

Organization-managed policy is not ordinary authored config. Managed statements are appended after the reversed authored statements so they have final authority: an organization `deny` cannot be lifted by a repository or user `allow`, and an organization `allow` lifts a lower-authority `deny`.

```text
repository policy -> user-global policy -> organization-managed policy
```

### Delivery

The OpenCode Console compiles a workspace's Providers and Tools policies into statements for the authenticated caller and returns them from `GET /api/v2/config` alongside managed providers:

```jsonc
{
  "providers": { "opencode": {} },
  "experimental": {
    "policies": [
      { "action": "provider.use", "resource": "*", "effect": "deny" },
      { "action": "provider.use", "resource": "opencode", "effect": "allow" },
      { "action": "tool.use", "resource": "shell:sudo *", "effect": "deny" },
    ],
  },
}
```

- `experimental` is omitted when the caller has no statements; omission and an empty array are equivalent.
- The list is per caller and its order is significant. The client stores it exactly as received; it never reorders, dedupes, or normalizes statements.
- Every request the Console plugin makes, this fetch and the token refresh included, carries the `User-Agent` `opencode/<channel>/<version>/<app>`. The Console reads it to tell which OpenCode a member runs and whether it evaluates the statements it is being sent; older builds that drop them are otherwise indistinguishable from ones that enforce.
- `ManagedPolicy` (`packages/core/src/managed-policy.ts`) is the process-global home for the current statements and the organization name. The Console plugin (`opencode.provider.opencode`) writes it whenever its config snapshot is applied; the policy plugin reads it synchronously when evaluating.
- Statements ride on the Console plugin's snapshot, so they follow the connection: a credential switch replaces them, and a disconnect or a 404 from the Console clears them. Statements from different connections never merge.
- Freshness is the snapshot's freshness: the next poll (about one minute) or the next credential switch.

### Failure

A config fetch or credential refresh that fails for the connection already in place keeps that connection's last config, providers and statements alike, and logs a warning. Dropping the config would fail closed for managed providers but open for policy, because a member's personal credentials keep working while the organization's restrictions vanish. A disconnect, a credential switch, or a 404 still replaces the snapshot. There is no durable offline cache.

### Messages

When the deciding `tool.use` statement is organization-managed, the denial reads `Blocked by <organization>'s policy`, or `Blocked by your organization's policy` when the connection has no organization name. Authored statements produce `Blocked by configuration policy`.

### Protection

Plugins must not be allowed to add, remove, or override policy statements. Plugins can contribute functionality or configured providers; policy determines whether opencode permits an operation through its managed execution paths.

Plugin `remove` operations in config ignore `opencode.config.policy` and `opencode.provider.opencode`, whatever the selector (`-*`, `-opencode.*`, or the exact ID). Otherwise a repository could switch off enforcement or the fetch that delivers organization statements.

Provider policy is not a full sandbox for executable plugins. A denied provider must not be usable through the normal provider/model path, but arbitrary plugin code requires separate governance if that becomes a compliance requirement.

## Tool Policy

`tool.use` is the only tool-policy action. An allow statement never overrides an agent/session denial or grants a saved approval.

Console-managed config ignores unknown fields and skips statements whose action is unsupported, preserving the order of every supported statement. A future action cannot invalidate the providers or supported policies in the response. Supported actions still require a valid resource and effect; malformed supported statements remain configuration errors. Skipped actions are not enforced by that client. Authored config drops unsupported statements with a diagnostic.

`tool.use` statements run in the `permission.evaluate` hook after agent and session rules, saved approvals, and every other plugin's hook. For each resource the tool checks, the string `<action>:<resource>` is matched against the statement resource; if the last matching statement for any resource is `deny`, the evaluation becomes `deny` with the message above.

```text
tool.use / shell:sudo ls        -> deny   (statement shell:sudo *)
tool.use / shell:git status     -> unchanged: the agent's rules decide allow or ask
```

- A configured `deny` from agent or session rules already denies before the hook runs.
- A statement `deny` overrides `allow` and `ask`, including saved "Allow always" approvals.
- A statement `allow` never grants; it only cancels an earlier, broader statement `deny`.

## Skill Integration Policy

Skills use their OpenCode IDs, including a namespace when present. Denied skills are absent from the client catalog and model guidance, and cannot be loaded by the skill tool, a prompt mention, or standalone activation.

```jsonc
{
  "experimental": {
    "policies": [
      { "action": "integration.use", "resource": "skill:*", "effect": "deny" },
      { "action": "integration.use", "resource": "skill:team:review", "effect": "allow" },
    ],
  },
}
```

Reads evaluate the current authored and organization statements, and policy changes publish a skill-catalog update. Removing a restriction restores the registered skill without reinstallation. A global integrations allow list also excludes skills unless it explicitly allows their IDs. Skill policy does not remove content already stored in session history or sandbox plugin filesystem access.

Plugin hooks are governed by the existing plugin integration resource: blocking an external plugin prevents its import or unloads its active generation, including its hooks. There is no separate hook resource; required built-in policy and Console authentication plugins remain protected.

## Interaction With Provider Configuration

```jsonc
{
  "providers": {
    "company-ai": {
      "package": "@opencode/ai/providers/openai-compatible",
      "settings": { "baseURL": "https://ai.company.example/v1" },
    },
  },
  "experimental": {
    "policies": [
      { "effect": "deny", "action": "provider.use", "resource": "*" },
      { "effect": "allow", "action": "provider.use", "resource": "company-ai" },
    ],
  },
}
```

The provider entry configures `company-ai`; the policy statements make it the only provider permitted for use.

Provider policy applies regardless of how a provider becomes known or usable, including:

- models.dev catalog data
- environment credentials
- saved accounts
- built-in provider plugins
- explicit provider configuration

## Applying Provider Policy

Provider records and model overrides are assembled before checking provider policy. Otherwise later provider loading could recreate a provider that was already filtered.

Flow:

1. Build provider/model catalog entries, including providers managed by the connected Console.
2. Apply configured provider and model overrides.
3. Run the terminal config policy transform over the reversed authored statements followed by the organization-managed statements.
4. Remove providers denied by the final matching `provider.use` statement.

Config reload refreshes the plugin's policy snapshot and rebuilds the catalog. A changed Console snapshot notifies the policy plugin to rebuild its catalogs and re-run the terminal transforms.

## Legacy Migration

Legacy deny list:

```jsonc
{
  "disabled_providers": ["openai", "google"],
}
```

Equivalent v2 policy:

```jsonc
{
  "experimental": {
    "policies": [
      { "effect": "deny", "action": "provider.use", "resource": "openai" },
      { "effect": "deny", "action": "provider.use", "resource": "google" },
    ],
  },
}
```

Legacy allowlist:

```jsonc
{
  "enabled_providers": ["anthropic", "openai"],
}
```

Equivalent v2 policy:

```jsonc
{
  "experimental": {
    "policies": [
      { "effect": "deny", "action": "provider.use", "resource": "*" },
      { "effect": "allow", "action": "provider.use", "resource": "anthropic" },
      { "effect": "allow", "action": "provider.use", "resource": "openai" },
    ],
  },
}
```

## MCP Integration Policy

The protected terminal config policy plugin applies `integration.use` statements to `mcp:<server-name>` using `ctx.mcp.transform`. It removes denied servers after configured and plugin-provided catalog entries are assembled. The MCP domain owns connections and resource cleanup; it does not interpret policy statements.

Plugin activation batches catalog registrations, so denied servers never open an initial connection. Config and managed policy updates reload the catalog. Removing an existing server closes its connection and removes its tools, instructions, prompts, resources, and resource templates. Explicit connect and direct tool, prompt, and resource calls reject removed servers through the ordinary not-found path. Allowing the server again restores its catalog entry and reconnects it.

Policies are evaluated after authored statements and then organization statements, with the final matching statement deciding access. API-added server overrides are inputs to the same catalog, so they also pass through the policy transform. Catalog removal does not sandbox arbitrary executable plugins; plugin import governance remains a separate `plugin:*` integration policy check.
