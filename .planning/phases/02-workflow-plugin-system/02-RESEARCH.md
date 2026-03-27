# Phase 2: Workflow Plugin System - Research

**Researched:** 2026-03-26
**Domain:** CoBuilder CLI extension system — workflow plugins, CLI commands, config loading, Skill/Command infrastructure
**Confidence:** HIGH (all findings from direct codebase inspection)

## Summary

CoBuilder (forked from opencode) has two parallel extension systems that the workflow plugin system must integrate with: the **Skill system** (markdown files with YAML frontmatter, discovered by glob scan) and the **Command system** (aggregates from config commands, MCP prompts, and skills into a unified slash-command list). There is also a separate npm-based **Plugin system** (`src/plugin/`) for runtime hooks (auth, chat headers, bus events) — this is NOT the right integration point for workflow plugins, which are purely data/text-based.

The cleanest implementation path is to model workflow plugins on the existing Skill system: a directory of markdown files under `~/.config/opencode/workflows/<name>/` with a `WORKFLOW.md` manifest, `commands/` and `agents/` subdirectories. The `cobuilder workflow add` CLI command should clone/copy the plugin directory and register its path in the global `opencode.json` config under a new `workflow.paths` key (or reuse `skills.paths` pointing at the workflow commands dir). The Command system already picks up commands from any directory registered in `Config.directories()`.

The CLI uses yargs with `CommandModule` pattern. New `workflow` subcommand group follows the same `cmd()` wrapper and is registered in `src/index.ts` alongside `OnboardCommand`.

**Primary recommendation:** Model workflow plugins on the Skill/Command file-based system, not the npm Plugin system. A workflow directory IS a config directory that the existing `loadCommand` / `loadAgent` machinery processes automatically once its path is added to config.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| yargs | already in use | CLI subcommands | Same pattern as all other cmds |
| @clack/prompts | already in use | Interactive install UX | Used in `onboard.ts`, `mcp.ts` |
| zod | already in use | Schema validation for WORKFLOW.md frontmatter | All config types use zod |
| jsonc-parser | already in use | Read/write opencode.json | Used in `Config` for all config edits |
| effect | already in use | Service layer for Workflow.Service | All services use Effect |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Bun.$ (shell) | built-in | `git clone` for GitHub installs | When source is a git URL |
| Filesystem util | internal | Read/write config JSON | Already wraps fs/promises |
| ConfigMarkdown | internal | Parse WORKFLOW.md frontmatter | Same as SKILL.md / command .md parsing |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| git clone via Bun.$ | BunProc.install (npm) | npm only works for npm packages; git repos need clone |
| Registering in config.skills.paths | New config.workflow.paths key | New key is cleaner/explicit; skills.paths would mix concerns |

## Architecture Patterns

### Recommended Project Structure
```
src/
├── workflow/
│   ├── index.ts          # Workflow.Service — list, install, remove
│   └── registry.ts       # Built-in alias map (gsd, ralph-loop, gstack)
├── cli/cmd/
│   └── workflow.ts       # WorkflowCommand (yargs subcommands: add, list, remove)
└── config/
    └── config.ts         # Add workflow?: WorkflowConfig to Info schema

~/.config/opencode/workflows/
└── <plugin-name>/
    ├── WORKFLOW.md        # Manifest: name, version, description, commands list
    ├── commands/          # Slash commands — picked up by loadCommand()
    │   └── plan-phase.md
    ├── agents/            # Agent prompts — picked up by loadAgent()
    │   └── planner.md
    └── hooks/             # Lifecycle hooks (future — not in Phase 2 scope)
```

### Pattern 1: Config Directory Registration
**What:** The existing `Config.directories()` returns a list of dirs that `loadCommand()`, `loadAgent()`, and `loadPlugin()` scan. Workflow plugin dirs just need to be added to this list.
**When to use:** When a workflow is installed.

The `Config.state` function iterates `directories` and calls `loadCommand(dir)` for each. So if `~/.config/opencode/workflows/gsd` is in `directories`, its `commands/*.md` files are auto-loaded. No new scanning logic needed.

**Key insight from code:** `loadCommand` scans `{command,commands}/**/*.md` relative to the dir. So a workflow dir with a `commands/` subdirectory is already handled.

**Implementation:** Add `workflow.paths` array to `Config.Info` (similar to `skills.paths`). In `Config.state`, push each resolved workflow path into `directories`. That's the entire integration point.

```typescript
// In Config.Info schema (config.ts)
workflow: z.object({
  paths: z.array(z.string()).optional().describe("Installed workflow plugin directories"),
}).optional()

// In Config.state, after building directories array:
for (const item of cfg.workflow?.paths ?? []) {
  const expanded = item.startsWith("~/") ? path.join(os.homedir(), item.slice(2)) : item
  directories.push(expanded)
}
```

### Pattern 2: WORKFLOW.md Manifest (frontmatter)
**What:** Same structure as SKILL.md — YAML frontmatter + markdown body.
**When to use:** Every workflow plugin must have one at its root.

```markdown
---
name: gsd
version: 1.0.0
description: Get Shit Done — structured project planning and execution methodology
commands:
  - plan-phase
  - execute-phase
  - discuss-phase
---

# GSD Workflow

Full instructions and methodology documentation here...
```

Parsed with `ConfigMarkdown.parse()` (already handles YAML frontmatter). The `name` and `version` fields are validated by a new `Workflow.Info` zod schema.

### Pattern 3: CLI Command Registration
**What:** yargs `CommandModule` with subcommands, registered in `src/index.ts`.
**When to use:** All new CLI commands follow this pattern.

```typescript
// src/cli/cmd/workflow.ts
import { cmd } from "./cmd"
export const WorkflowCommand = cmd({
  command: "workflow <action>",
  describe: "manage workflow plugins",
  builder: (yargs) => yargs
    .command(workflowAddCmd)
    .command(workflowListCmd)
    .command(workflowRemoveCmd),
  handler: () => {},
})

// src/index.ts — add alongside OnboardCommand:
.command(WorkflowCommand)
```

### Pattern 4: Plugin Installation via git clone
**What:** `cobuilder workflow add <source>` accepts a GitHub URL or short alias.
**When to use:** Installing from a git repository.

```typescript
// For GitHub URLs: git clone into ~/.config/opencode/workflows/<name>/
await Bun.$`git clone ${url} ${destDir}`.quiet()

// For aliases: resolve from built-in registry map
const REGISTRY: Record<string, string> = {
  "gsd": "https://github.com/CobuilderLabs/gsd-workflow",
  "ralph-loop": "https://github.com/CobuilderLabs/ralph-loop-workflow",
  "gstack": "https://github.com/CobuilderLabs/gstack-workflow",
}
```

After cloning, update `~/.config/opencode/opencode.json` to add the path to `workflow.paths` using `Filesystem.readJson` / `Filesystem.writeJson` (same pattern as `onboard.ts` lines 136-163).

### Pattern 5: Workflow.Service (Effect Service)
**What:** Effect-based service following same pattern as `Skill.Service` and `Command.Service`.

```typescript
export namespace Workflow {
  export interface Interface {
    readonly list: () => Effect.Effect<Info[]>
    readonly install: (source: string) => Effect.Effect<void>
    readonly remove: (name: string) => Effect.Effect<void>
  }
  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Workflow") {}
}
```

### Anti-Patterns to Avoid
- **Using the npm Plugin system** (`src/plugin/index.ts`): That system is for runtime hooks (auth, chat.headers, bus events). Workflow plugins are purely data (markdown files). Using npm plugins would require TypeScript compilation and npm packaging for what are essentially text files.
- **Hardcoding workflow directories**: Use `Global.Path.config` + `xdg-basedir` to resolve `~/.config/opencode/workflows/` — don't assume path.
- **Scanning workflows dir globally**: Don't scan `~/.config/opencode/workflows/` automatically on every startup without an explicit registry in config. This prevents accidental loading of manually-placed directories and keeps load order deterministic.
- **Storing registry aliases in opencode.json**: The alias-to-URL map (`gsd` → GitHub URL) belongs in source code (`workflow/registry.ts`), not in user config. User config only stores installed paths.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Markdown frontmatter parsing | Custom YAML parser | `ConfigMarkdown.parse()` | Already handles all edge cases including error reporting |
| Config file read/write | Raw fs calls | `Filesystem.readJson` / `Filesystem.writeJson` | Handles permissions (0o600), atomic writes |
| Directory scanning | Custom glob | `Glob.scan()` from `src/util/glob.ts` | Handles symlinks, dot files, absolute paths |
| CLI prompts | Readline | `@clack/prompts` | Consistent UX, already in project |
| Effect service pattern | Custom async class | `ServiceMap.Service` + `InstanceState` | Required for consistency with rest of codebase |
| Config path resolution | Manual `path.join` | `Global.Path.config` (xdg-basedir) | Cross-platform, respects XDG spec |

## Common Pitfalls

### Pitfall 1: Config Load Timing
**What goes wrong:** `Config.state` is an `Instance.state` — it initializes once per instance. Adding workflow paths to config after init won't be reflected until restart.
**Why it happens:** The config directories list is built eagerly at startup. Commands added by workflows only appear in the Command list after the next startup.
**How to avoid:** After `workflow add`, print a message: "Workflow installed. Restart CoBuilder to activate commands." Don't try to hot-reload.
**Warning signs:** Commands from newly installed workflow don't appear in `/` autocomplete without restart.

### Pitfall 2: Config.directories() vs Config.get()
**What goes wrong:** Calling `Config.get()` returns the merged config object, but `Config.directories()` returns the list of directories that will be scanned for commands/agents/plugins. These are computed separately.
**Why it happens:** `directories` is built inside `Config.state` alongside `config` — see lines 134 and 261. Both come from `state()`.
**How to avoid:** Workflow paths must be pushed into `directories` inside `Config.state`, not just added to `cfg.workflow.paths`. Read the returned `{ config, directories, deps }` tuple.

### Pitfall 3: Path Deduplication
**What goes wrong:** Installing the same workflow twice adds duplicate paths to `workflow.paths` in config, causing duplicate commands.
**Why it happens:** The config write just appends without checking.
**How to avoid:** Before writing, check if `path` already exists in `workflow.paths` array. Also check for name collision with `WORKFLOW.md` name field.

### Pitfall 4: Git not available
**What goes wrong:** `git clone` fails silently or with a confusing error if git is not installed.
**Why it happens:** Bun's `$` throws on non-zero exit code.
**How to avoid:** Check `command -v git` before attempting clone. Offer fallback message. Log stderr from the clone operation.

### Pitfall 5: WORKFLOW.md name vs directory name mismatch
**What goes wrong:** User clones to `~/.config/opencode/workflows/my-gsd/` but WORKFLOW.md says `name: gsd`. This causes confusion in `workflow list` output.
**How to avoid:** After install, validate that WORKFLOW.md `name` field matches the target directory name (same pattern as `Skill.NameMismatchError`). Warn but don't block.

## Code Examples

### How Config.directories() is populated (source: config.ts:134)
```typescript
const directories = await ConfigPaths.directories(Instance.directory, Instance.worktree)
// ...
for (const dir of unique(directories)) {
  result.command = mergeDeep(result.command ?? {}, await loadCommand(dir))
  result.agent = mergeDeep(result.agent, await loadAgent(dir))
  result.plugin.push(...(await loadPlugin(dir)))
}
return { config: result, directories, deps }
```

### How loadCommand scans a directory (source: config.ts:384)
```typescript
async function loadCommand(dir: string) {
  for (const item of await Glob.scan("{command,commands}/**/*.md", {
    cwd: dir, absolute: true, dot: true, symlink: true,
  })) {
    const md = await ConfigMarkdown.parse(item)
    // frontmatter: { name, description, agent, model, subtask, template }
    // body becomes template
  }
}
```

### How onboard.ts writes to opencode.json (source: onboard.ts:136-163)
```typescript
const configPath = path.join(Global.Path.config, "opencode.json")
let existing: any = {}
try { existing = await Filesystem.readJson(configPath) } catch {}
const updated = { ...existing, workflow: { paths: [...(existing.workflow?.paths ?? []), newPath] } }
await Filesystem.writeJson(configPath, updated)
```

### How to register a yargs subcommand (source: src/index.ts pattern)
```typescript
// src/index.ts — all commands follow this pattern
let cli = yargs(hideBin(process.argv))
  .command(OnboardCommand)
  .command(WorkflowCommand)  // add here
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| npm-only plugins | File-based commands + npm plugins | Exists now | Workflow plugins should use file-based, not npm |
| Global skills only | skills.paths for custom skill dirs | Exists now | Exact same pattern for workflow.paths |

## Open Questions

1. **Config schema extension approval**
   - What we know: `Config.Info` uses zod `.object()` with known fields + `.catchall(z.any())` not present — it's strict in some places
   - What's unclear: Whether adding `workflow` to `Config.Info` requires updating the JSON schema file at `opencode.ai/config.json`
   - Recommendation: Add to `Config.Info` zod schema only; schema export is auto-generated, external URL is upstream concern

2. **Hook system scope**
   - What we know: Phase description mentions `hooks/` (lifecycle hooks) in plugin dirs
   - What's unclear: What lifecycle events should hooks trigger on? The npm Plugin system has `Hooks` type for things like `chat.headers` and `auth` — but those are runtime concerns
   - Recommendation: Defer hooks to a follow-up phase. Phase 2 delivers commands + agents only. Mark WF-09/WF-10 as "hooks infrastructure" tasks that scaffold the directory but don't wire up execution.

3. **Workflow update mechanism**
   - What we know: `cobuilder workflow add` installs via git clone
   - What's unclear: How does `cobuilder workflow update` work? Re-clone? `git pull`?
   - Recommendation: `git pull` in the workflow directory for updates. Out of scope for Phase 2 — just note it.

## Environment Availability

Step 2.6: Skipped for the CLI/install path itself (pure TypeScript code changes). For the `git clone` install path:

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| git | `workflow add <github-url>` | Likely (check at runtime) | unknown | Print "git not found — install git or provide a local path" |
| bun | All code | Yes (runtime) | project runtime | None needed |

**Missing dependencies with no fallback:** None (git absence is gracefully handled with a user message).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Bun test (built-in) |
| Config file | `bunfig.toml` or none — check project root |
| Quick run command | `bun test packages/opencode/src/workflow/` |
| Full suite command | `bun test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WF-01 | `workflow add <url>` clones to ~/.config/opencode/workflows/ | integration | `bun test packages/opencode/src/workflow/index.test.ts -t install` | Wave 0 |
| WF-02 | `workflow add gsd` resolves alias to URL | unit | `bun test packages/opencode/src/workflow/registry.test.ts` | Wave 0 |
| WF-03 | WORKFLOW.md parsed with zod schema | unit | `bun test packages/opencode/src/workflow/index.test.ts -t parse` | Wave 0 |
| WF-04 | Installed workflow commands appear in Command.list() | integration | `bun test packages/opencode/src/workflow/index.test.ts -t commands` | Wave 0 |
| WF-05 | `workflow list` shows installed workflows | unit | `bun test packages/opencode/src/workflow/index.test.ts -t list` | Wave 0 |
| WF-06 | `workflow remove <name>` deletes dir and removes from config | integration | `bun test packages/opencode/src/workflow/index.test.ts -t remove` | Wave 0 |
| WF-07 | Duplicate install is idempotent (no duplicate paths) | unit | `bun test packages/opencode/src/workflow/index.test.ts -t dedup` | Wave 0 |
| WF-08 | Config.Info accepts workflow.paths | unit | `bun test packages/opencode/src/config/config.test.ts -t workflow` | Wave 0 |
| WF-09 | hooks/ directory is created but not executed | smoke | manual | N/A |
| WF-10 | workflow.paths added to directories in Config.state | integration | `bun test packages/opencode/src/workflow/index.test.ts -t config-dirs` | Wave 0 |

### Wave 0 Gaps
- [ ] `packages/opencode/src/workflow/index.test.ts` — covers WF-01, WF-03–WF-07, WF-10
- [ ] `packages/opencode/src/workflow/registry.test.ts` — covers WF-02
- [ ] `packages/opencode/src/config/config.test.ts` addition — covers WF-08 (may already exist, check)

## Sources

### Primary (HIGH confidence)
- `src/plugin/index.ts` — plugin system: npm install, file:// URLs, Hooks interface, bus subscription
- `src/skill/index.ts` — skill system: SKILL.md discovery, frontmatter parsing, Config.directories() integration
- `src/skill/discovery.ts` — remote skill pull pattern via index.json
- `src/command/index.ts` — Command.Service: aggregates config commands + MCP prompts + skills into unified list
- `src/config/config.ts` — Config.Info schema, loadCommand/loadAgent/loadPlugin scanning patterns, Config.directories()
- `src/global/index.ts` — Global.Path.config = XDG config dir + "opencode" (typically ~/.config/opencode)
- `src/cli/cmd/onboard.ts` — pattern for writing to opencode.json via Filesystem.readJson/writeJson
- `src/cli/cmd/cmd.ts` + `src/index.ts` — yargs CommandModule pattern, command registration

### Secondary (MEDIUM confidence)
- Bun shell (`Bun.$`) for git clone — documented in Bun official docs, used elsewhere in codebase via `BunProc`

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified in codebase
- Architecture: HIGH — patterns traced directly from working code (Skill system is the direct model)
- Pitfalls: HIGH — derived from reading Config.state initialization logic and load-order mechanics

**Research date:** 2026-03-26
**Valid until:** 2026-04-26 (stable codebase, 30-day window)
