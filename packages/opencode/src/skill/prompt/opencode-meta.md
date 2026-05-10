<!--
  Built-in opencode meta-skill. The skill's name and description are registered
  in code at packages/opencode/src/skill/index.ts (see META_SKILL_NAME and
  META_SKILL_DESCRIPTION). The body below becomes the skill's content.
-->

# Editing opencode itself

opencode validates its own config strictly. There is no graceful degradation: a
wrong field name or shape and opencode refuses to start. Use the shapes
documented here as written. If you are not sure about a field, fetch
`https://opencode.ai/config.json` instead of guessing.

The JSON Schema URL is `https://opencode.ai/config.json`. Every `opencode.json`
should declare `"$schema": "https://opencode.ai/config.json"` so the user's
editor catches mistakes as they type.

## Where things live

- **Project config**: `./opencode.json` or `./opencode.jsonc` at the project
  root, or inside `.opencode/opencode.json`. opencode walks up from the current
  directory to the worktree root looking for these.
- **Global config**: `~/.config/opencode/opencode.json` (NOT `~/.opencode/`).
- **Project agents**: `.opencode/agent/<name>.md` or `.opencode/agents/<name>.md`.
- **Global agents**: `~/.config/opencode/agent(s)/<name>.md`.
- **Project skills**: `.opencode/skill/<name>/SKILL.md` or `.opencode/skills/<name>/SKILL.md`.
- **Global skills**: `~/.config/opencode/skill(s)/<name>/SKILL.md`.
- **External skills** (auto-loaded): `~/.claude/skills/<name>/SKILL.md` and `~/.agents/skills/<name>/SKILL.md`.

Configs from each scope are deep-merged. Project overrides global. Unknown
top-level keys in `opencode.json` are rejected with `ConfigInvalidError`.

## opencode.json: top-level shape

Every field is optional. The shapes below are the only accepted shapes:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "username": "string",
  "model": "provider/model-id",
  "small_model": "provider/model-id",
  "default_agent": "agent-name",
  "shell": "/bin/zsh",
  "logLevel": "DEBUG" | "INFO" | "WARN" | "ERROR",
  "share": "manual" | "auto" | "disabled",
  "autoupdate": true | false | "notify",
  "snapshot": true,
  "instructions": ["AGENTS.md", "docs/style.md"],

  "skills": {
    "paths": [".opencode/skills", "/abs/path/to/skills"],
    "urls": ["https://example.com/.well-known/skills/"]
  },

  "agent": {
    "my-agent": { "model": "anthropic/claude-sonnet-4-6", "mode": "subagent", "description": "...", "permission": { "edit": "deny" } }
  },

  "mode": { /* deprecated alias for `agent`; prefer `agent` */ },

  "command": {
    "deploy": { "description": "...", "prompt": "..." }
  },

  "provider": {
    "anthropic": { "options": { "apiKey": "..." } }
  },
  "disabled_providers": ["openai"],
  "enabled_providers": ["anthropic"],

  "mcp": {
    "playwright": { "type": "local", "command": ["npx", "-y", "@playwright/mcp"], "enabled": true, "env": {} },
    "remote-thing": { "type": "remote", "url": "https://...", "headers": { "Authorization": "Bearer ..." } }
  },

  "plugin": [
    "opencode-gemini-auth",
    "opencode-foo@1.2.3",
    "./local-plugin.ts",
    ["opencode-bar", { "option": "value" }]
  ],

  "permission": {
    "edit": "deny",
    "bash": { "git *": "allow", "*": "ask" }
  },

  "formatter": false,
  "lsp": false,

  "experimental": {
    "primary_tools": ["edit"],
    "mcp_timeout": 30000
  },

  "tool_output": { "max_lines": 200, "max_bytes": 8192 },

  "compaction": { "auto": true, "tail_turns": 15 }
}
```

### Common shape mistakes (these all reject hard)

| Wrong | Right |
|---|---|
| `"skills": [{ "name": "...", "path": "..." }]` | `"skills": { "paths": ["..."] }` |
| `"plugin": { "foo": "bar" }` | `"plugin": ["foo"]` |
| `"agent": [ { "name": "x", ... } ]` | `"agent": { "x": { ... } }` |
| `"mcp": { "x": { "command": "npx ..." } }` (missing type, command as string) | `"mcp": { "x": { "type": "local", "command": ["npx", "..."] } }` |
| `"permission": ["edit", "bash"]` | `"permission": { "edit": "allow", "bash": "ask" }` or `"permission": "allow"` |
| `"model": "claude-sonnet-4-6"` (missing provider prefix) | `"model": "anthropic/claude-sonnet-4-6"` |

## Skills (`SKILL.md`)

opencode's skill loader scans for `**/SKILL.md` in skill directories. The file
must be named `SKILL.md` exactly, and live in its own folder named after the
skill.

```
.opencode/skills/my-skill/SKILL.md       loads
.opencode/skills/my-skill.md             ignored (flat file, not a folder)
.opencode/skills/my-skill/skill.md       ignored (wrong case)
```

`SKILL.md` must start with YAML frontmatter:

```markdown
---
name: my-skill
description: One sentence describing what this skill does AND when to trigger it. Front-load the literal keywords or filenames the user will say.
---

# My Skill

(skill body in markdown: instructions, examples, references)
```

Frontmatter rules:
- `name` (required): lowercase, hyphen-separated, up to 64 chars, must match the folder name.
- `description` (effectively required): skills without one are filtered out and never surfaced to the model. Cover both *what* the skill does and *when* to use it. Write in third person ("Use when...", not "I help with..."). Front-load concrete trigger keywords and filenames; gate with "Use ONLY when..." if the skill should not fire on adjacent topics.
- Optional: `license`, `compatibility`, `metadata` (string-string map).

### Registering skills from a non-default location

```json
{
  "skills": {
    "paths": [".opencode/skills", "shared-skills"],
    "urls": ["https://example.com/.well-known/skills/"]
  }
}
```

Each path is scanned recursively for `**/SKILL.md`. Each URL must serve a list
of skills.

## Agents

Two ways to define an agent. Use the file form for anything non-trivial.

### Inline (in `opencode.json`)

```json
{
  "agent": {
    "my-reviewer": {
      "description": "Reviews PRs for style violations.",
      "mode": "subagent",
      "model": "anthropic/claude-sonnet-4-6",
      "permission": { "edit": "deny", "bash": "ask" },
      "prompt": "You are a strict PR reviewer..."
    }
  }
}
```

### File (preferred)

```
.opencode/agent/my-reviewer.md      OR     .opencode/agents/my-reviewer.md
```

```markdown
---
description: Reviews PRs for style violations.
mode: subagent
model: anthropic/claude-sonnet-4-6
permission:
  edit: deny
  bash: ask
---

You are a strict PR reviewer. Focus on...
(file body becomes the agent's `prompt`. Do NOT also put `prompt:` in frontmatter.)
```

Allowed `mode` values: `"primary"` | `"subagent"` | `"all"`.

Allowed top-level frontmatter fields: `name, model, variant, description, mode,
hidden, color, steps, options, permission, disable, tools, temperature, top_p`.
Any unknown field is silently routed into `options`.

`tools: { read: true, edit: false }` is deprecated. Use `permission` instead.

To disable a built-in agent: `agent: { build: { disable: true } }` (or in a
file, `disable: true` in frontmatter).

`default_agent` must point to a non-hidden, primary-mode agent.

### Built-in agents

opencode ships with: `build`, `plan`, `general`, `explore`, plus optionally
`scout` (gated on `OPENCODE_EXPERIMENTAL_SCOUT`). Hidden internal agents:
`compaction`, `title`, `summary`. To override a built-in's fields, define the
same key in `agent: { build: { ... } }`.

## Plugins

`plugin:` is an array. Each entry is one of:

```json
"plugin": [
  "opencode-gemini-auth",            // npm spec, latest
  "opencode-foo@1.2.3",              // npm spec, pinned
  "./local-plugin.ts",               // file path, relative to the declaring config
  "file:///abs/path/plugin.js",      // file URL
  ["opencode-bar", { "key": "val" }] // tuple form with options
]
```

Auto-discovered plugins (no config entry needed): any `*.ts` or `*.js` file
inside `.opencode/plugin/` or `.opencode/plugins/`.

### Authoring a plugin

A plugin module exports `default` (or any named export) of type
`Plugin = (input: PluginInput, options?) => Promise<Hooks>`.

```ts
import type { Plugin } from "@opencode-ai/plugin"

export default (async ({ client, project, directory, $ }) => {
  return {
    config: (cfg) => {
      // cfg is the live merged config; mutate fields here.
    },
    "tool.execute.before": async (input, output) => {
      // mutate output.args before the tool runs
    },
  }
}) satisfies Plugin
```

Hook surface (mutate `output` in place; return `void`):
- `event(input)`: fires for every bus event
- `config(cfg)`: once on init with the merged config
- `chat.message`, `chat.params`, `chat.headers`
- `tool.execute.before`, `tool.execute.after`
- `tool.definition`
- `command.execute.before`
- `shell.env`
- `permission.ask`
- `experimental.chat.messages.transform`, `experimental.chat.system.transform`,
  `experimental.session.compacting`, `experimental.compaction.autocontinue`,
  `experimental.text.complete`

Special hook objects: `tool: { my_tool: { ... } }`, `auth: { ... }`,
`provider: { ... }` are object-shaped, not callbacks.

A plugin must return an object. Return `{}` if there is nothing to register. Do
not export a plain object literal: the loader requires a function.

## MCP servers

`mcp:` is an object keyed by server name. Each server is discriminated by
`type`:

```json
{
  "mcp": {
    "playwright": {
      "type": "local",
      "command": ["npx", "-y", "@playwright/mcp"],
      "enabled": true,
      "env": { "BROWSER": "chromium" }
    },
    "github": {
      "type": "remote",
      "url": "https://...",
      "enabled": true,
      "headers": { "Authorization": "Bearer ${GITHUB_TOKEN}" }
    },
    "old-server": { "enabled": false }
  }
}
```

`command` MUST be an array of strings, never a single string. Missing `type`
silently fails to load. Use `enabled: false` to disable a server inherited from
a parent config.

## Permissions

```json
"permission": {
  "edit": "deny",
  "bash": { "git *": "allow", "rm *": "deny", "*": "ask" },
  "external_directory": { "~/secrets/**": "deny", "*": "allow" }
}
```

Actions: `"allow"`, `"ask"`, `"deny"`.

Per-tool value forms: `"allow"` shorthand (treated as `{"*": "allow"}`), or an
object `{ pattern: action }`. Within an object, **insertion order matters**.
opencode evaluates the LAST matching rule, so put broad rules first and narrow
rules last.

`permission: "allow"` (a string at the top level) is shorthand for "allow
everything" and is rarely what the user actually wants.

Known permission keys: `read, edit, glob, grep, list, bash, task,
external_directory, todowrite, question, webfetch, websearch, codesearch,
repo_clone, repo_overview, lsp, doom_loop, skill`. Some of these (`todowrite,
question, webfetch, websearch, codesearch, doom_loop`) only accept a flat
action, not a per-pattern object.

`external_directory` patterns are filesystem paths (use `~/`, absolute paths,
or globs like `~/projects/**`).

Per-agent `permission:` overrides top-level `permission:`. Plan Mode lives on
the `plan` agent's permission ruleset (`edit: deny *`).

## Useful escape hatches

When a user's config is broken and opencode won't start, these env vars help:

- `OPENCODE_DISABLE_PROJECT_CONFIG=1`: skips the project's local `opencode.json`
  so opencode starts from globals only. Run from the project directory,
  opencode loads, the user can edit the broken file, then they restart without
  the flag.
- `OPENCODE_CONFIG=/path/to/file.json`: load an additional explicit config.
- `OPENCODE_CONFIG_CONTENT='{"$schema":"https://opencode.ai/config.json"}'`:
  inject inline JSON as a final local-scope merge.
- `OPENCODE_DISABLE_DEFAULT_PLUGINS=1`: skip default plugins.
- `OPENCODE_PURE=1`: skip external plugins entirely.
- `OPENCODE_DISABLE_EXTERNAL_SKILLS=1` and
  `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1`: skip the external skill scans under
  `~/.claude/` and `~/.agents/`.

## When proposing edits to the user

- Validate against the schema before writing. If you are unsure of a field's
  exact shape, fetch `https://opencode.ai/config.json` rather than guessing.
- Preserve `$schema` and any existing fields the user did not ask to change.
- For agent, skill, and plugin definitions, prefer creating new files in the
  correct location over inlining everything in `opencode.json`.
- If the user's existing config is malformed, point them at the env-var escape
  hatch above so they can edit from inside opencode without breaking their
  session.
- opencode hard-fails on invalid config by design. There is no graceful
  degradation. A wrong shape means a startup error, so get it right the first
  time.
