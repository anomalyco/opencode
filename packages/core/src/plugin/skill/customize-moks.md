<!--
  Built-in skill. Name and description are registered in code at
  packages/core/src/plugin/skill.ts and packages/opencode/src/skill/index.ts.
  The body below becomes the skill's content.
-->

# Customizing moks

moks is a talent-acquisition agent harness. Config validation is strict — wrong
shapes hard-fail at startup. This skill is the product-facing guide for editing
moks config, agents, hiring skills, permissions, Ashby edge, and decision
authority. Prefer the shapes and paths here over guessing.

## Product model (keep this straight)

| Concept | moks meaning |
| ------- | ------------ |
| Primary doer | **`recruit`** agent (not a coding agent) |
| Local working tree | **`.moks/`** — req materials, plans, notes, receipts |
| Commit intent | **`moks commit`** — decision receipt (dry-run by default) |
| Inspect | **`moks status`** |
| Push authority | **`moks push`** — remote write path; adverse needs `--confirm` |
| ATS edge | MCP **read** tools (e.g. Ashby); writes denied — use decision verbs |
| Coding escape hatch | Hidden **`build`** agent (`--agent build` / `default_agent: build`) |

Never teach silent ATS stage moves. Dispositions go through commit → status → push.

## Paths: intended product vs what loads today

### Intended product paths

Document and prefer these when scaffolding new workspaces:

| Scope | Intended path |
| ----- | ------------- |
| Project config | `./moks.json` or `./moks.jsonc`, or `.moks/moks.json` |
| Project workspace | `.moks/` (req, plans, notes, receipts) |
| Project agents | `.moks/agent/<name>.md` or `.moks/agents/<name>.md` |
| Project commands | `.moks/command/<name>.md` or `.moks/commands/<name>.md` |
| Project skills | `.moks/skill(s)/<name>/SKILL.md` |
| Project plugins | `.moks/plugin(s)/*.ts` |
| Global config | `~/.config/moks/moks.json` (NOT `~/.moks/` for global config) |
| Global agents / skills / commands | under `~/.config/moks/` |

Always gitignore `.moks/` in user repos (receipts and local req drafts stay local).

### What loads

moks is a separate product. It does **not** read OpenCode files or `OPENCODE_*` env.

| Scope | Paths |
| ----- | ----- |
| Project config | `moks.json(c)` (walks up to worktree) |
| Nested config | `.moks/` may contain `moks.json(c)` |
| Project dirs | `.moks/` for `agent(s)/`, `command(s)/`, `skill(s)/`, `plugin(s)/`, themes |
| Global config | `~/.config/moks/moks.json(c)` |
| Env overrides | `MOKS_*` only (e.g. `MOKS_CONFIG`, `MOKS_CONFIG_DIR`, `MOKS_PURE`) |

**Also real today:**

| Surface | Path / behavior |
| ------- | --------------- |
| Req materials | `.moks/req/{jd,resume,scorecard,notes}.md` |
| Hiring plans | `.moks/plans/*.md` |
| Decision receipts | `.moks/receipts/` when `.moks/` exists; else user data dir `…/receipts/` |
| Built-in hiring skills | registered in-process (see below); disk skills can override by name |

Do not read or write `opencode.json` / `.opencode/` / `~/.config/opencode` — those belong to installed OpenCode.

Configs deep-merge; project overrides global. Unknown top-level keys are
rejected with `ConfigInvalidError`.

## Applying changes

Config is loaded once at startup and is not hot-reloaded. After saving config,
agents, skills, plugins, or other config-time files, **tell the user to quit and
restart moks**. The running session keeps the already-loaded config until then.

## moks config shape (shared schema summary)

Every field is optional. File name is **`moks.json` / `moks.jsonc`**.

```json
{
  "model": "provider/model-id",
  "small_model": "provider/model-id",
  "default_agent": "recruit",
  "username": "string",
  "shell": "/bin/zsh",
  "logLevel": "DEBUG" | "INFO" | "WARN" | "ERROR",
  "instructions": ["AGENTS.md", "docs/style.md"],

  "skills": {
    "paths": [".moks/skills", "/abs/path/to/skills"],
    "urls": ["https://example.com/.well-known/skills/"]
  },

  "agent": {
    "recruit": {
      "model": "anthropic/claude-sonnet-4-6",
      "permission": {
        "edit": {
          "*": "ask",
          ".moks/*": "allow"
        }
      }
    },
    "my-reviewer": {
      "mode": "subagent",
      "description": "...",
      "permission": { "edit": "deny" }
    }
  },

  "command": {
    "packet-review": { "description": "...", "template": "..." }
  },

  "provider": {
    "anthropic": { "options": { "apiKey": "..." } }
  },
  "disabled_providers": ["openai"],
  "enabled_providers": ["anthropic"],

  "mcp": {
    "ashby": {
      "type": "local",
      "command": ["bun", "run", "/path/to/ashby-mock.ts"],
      "enabled": true
    }
  },

  "permission": {
    "edit": { "*": "ask", ".moks/*": "allow" },
    "bash": { "moks *": "allow", "*": "ask" },
    "ashby_list_jobs": "allow",
    "ashby_get_job": "allow",
    "ashby_list_candidates": "allow",
    "ashby_get_candidate": "allow",
    "ashby_change_stage": "deny",
    "ashby_create_note": "deny"
  },

  "plugin": ["./local-plugin.ts"],

  "formatter": false,
  "lsp": false,

  "compaction": { "auto": true, "tail_turns": 15 }
}
```

Shape notes:

- `model` always carries a provider prefix: `"anthropic/claude-sonnet-4-6"`.
- `default_agent` for product installs should be **`recruit`** (native default). Use `"build"` only as an explicit coding escape hatch.
- `skills` is an object with `paths` and/or `urls`, not an array.
- `agent` / `command` are objects keyed by name, not arrays.
- `plugin` is an array of strings or `[name, options]` tuples.
- `mcp[name].command` is an array of strings; `type` is required.
- `permission` is a string action or an object keyed by tool / pattern.

Do **not** treat `https://opencode.ai/config.json` as the primary moks product
authority. That URL is legacy schema lineage for the shared config engine; moks
product behavior (recruit, `.moks/`, decision verbs, Ashby edge) is defined by
this skill and the moks codebase.

## `.moks/` workspace layout

Scaffold with `/init` (product command) or create by hand:

```
.moks/
  req/
    jd.md
    resume.md          # optional / per candidate
    scorecard.md
    notes.md
  plans/
    {timestamp}-{slug}.md
  receipts/            # decision log when workspace is moks-local
  agent/
  skill/
  command/
```

`recruit` may edit freely under `.moks/*`. Edits outside that tree ask first
(path-scoped permissions). Always ensure root `.gitignore` includes `.moks/`.

## Built-in agents

| Agent | Role |
| ----- | ---- |
| **recruit** | Default primary doer — hiring loop over local materials + skills + decision verbs |
| **plan** | Hiring strategy only; edits plan markdown under `.moks/plans` |
| **build** | Hidden coding escape hatch |
| **general** / **explore** | Subagents (research / parallel work) |
| Internal | `compaction`, `title`, `summary` (hidden) |

Override built-ins by defining the same key under `agent: { <name>: { ... } }`
or a file. Disable with `disable: true`. `default_agent` must point to a
non-hidden primary-mode agent.

### File agents

```
.moks/agent/my-reviewer.md
```

```markdown
---
description: Reviews hiring packets before push.
mode: subagent
permission:
  edit: deny
  bash: ask
---

You review disposition packets for evidence quality...
```

Body = agent `prompt`. Do not also put `prompt:` in frontmatter.
`mode`: `"primary"` | `"subagent"` | `"all"`.

Allowed frontmatter: `name, model, variant, description, mode, hidden, color,
steps, options, permission, disable, temperature, top_p`. Unknown keys go into
`options`.

## Built-in hiring skills

Registered before disk so a same-named disk skill overrides:

| Skill | When |
| ----- | ---- |
| **req-context** | Synthesize req brief from JD/notes/scorecard; list gaps |
| **score-candidate** | Score resume vs JD/scorecard with path citations |
| **draft-outreach** | Draft email/LinkedIn; never send |
| **commit-disposition** | Recommend advance/reject/offer/hire; end with `moks commit` instructions |
| **customize-moks** | This skill — moks config / agents / permissions / edge |

### Custom skills on disk

Skill loader scans `**/SKILL.md` under skill directories:

```
.moks/skills/my-skill/SKILL.md
```

```markdown
---
name: my-skill
description: One sentence covering what this skill does AND when to trigger it. Front-load keywords.
---

# My Skill

(instructions, examples, references)
```

- `name`: required, lowercase hyphen-separated, ≤64 chars, matches folder name.
- `description`: effectively required — skills without one are filtered out.
  Third person ("Use when…"); front-load triggers; use "Use ONLY when…" to stay quiet.
- Optional: `license`, `compatibility`, `metadata`.

Register non-default locations via `skills.paths` (recursive `**/SKILL.md`) and
`skills.urls`.

## Decision verbs (authority)

These are CLI authority, not silent tool side-effects:

```bash
# Record intent (dry-run default)
moks commit --action <action> --target-kind candidate --target-id <id> --reason "..."
moks commit --action note --json

# Inspect open commits + receipts
moks status
moks status --json

# Push committed decision (adverse: reject | offer | hire need --confirm)
moks push --commit-id <id>
moks push --commit-id <id> --confirm --json
```

Exit codes: `0` success, `1` error, `2` push needs `--confirm` (`needs_confirm`).

When customizing agents/skills that touch dispositions, always point at these
verbs. Do not invent MCP write shortcuts.

## Ashby edge (MCP)

MCP = **edge read**. Skills + verbs = hiring loop + write authority.

Built-in `recruit` permissions (defaults):

- **Allow reads:** `ashby_list_jobs`, `ashby_get_job`, `ashby_list_candidates`, `ashby_get_candidate`
- **Deny writes:** `ashby_change_stage`, `ashby_create_note`
- **Edit:** ask outside `.moks/` (and fixtures / `.gitignore`); allow under `.moks/*`
- **Bash:** default **ask**; **allow** `moks *` (commit/status/push) and light reads (`ls`, `pwd`, …); **deny** destructive patterns (`rm *`, `sudo *`, `git push *`, …)

Sample mock config (shape):

```json
{
  "mcp": {
    "ashby": {
      "type": "local",
      "command": ["bun", "run", "/path/to/ashby-mock.ts"],
      "enabled": true
    }
  },
  "permission": {
    "ashby_list_jobs": "allow",
    "ashby_get_job": "allow",
    "ashby_list_candidates": "allow",
    "ashby_get_candidate": "allow",
    "ashby_change_stage": "deny",
    "ashby_create_note": "deny"
  }
}
```

Helpers live in product code (`ashbyPermissionDefaults`, mock fixtures under
`product/fixtures/mcp/`). Keep write tools denied unless the user is explicitly
building a controlled sink — and even then, prefer commit/push as the product path.

## Permissions

```json
"permission": {
  "edit": { "*": "ask", ".moks/*": "allow" },
  "bash": { "*": "ask", "moks *": "allow", "ls *": "allow", "rm *": "deny", "git push *": "deny" },
  "external_directory": { "~/secrets/**": "deny", "*": "allow" }
}
```

Actions: `"allow"`, `"ask"`, `"deny"`.

Per-tool forms: `"allow"` shorthand (`{"*": "allow"}`), or `{ pattern: action }`.
**Insertion order matters** — last matching rule wins; put broad rules first,
narrow last.

`permission: "allow"` (top-level string) means allow everything — rarely wanted.

Known keys include: `read, edit, glob, grep, list, bash, task, external_directory,
todowrite, question, webfetch, websearch, lsp, doom_loop, skill`, plus MCP tool
names (`ashby_*`). Some only accept a flat action.

**recruit defaults (product):** path-scoped `edit` (allow `.moks/*` + hiring
fixtures; ask elsewhere), Ashby read allow / write deny, `question` + `plan_enter`
allowed. Per-agent `permission:` overrides top-level.

Plan Mode: `plan` agent edits only plan markdown; no decision recording.

## Commands

Discovered as `**/*.md` under command directories:

```
.moks/command/deploy.md
```

```markdown
---
description: One sentence describing what the command does.
agent: recruit
---

(prompt body; $ARGUMENTS for user input; $1, $2, … positional)
```

Product built-in: **`init`** scaffolds a requisition under `.moks/`.

## Plugins

`plugin:` is an array:

```json
"plugin": [
  "some-npm-plugin",
  "some-npm-plugin@1.2.3",
  "./local-plugin.ts",
  "file:///abs/path/plugin.js",
  ["plugin-with-opts", { "key": "val" }]
]
```

Auto-discovered: `*.ts` / `*.js` in `.moks/plugin(s)/`.

A plugin exports `default` (or a named export) as
`(input, options?) => Promise<Hooks>` — a function returning a hooks object
(return `{}` if empty).

Common hooks: `config`, `event`, `chat.message`, `chat.params`, `chat.headers`,
`tool.execute.before` / `after`, `tool.definition`, `command.execute.before`,
`shell.env`, `permission.ask`, plus experimental chat/session transforms.
Object-shaped surfaces: `tool`, `auth`, `provider`.

## MCP servers (general)

```json
{
  "mcp": {
    "playwright": {
      "type": "local",
      "command": ["npx", "-y", "@playwright/mcp"],
      "enabled": true,
      "environment": { "BROWSER": "chromium" }
    },
    "remote-thing": {
      "type": "remote",
      "url": "https://...",
      "headers": { "Authorization": "Bearer {env:TOKEN}" }
    }
  }
}
```

`command` is always a string array. `{env:VAR}` / `{file:path}` interpolation
works in strings; shell-style `${VAR}` is not substituted. `enabled: false`
disables an inherited server.

## Escape hatches

When config is broken and moks won't start:

- `MOKS_DISABLE_PROJECT_CONFIG=1` — skip project local config
- `MOKS_CONFIG=/path/to/file.json` — extra explicit config
- `MOKS_CONFIG_CONTENT='{...}'` — inline JSON final local merge
- `MOKS_PURE=1` — skip external plugins

## When proposing edits

- Prefer **moks product semantics**: `recruit`, `.moks/` workspace, hiring skills, commit/status/push, Ashby read-only edge.
- Write **`moks.json` / `.moks/`** and global **`~/.config/moks`**. Never OpenCode paths.
- Do not send users to opencode.ai as the primary config authority for moks.
- Preserve fields the user did not ask to change.
- Prefer new agent/command/skill/plugin **files** over inlining everything in JSON.
- If config is broken, point at env escape hatches so they can edit from a session that still starts.
- After any config-time change, remind the user to **quit and restart moks**.
- Never configure default ATS write tools as allow for `recruit`.
