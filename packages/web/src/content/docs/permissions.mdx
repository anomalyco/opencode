---
title: Permissions
description: Control which actions require approval to run.
---

OpenCode uses the `permission` config to decide whether a given action should run automatically, prompt you, or be blocked.

As of `v1.1.1`, the legacy `tools` boolean config is deprecated and has been merged into `permission`. The old `tools` config is still supported for backwards compatibility.

---

## Actions

Each permission rule resolves to one of:

- `"allow"` — run without approval
- `"ask"` — prompt for approval
- `"deny"` — block the action

---

## Auto mode

Start OpenCode with `--auto` to automatically approve permission requests that are not explicitly denied.

```bash
opencode --auto
```

You can also use auto mode with [`opencode run`](/docs/cli#run).

```bash
opencode run --auto "Refactor this module"
```

Explicit `"deny"` rules are still enforced. Auto mode only changes requests that would otherwise ask for approval.

In the TUI, open the command palette and select **Enable auto-approve permissions** or **Disable auto-approve permissions** to change modes. When auto mode is active, the prompt displays a muted `auto` indicator next to the current agent.

---

## Configuration

You can set permissions globally (with `*`), and override specific tools.

```json title="opencode.json"
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "*": "ask",
    "bash": "allow",
    "edit": "deny"
  }
}
```

You can also set all permissions at once:

```json title="opencode.json"
{
  "$schema": "https://opencode.ai/config.json",
  "permission": "allow"
}
```

---

## Granular Rules (Object Syntax)

For most permissions, you can use an object to apply different actions based on the tool input.

```json title="opencode.json"
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "bash": {
      "*": "ask",
      "git *": "allow",
      "npm *": "allow",
      "rm *": "deny",
      "grep *": "allow"
    },
    "edit": {
      "*": "deny",
      "packages/web/src/content/docs/*.mdx": "allow"
    }
  }
}
```

Rules are evaluated by pattern match, with the **last matching rule winning**. A common pattern is to put the catch-all `"*"` rule first, and more specific rules after it.

### Wildcards

Permission patterns use simple wildcard matching:

- `*` matches zero or more of any character
- `?` matches exactly one character
- All other characters match literally

### Home Directory Expansion

You can use `~` or `$HOME` at the start of a pattern to reference your home directory. This is particularly useful for [`external_directory`](#external-directories) rules.

- `~/projects/*` -> `/Users/username/projects/*`
- `$HOME/projects/*` -> `/Users/username/projects/*`
- `~` -> `/Users/username`

### External Directories

Use `external_directory` to allow tool calls that touch paths outside the working directory where OpenCode was started. This applies to any tool that takes a path as input (for example `read`, `edit`, `glob`, `grep`, and many `bash` commands).

Home expansion (like `~/...`) only affects how a pattern is written. It does not make an external path part of the current workspace, so paths outside the working directory must still be allowed via `external_directory`.

For example, this allows access to everything under `~/projects/personal/`:

```json title="opencode.json"
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "external_directory": {
      "~/projects/personal/**": "allow"
    }
  }
}
```

Any directory allowed here inherits the same defaults as the current workspace. Since [`read` defaults to `allow`](#defaults), reads are also allowed for entries under `external_directory` unless overridden. Add explicit rules when a tool should be restricted in these paths, such as blocking edits while keeping reads:

```json title="opencode.json"
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "external_directory": {
      "~/projects/personal/**": "allow"
    },
    "edit": {
      "~/projects/personal/**": "deny"
    }
  }
}
```

Keep the list focused on trusted paths, and layer extra allow or deny rules as needed for other tools (for example `bash`).

---

## Available Permissions

OpenCode permissions are keyed by tool name, plus a couple of safety guards:

- `read` — reading a file (matches the file path)
- `edit` — all file modifications (covers `edit`, `write`, `patch`)
- `glob` — file globbing (matches the glob pattern)
- `grep` — content search (matches the regex pattern)
- `bash` — running shell commands (matches parsed commands like `git status --porcelain`)
- `task` — launching subagents (matches the subagent type)
- `skill` — loading a skill (matches the skill name)
- `lsp` — running LSP queries (currently non-granular)
- `question` — asking the user questions during execution
- `webfetch` — fetching a URL (matches the URL)
- `websearch` — web search (matches the query)
- `external_directory` — triggered when a tool touches paths outside the project working directory
- `doom_loop` — triggered when the same tool call repeats 3 times with identical input

---

## Defaults

If you don’t specify anything, OpenCode starts from permissive defaults:

- Most permissions default to `"allow"`.
- `doom_loop` and `external_directory` default to `"ask"`.
- `read` is `"allow"`, but `.env` files are denied by default:

```json title="opencode.json"
{
  "permission": {
    "read": {
      "*": "allow",
      "*.env": "deny",
      "*.env.*": "deny",
      "*.env.example": "allow"
    }
  }
}
```

---

## What “Ask” Does

When OpenCode prompts for approval, the UI offers three outcomes:

- `once` — approve just this request
- `always` — approve future requests matching the suggested patterns (for the rest of the current OpenCode session)
- `reject` — deny the request

The set of patterns that `always` would approve is provided by the tool (for example, bash approvals typically whitelist a safe command prefix like `git status*`).

---

## Agents

You can override permissions per agent. Agent permissions are merged with the global config, and agent rules take precedence. [Learn more](/docs/agents#permissions) about agent permissions.

:::note
Refer to the [Granular Rules (Object Syntax)](#granular-rules-object-syntax) section above for more detailed pattern matching examples.
:::

```json title="opencode.json"
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "bash": {
      "*": "ask",
      "git *": "allow",
      "git commit *": "deny",
      "git push *": "deny",
      "grep *": "allow"
    }
  },
  "agent": {
    "build": {
      "permission": {
        "bash": {
          "*": "ask",
          "git *": "allow",
          "git commit *": "ask",
          "git push *": "deny",
          "grep *": "allow"
        }
      }
    }
  }
}
```

You can also configure agent permissions in Markdown:

```markdown title="~/.config/opencode/agents/review.md"
---
description: Code review without edits
mode: subagent
permission:
  edit: deny
  bash: ask
  webfetch: deny
---

Only analyze code and suggest changes.
```

:::tip
Use pattern matching for commands with arguments. `"grep *"` allows `grep pattern file.txt`, while `"grep"` alone would block it. Commands like `git status` work for default behavior but require explicit permission (like `"git status *"`) when arguments are passed.
:::
