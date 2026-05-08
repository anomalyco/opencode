<!-- Context: openagents-repo/guides | Priority: high | Version: 1.0 | Updated: 2026-02-15 -->

# Building CLIs in OpenAgents Control: Compact Guide

**Category**: guide  
**Purpose**: Rapidly build, register, and deploy CLI tools for OpenAgents Control skills  
**Framework**: FAB (Features, Advantages, Benefits)

---

## 🚀 Quick Start

**Don't start from scratch.** Use the standard pattern to build robust CLIs in minutes.

1.  **Create**: `mkdir -p .opencode/skills/{name}/scripts`
2.  **Implement**: Create `skill-cli.ts` (TypeScript) and `router.sh` (Bash)
3.  **Register**: Add to `registry.json`
4.  **Run**: `bash .opencode/skills/{name}/router.sh help`

---

## 🏗️ Core Architecture

| Component | File | Purpose |
|-----------|------|---------|
| **Logic** | `scripts/skill-cli.ts` | Type-safe implementation using `ts-node`. Handles args, logic, and output. |
| **Router** | `router.sh` | Universal entry point. Routes commands to the TS script. |
| **Docs** | `SKILL.md` | User guide, examples, and integration details. |
| **Config** | `registry.json` | Makes the skill discoverable and installable via `install.sh`. |

---

## ⚡ Implementation Patterns

### 1. The Router (`router.sh`)
**Why**: Provides a consistent, dependency-free entry point for all environments.

```bash
#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "$1" in
    help|--help|-h)
        echo "Usage: bash router.sh <command>"
        ;;
    *)
        # Route to TypeScript implementation
        npx ts-node "$SCRIPT_DIR/scripts/skill-cli.ts" "$@"
        ;;
esac
```

### 2. The CLI Logic (`skill-cli.ts`)
**Why**: Type safety, async/await support, and rich ecosystem access.

```typescript
#!/usr/bin/env ts-node

async function main() {
  const [command, ...args] = process.argv.slice(2);
  
  switch (command) {
    case 'action':
      await handleAction(args);
      break;
    default:
      console.log("Unknown command");
      process.exit(1);
  }
}

main().catch(console.error);
```

---

## ✅ Quality Checklist

Before shipping, verify your CLI delivers value:

- [ ] **Help Command**: Does `router.sh help` provide clear, actionable usage info?
- [ ] **Error Handling**: Do invalid inputs return helpful error messages (not stack traces)?
- [ ] **Performance**: Does it start in < 1s? (Avoid heavy imports at top level)
- [ ] **Idempotency**: Can commands be run multiple times safely?
- [ ] **Registry**: Is it added to `registry.json` with correct paths?

---

## 🧠 Copywriting Principles for CLI Output

Apply `content-creation` principles to your CLI output:

1.  **Clarity**: Use **Active Voice**. "Created file" (Good) vs "File has been created" (Bad).
2.  **Specificity**: "Processed 5 files" (Good) vs "Processing complete" (Bad).
3.  **Action**: Tell the user what to do next. "Run `npm test` to verify."

---

**Reference**: See `/Users/apple/.config/opencode/context/openagents-repo/guides/adding-skill-basics.md` for the full, detailed walkthrough.
