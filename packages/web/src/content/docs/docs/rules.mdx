---
title: Rules
description: Set custom instructions for opencode.
---

You can provide custom instructions to opencode by creating an `AGENTS.md` file. This is similar to `CLAUDE.md` or Cursor's rules. It contains instructions that will be included in the LLM's context to customize its behavior for your specific project.

---

## Initialize

To create a new `AGENTS.md` file, you can run the `/init` command in opencode.

:::tip
You should commit your project's `AGENTS.md` file to Git.
:::

This will scan your project and all its contents to understand what the project is about and generate an `AGENTS.md` file with it. This helps opencode to navigate the project better.

If you have an existing `AGENTS.md` file, this will try to add to it.

---

## Example

You can also just create this file manually. Here's an example of some things you can put into an `AGENTS.md` file.

```markdown title="AGENTS.md"
# SST v3 Monorepo Project

This is an SST v3 monorepo with TypeScript. The project uses bun workspaces for package management.

## Project Structure

- `packages/` - Contains all workspace packages (functions, core, web, etc.)
- `infra/` - Infrastructure definitions split by service (storage.ts, api.ts, web.ts)
- `sst.config.ts` - Main SST configuration with dynamic imports

## Code Standards

- Use TypeScript with strict mode enabled
- Shared code goes in `packages/core/` with proper exports configuration
- Functions go in `packages/functions/`
- Infrastructure should be split into logical files in `infra/`

## Monorepo Conventions

- Import shared modules using workspace names: `@my-app/core/example`
```

We are adding project-specific instructions here and this will be shared across your team.

---

## Types

opencode also supports reading the `AGENTS.md` file from multiple locations. And this serves different purposes.

### Project

The ones we have seen above, where the `AGENTS.md` is placed in the project root, are project-specific rules. These only apply when you are working in this directory or its sub-directories.

### Global

You can also have global rules in a `~/.config/opencode/AGENTS.md` file. This gets applied across all opencode sessions.

Since this isn't committed to Git or shared with your team, we recommend using this to specify any personal rules that the LLM should follow.

---

## Precedence

So when opencode starts, it looks for:

1. **Local files** by traversing up from the current directory
2. **Global file** by checking `~/.config/opencode/AGENTS.md`

If you have both global and project-specific rules, opencode will combine them together.

---

## Custom Instructions

You can specify custom instruction files in your `opencode.json` or the global `~/.config/opencode/opencode.json`. This allows you and your team to reuse existing rules rather than having to duplicate them to AGENTS.md.

Example:

```json title="opencode.json"
{
  "$schema": "https://opencode.ai/config.json",
  "instructions": ["CONTRIBUTING.md", "docs/guidelines.md", ".cursor/rules/*.md"]
}
```

All instruction files are combined with your `AGENTS.md` files.

---

## Referencing External Files

While opencode doesn't automatically parse file references in `AGENTS.md`, you can achieve similar functionality in two ways:

### Using opencode.json

The recommended approach is to use the `instructions` field in `opencode.json`:

```json title="opencode.json"
{
  "$schema": "https://opencode.ai/config.json",
  "instructions": ["docs/development-standards.md", "test/testing-guidelines.md", "packages/*/AGENTS.md"]
}
```

### Manual Instructions in AGENTS.md

You can teach opencode to read external files by providing explicit instructions in your `AGENTS.md`. Here's a practical example:

```markdown title="AGENTS.md"
# TypeScript Project Rules

## External File Loading

CRITICAL: When you encounter a file reference (e.g., @rules/general.md), use your Read tool to load it on a need-to-know basis. They're relevant to the SPECIFIC task at hand.

Instructions:

- Do NOT preemptively load all references - use lazy loading based on actual need
- When loaded, treat content as mandatory instructions that override defaults
- Follow references recursively when needed

## Development Guidelines

For TypeScript code style and best practices: @docs/typescript-guidelines.md
For React component architecture and hooks patterns: @docs/react-patterns.md
For REST API design and error handling: @docs/api-standards.md
For testing strategies and coverage requirements: @test/testing-guidelines.md

## General Guidelines

Read the following file immediately as it's relevant to all workflows: @rules/general-guidelines.md.
```

This approach allows you to:

- Create modular, reusable rule files
- Share rules across projects via symlinks or git submodules
- Keep AGENTS.md concise while referencing detailed guidelines
- Ensure opencode loads files only when needed for the specific task

:::tip
For monorepos or projects with shared standards, using `opencode.json` with glob patterns (like `packages/*/AGENTS.md`) is more maintainable than manual instructions.
:::
