# Bash Command Semantics Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add intelligent classification of bash commands by semantics (read-only, write, destructive, network, system) before execution, enabling smarter permission prompts and per-agent policy enforcement.

**Architecture:** Extend the existing `BashArity` system with a parallel `CommandSemantics` namespace. Classification rules are defined as a data structure, not hardcoded logic. Integration with the permission system via a new `command_semantics` permission type that maps semantic categories to actions (allow/ask/deny) per agent.

**Tech Stack:** TypeScript, existing `BashArity` prefix matching, `PermissionNext` ruleset system

---

### Task 1: Define the CommandSemantics classifier

**Files:**

- Create: `packages/opencode/src/permission/semantics.ts`
- Test: `packages/opencode/test/permission/semantics.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/permission/semantics.test.ts
import { test, expect } from "bun:test"
import { CommandSemantics } from "../../src/permission/semantics"

test("classify read-only commands", () => {
  expect(CommandSemantics.classify(["cat", "file.txt"])).toBe("read")
  expect(CommandSemantics.classify(["grep", "pattern", "file"])).toBe("read")
  expect(CommandSemantics.classify(["ls", "-la"])).toBe("read")
  expect(CommandSemantics.classify(["git", "status"])).toBe("read")
  expect(CommandSemantics.classify(["git", "log", "--oneline"])).toBe("read")
  expect(CommandSemantics.classify(["pwd"])).toBe("read")
  expect(CommandSemantics.classify(["which", "node"])).toBe("read")
  expect(CommandSemantics.classify(["echo", "hello"])).toBe("read")
})

test("classify write commands", () => {
  expect(CommandSemantics.classify(["touch", "newfile.txt"])).toBe("write")
  expect(CommandSemantics.classify(["mkdir", "newdir"])).toBe("write")
  expect(CommandSemantics.classify(["cp", "a.txt", "b.txt"])).toBe("write")
  expect(CommandSemantics.classify(["mv", "old.txt", "new.txt"])).toBe("write")
  expect(CommandSemantics.classify(["git", "add", "."])).toBe("write")
  expect(CommandSemantics.classify(["git", "commit", "-m", "msg"])).toBe("write")
  expect(CommandSemantics.classify(["npm", "install", "lodash"])).toBe("write")
  expect(CommandSemantics.classify(["bun", "add", "zod"])).toBe("write")
})

test("classify destructive commands", () => {
  expect(CommandSemantics.classify(["rm", "-rf", "node_modules"])).toBe("destructive")
  expect(CommandSemantics.classify(["rmdir", "empty-dir"])).toBe("destructive")
  expect(CommandSemantics.classify(["git", "reset", "--hard"])).toBe("destructive")
  expect(CommandSemantics.classify(["git", "clean", "-fdx"])).toBe("destructive")
  expect(CommandSemantics.classify(["git", "push", "--force"])).toBe("destructive")
  expect(CommandSemantics.classify(["DROP", "TABLE", "users"])).toBe("destructive")
  expect(CommandSemantics.classify(["truncate", "table"])).toBe("destructive")
  expect(CommandSemantics.classify(["kill", "-9", "1234"])).toBe("destructive")
})

test("classify network commands", () => {
  expect(CommandSemantics.classify(["curl", "https://api.example.com"])).toBe("network")
  expect(CommandSemantics.classify(["wget", "https://example.com/file"])).toBe("network")
  expect(CommandSemantics.classify(["ssh", "user@host"])).toBe("network")
  expect(CommandSemantics.classify(["scp", "file", "host:path"])).toBe("network")
  expect(CommandSemantics.classify(["ping", "8.8.8.8"])).toBe("network")
})

test("classify system commands", () => {
  expect(CommandSemantics.classify(["sudo", "apt", "install", "nginx"])).toBe("system")
  expect(CommandSemantics.classify(["chown", "user:group", "file"])).toBe("system")
  expect(CommandSemantics.classify(["chmod", "755", "script.sh"])).toBe("system")
  expect(CommandSemantics.classify(["systemctl", "restart", "nginx"])).toBe("system")
})

test("default to write for unknown commands", () => {
  expect(CommandSemantics.classify(["unknown_command", "arg1"])).toBe("write")
  expect(CommandSemantics.classify([])).toBe("write")
})

test("flags affect classification — --force escalates", () => {
  // git push is write, but git push --force is destructive
  expect(CommandSemantics.classify(["git", "push"])).toBe("write")
  expect(CommandSemantics.classify(["git", "push", "--force"])).toBe("destructive")
  expect(CommandSemantics.classify(["git", "push", "-f"])).toBe("destructive")
  // rm without -rf is still destructive
  expect(CommandSemantics.classify(["rm", "file.txt"])).toBe("destructive")
})

test("getPermissionAction maps semantics to actions", () => {
  // Default policy: read=allow, write=ask, destructive=ask, network=ask, system=ask
  const policy = CommandSemantics.defaultPolicy()
  expect(CommandSemantics.getPermissionAction("read", policy)).toBe("allow")
  expect(CommandSemantics.getPermissionAction("write", policy)).toBe("ask")
  expect(CommandSemantics.getPermissionAction("destructive", policy)).toBe("ask")
  expect(CommandSemantics.getPermissionAction("network", policy)).toBe("ask")
  expect(CommandSemantics.getPermissionAction("system", policy)).toBe("ask")
})

test("plan agent policy denies destructive", () => {
  const policy = CommandSemantics.planAgentPolicy()
  expect(CommandSemantics.getPermissionAction("read", policy)).toBe("allow")
  expect(CommandSemantics.getPermissionAction("write", policy)).toBe("deny")
  expect(CommandSemantics.getPermissionAction("destructive", policy)).toBe("deny")
})

test("explore agent policy allows read and network", () => {
  const policy = CommandSemantics.exploreAgentPolicy()
  expect(CommandSemantics.getPermissionAction("read", policy)).toBe("allow")
  expect(CommandSemantics.getPermissionAction("network", policy)).toBe("allow")
  expect(CommandSemantics.getPermissionAction("write", policy)).toBe("ask")
  expect(CommandSemantics.getPermissionAction("destructive", policy)).toBe("deny")
})

test("custom rules override defaults", () => {
  const custom = CommandSemantics.defaultPolicy()
  custom.npm = "allow" // allow npm commands
  expect(CommandSemantics.getPermissionAction("write", custom, ["npm", "install", "lodash"])).toBe("allow")
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/permission/semantics.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement CommandSemantics**

```typescript
// src/permission/semantics.ts
import { BashArity } from "./arity"

export namespace CommandSemantics {
  export type Category = "read" | "write" | "destructive" | "network" | "system"

  export type Action = "allow" | "deny" | "ask"

  export interface Policy {
    [semantic: string]: Action
  }

  /** Escalation patterns: if command args match these, escalate the category */
  const ESCALATION_PATTERNS: Array<{ flags: string[]; escalateTo: Category }> = [
    { flags: ["--force", "-f", "--hard"], escalateTo: "destructive" },
  ]

  /** Command classification rules, keyed by command prefix. Longest match wins. */
  const RULES: Array<{ prefix: string; category: Category; escalateFlags?: string[] }> = [
    // Read
    { prefix: "cat", category: "read" },
    { prefix: "head", category: "read" },
    { prefix: "tail", category: "read" },
    { prefix: "less", category: "read" },
    { prefix: "more", category: "read" },
    { prefix: "grep", category: "read" },
    { prefix: "rg", category: "read" },
    { prefix: "find", category: "read" },
    { prefix: "ls", category: "read" },
    { prefix: "pwd", category: "read" },
    { prefix: "which", category: "read" },
    { prefix: "wc", category: "read" },
    { prefix: "echo", category: "read" },
    { prefix: "env", category: "read" },
    { prefix: "printenv", category: "read" },
    { prefix: "date", category: "read" },
    { prefix: "uname", category: "read" },
    { prefix: "whoami", category: "read" },
    { prefix: "id", category: "read" },
    { prefix: "file", category: "read" },
    { prefix: "stat", category: "read" },
    { prefix: "du", category: "read" },
    { prefix: "df", category: "read" },
    { prefix: "top", category: "read" },
    { prefix: "ps", category: "read" },
    { prefix: "lsof", category: "read" },
    { prefix: "git status", category: "read" },
    { prefix: "git log", category: "read" },
    { prefix: "git diff", category: "read" },
    { prefix: "git show", category: "read" },
    { prefix: "git branch", category: "read" },
    { prefix: "git stash", category: "read" },
    { prefix: "git remote -v", category: "read" },
    { prefix: "git tag", category: "read" },
    { prefix: "git config --list", category: "read" },
    { prefix: "npm list", category: "read" },
    { prefix: "npm view", category: "read" },
    { prefix: "npm ls", category: "read" },
    { prefix: "bun pm ls", category: "read" },
    { prefix: "docker ps", category: "read" },
    { prefix: "docker images", category: "read" },
    { prefix: "docker logs", category: "read" },
    { prefix: "kubectl get", category: "read" },
    { prefix: "kubectl describe", category: "read" },
    { prefix: "kubectl logs", category: "read" },

    // Write
    { prefix: "touch", category: "write" },
    { prefix: "mkdir", category: "write" },
    { prefix: "cp", category: "write" },
    { prefix: "mv", category: "write" },
    { prefix: "tee", category: "write" },
    { prefix: "write", category: "write" },
    { prefix: "git add", category: "write" },
    { prefix: "git commit", category: "write" },
    { prefix: "git checkout", category: "write" },
    { prefix: "git switch", category: "write" },
    { prefix: "git merge", category: "write" },
    { prefix: "git rebase", category: "write" },
    { prefix: "git cherry-pick", category: "write" },
    { prefix: "git stash", category: "write" },
    { prefix: "git push", category: "write", escalateFlags: ["--force", "-f"] },
    { prefix: "git tag", category: "write" },
    { prefix: "npm install", category: "write" },
    { prefix: "npm uninstall", category: "write" },
    { prefix: "npm run", category: "write" },
    { prefix: "bun add", category: "write" },
    { prefix: "bun install", category: "write" },
    { prefix: "bun remove", category: "write" },
    { prefix: "cargo add", category: "write" },
    { prefix: "cargo build", category: "write" },
    { prefix: "pnpm add", category: "write" },
    { prefix: "pnpm install", category: "write" },
    { prefix: "yarn add", category: "write" },
    { prefix: "yarn install", category: "write" },
    { prefix: "pip install", category: "write" },
    { prefix: "docker build", category: "write" },
    { prefix: "docker run", category: "write" },
    { prefix: "kubectl apply", category: "write" },
    { prefix: "kubectl create", category: "write" },
    { prefix: "make", category: "write" },

    // Destructive
    { prefix: "rm", category: "destructive" },
    { prefix: "rmdir", category: "destructive" },
    { prefix: "shred", category: "destructive" },
    { prefix: "truncate", category: "destructive" },
    { prefix: "DROP", category: "destructive" },
    { prefix: "DELETE", category: "destructive" },
    { prefix: "git reset --hard", category: "destructive" },
    { prefix: "git clean", category: "destructive" },
    { prefix: "git push --force", category: "destructive" },
    { prefix: "git branch -D", category: "destructive" },
    { prefix: "docker rm", category: "destructive" },
    { prefix: "docker rmi", category: "destructive" },
    { prefix: "docker system prune", category: "destructive" },
    { prefix: "kubectl delete", category: "destructive" },
    { prefix: "kill -9", category: "destructive" },
    { prefix: "killall -9", category: "destructive" },
    { prefix: "pkill -9", category: "destructive" },
    { prefix: "sudo rm", category: "destructive" },
    { prefix: "dd", category: "destructive" },
    { prefix: "mkfs", category: "destructive" },
    { prefix: "fdisk", category: "destructive" },

    // Network
    { prefix: "curl", category: "network" },
    { prefix: "wget", category: "network" },
    { prefix: "ssh", category: "network" },
    { prefix: "scp", category: "network" },
    { prefix: "rsync", category: "network" },
    { prefix: "nc", category: "network" },
    { prefix: "netcat", category: "network" },
    { prefix: "ping", category: "network" },
    { prefix: "traceroute", category: "network" },
    { prefix: "dig", category: "network" },
    { prefix: "nslookup", category: "network" },
    { prefix: "host", category: "network" },
    { prefix: "npm publish", category: "network" },
    { prefix: "docker pull", category: "network" },
    { prefix: "docker push", category: "network" },
    { prefix: "git fetch", category: "network" },
    { prefix: "git pull", category: "network" },
    { prefix: "git clone", category: "network" },
    { prefix: "gh", category: "network" },

    // System
    { prefix: "sudo", category: "system" },
    { prefix: "chown", category: "system" },
    { prefix: "chmod", category: "system" },
    { prefix: "chgrp", category: "system" },
    { prefix: "systemctl", category: "system" },
    { prefix: "service", category: "system" },
    { prefix: "mount", category: "system" },
    { prefix: "umount", category: "system" },
    { prefix: "iptables", category: "system" },
    { prefix: "ufw", category: "system" },
    { prefix: "crontab", category: "system" },
    { prefix: "useradd", category: "system" },
    { prefix: "userdel", category: "system" },
    { prefix: "groupadd", category: "system" },
  ]

  /** Sort rules by prefix length descending for longest-match-first */
  const SORTED_RULES = [...RULES].sort((a, b) => b.prefix.length - a.prefix.length)

  function argsString(args: string[]): string {
    return args.join(" ")
  }

  export function classify(tokens: string[]): Category {
    if (tokens.length === 0) return "write"

    const fullCmd = argsString(tokens)
    const cmdLower = fullCmd.toLowerCase()

    // Check escalation patterns first (for commands that have escalateFlags)
    for (const rule of SORTED_RULES) {
      if (rule.escalateFlags) {
        const hasEscalation = rule.escalateFlags.some((f) => cmdLower.includes(f.toLowerCase()))
        if (cmdLower.startsWith(rule.prefix.toLowerCase()) && hasEscalation) {
          return rule.escalateTo
        }
      }
    }

    // Longest prefix match
    for (const rule of SORTED_RULES) {
      if (cmdLower.startsWith(rule.prefix.toLowerCase())) {
        return rule.category
      }
    }

    // Default: unknown commands are "write" (safe default — requires permission)
    return "write"
  }

  export function classifyCommand(command: string): Category {
    // Simple tokenization (splits on whitespace, preserves quoted strings roughly)
    const tokens = command.trim().split(/\s+/)
    return classify(tokens)
  }

  /** Build a default policy: read=allow, everything else=ask */
  export function defaultPolicy(): Policy {
    return {
      read: "allow",
      write: "ask",
      destructive: "ask",
      network: "ask",
      system: "ask",
    }
  }

  /** Policy for plan agent: read=allow, write/desc/system=deny, network=ask */
  export function planAgentPolicy(): Policy {
    return {
      read: "allow",
      write: "deny",
      destructive: "deny",
      network: "ask",
      system: "deny",
    }
  }

  /** Policy for explore agent: read=allow, network=allow, write=ask, desc=deny, system=deny */
  export function exploreAgentPolicy(): Policy {
    return {
      read: "allow",
      write: "ask",
      destructive: "deny",
      network: "allow",
      system: "deny",
    }
  }

  /**
   * Get the permission action for a command given a policy.
   * Checks for command-specific overrides in the policy before falling back to category defaults.
   */
  export function getPermissionAction(category: Category, policy: Policy, tokens?: string[]): Action {
    // Check for command-specific overrides
    if (tokens && tokens.length > 0) {
      const cmdPrefix = BashArity.prefix(tokens).join(" ")
      const override = policy[cmdPrefix]
      if (override) return override
    }
    return policy[category] ?? "ask"
  }

  /** Get a human-readable label and color for a category */
  export function label(category: Category): { text: string; emoji: string } {
    switch (category) {
      case "read":
        return { text: "READ", emoji: "📖" }
      case "write":
        return { text: "WRITE", emoji: "✏️" }
      case "destructive":
        return { text: "DESTRUCTIVE", emoji: "💥" }
      case "network":
        return { text: "NETWORK", emoji: "🌐" }
      case "system":
        return { text: "SYSTEM", emoji: "⚙️" }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/permission/semantics.test.ts`
Expected: All 11 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/permission/semantics.ts packages/opencode/test/permission/semantics.test.ts
git commit -m "feat: add CommandSemantics classifier for bash command categorization"
```

---

### Task 2: Integrate with the permission system

**Files:**

- Modify: `packages/opencode/src/tool/bash.ts`
- Modify: `packages/opencode/src/permission/next.ts`

- [ ] **Step 1: Add semantics check to bash tool**

In `packages/opencode/src/tool/bash.ts`, after parsing the command with tree-sitter and before calling `ctx.ask()`, add a semantics classification:

```typescript
import { CommandSemantics } from "../permission/semantics"

// After command parsing, before permission request:
const tokens = command.trim().split(/\s+/)
const semantics = CommandSemantics.classify(tokens)
const { text: semLabel, emoji: semEmoji } = CommandSemantics.label(semantics)

// Include semantics in the permission request metadata:
await ctx.ask({
  permission: "bash",
  patterns: [BashArity.prefix(tokens).join(" ")],
  always: [...existingAlwaysPatterns],
  metadata: {
    semantics: semantics,
    semanticsLabel: `${semEmoji} ${semLabel}`,
  },
})
```

- [ ] **Step 2: Auto-approve read-only commands when policy allows**

Add a check before the permission request: if the semantics classify as "read" and the agent's policy maps "read" to "allow", skip the permission request entirely.

```typescript
const policy = CommandSemantics.defaultPolicy() // or agent-specific policy
const action = CommandSemantics.getPermissionAction(semantics, policy, tokens)
if (action === "allow") {
  // Execute without asking
} else if (action === "deny") {
  throw new Error(`Command denied by ${semEmoji} ${semLabel} policy`)
} else {
  // Ask user
}
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: integrate CommandSemantics into bash permission flow"
```

---

### Task 3: Update agent permission configs

**Files:**

- Modify: `packages/opencode/src/agent/agent.ts`

- [ ] **Step 1: Add semantic policies to agents**

In `packages/opencode/src/agent/agent.ts`, update the agent definitions to include semantic policies:

For the **plan** agent, apply `CommandSemantics.planAgentPolicy()` — denies write, destructive, and system commands.

For the **explore** agent, apply `CommandSemantics.exploreAgentPolicy()` — allows read and network, asks for write, denies destructive and system.

For the **build** agent, use `CommandSemantics.defaultPolicy()` — allows read, asks for everything else (current behavior preserved).

- [ ] **Step 2: Test with different agents**

1. Start opencode, switch to plan agent
2. Try `rm -rf test` → should be denied
3. Try `cat file.txt` → should be auto-approved
4. Switch to build agent
5. Try `rm -rf test` → should ask (current behavior)

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: apply semantic policies to plan and explore agents"
```

---

### Task 4: Show semantics in TUI permission prompt

**Files:**

- Modify: `packages/opencode/src/cli/cmd/tui/routes/session/permission.tsx`

- [ ] **Step 1: Display semantic badge in permission UI**

In the TUI permission component, read the `metadata.semanticsLabel` from the permission request and display it as a color-coded badge:

- READ → green badge
- WRITE → yellow badge
- DESTRUCTIVE → red badge (with warning)
- NETWORK → blue badge
- SYSTEM → purple badge

Example:

```
Permission Request
────────────────────────────────────────────────
📖 READ    git status

Allow? [y/n/always]
```

- [ ] **Step 2: Test visually**

Start opencode, run a bash command, verify the semantic badge appears in the permission prompt.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: display command semantics badge in TUI permission prompt"
```

---

### Task 5: Run typecheck and full tests

- [ ] **Step 1: Run typecheck**

Run: `cd packages/opencode && bun run typecheck`
Expected: No type errors

- [ ] **Step 2: Run full test suite**

Run: `cd packages/opencode && bun test`
Expected: All tests pass, no regressions
