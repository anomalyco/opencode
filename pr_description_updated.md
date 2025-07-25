## feat: Add custom slash commands support

### Summary

• Adds support for user-defined custom slash commands stored as markdown files
• Commands support dynamic argument interpolation with validation
• Implements automatic command discovery with scope-based priority

### Overview

This PR implements a custom slash commands feature that allows users to define their own commands as markdown files in `.opencode/commands/` directories. Commands are treated as prompts that can include argument placeholders which are validated and interpolated before submission.

### Key Features

1. **Command Discovery & Loading**
   • Automatically discovers commands from:
   • Project-specific: `<project>/.opencode/commands/`
   • User-global: `~/.opencode/commands/`
   • Supports namespaced commands via directory structure (e.g., `git/commit.md` → `/git:commit`)
   • Commands are prefixed with scope (`user:` or `project:`) to prevent conflicts
   • Project commands take priority over user commands with the same name
   • Hot-reloads commands when files change

2. **Argument Handling**
   • Argument placeholders: `$ARGUMENTS` or `{{args}}` in command content
   • Automatic argument count validation based on placeholder occurrences
   • Commands with placeholders are inserted into input field for user to add arguments
   • Commands without placeholders are submitted immediately
   • Clear error messages when wrong number of arguments provided

3. **Content Resolution**
   • File references: `@{path/to/file.ts}` injects file contents (relative to command file)
   • Arguments are interpolated individually into their respective placeholders
   • File content is truncated to 1MB to prevent memory issues

4. **Integration**
   • Server endpoints: `/command`, `/command/:name`, `/command/resolve`
   • TUI autocomplete support with descriptions and argument hints
   • Commands appear in slash command menu with proper categorization
   • Seamless execution as regular prompts to the AI

### Implementation Details

**Server-side (TypeScript):**
• `packages/opencode/src/command/` - Core command module
• `types.ts` - Type definitions and schemas
• `loader.ts` - Command discovery and file watching
• `resolver.ts` - Argument validation and content resolution
• `index.ts` - Public API with App.state integration

**TUI-side (Go):**
• `internal/components/chat/editor.go` - Command selection and submission logic
• Added validation to prevent submission with unresolved placeholders
• Custom commands populate input field when arguments are needed

### Example Commands

**Simple command without arguments:**

```markdown
---
description: Explain the current code
---

Please explain what this code does and how it works.
```

**Command with arguments:**

```markdown
---
description: Create a function with specified parameters
argument-hint: "<name> <params> <return-type>"
---

Create a function named $ARGUMENTS that takes parameters $ARGUMENTS and returns $ARGUMENTS.
Include proper error handling and documentation.
```

### Testing

• Unit tests for argument validation and interpolation
• Tests for command loading with scope priority
• Tests for file reference resolution
• All resolver tests passing (8/8)

### Breaking Changes

None - this is a new feature that doesn't affect existing functionality.
