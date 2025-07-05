---
description: Review current git diff from an architect's perspective
allowed-tools: Bash(git diff), Bash(git diff --cached), Bash(git status --short), Read, Grep, Glob
---

Analyze the current git diff (both staged and unstaged changes) from a senior architect's perspective.

## Review Checklist

### 1. Code Quality & Simplicity
- Is the code unnecessarily complex? Could it be simplified?
- Are variable/function names clear and self-documenting?
- Is the logic flow easy to follow?
- Any code duplication that should be extracted?

### 2. Architecture & Design
- Do changes align with the project's overall architecture?
- Are design patterns used appropriately?
- Is there proper separation of concerns?
- Are dependencies minimal and well-managed?

### 3. File Organization
- Check if any files exceed 200 lines and need splitting
- Are methods/functions kept under 30 lines?
- Is related functionality properly grouped?
- Should any code be moved to different modules?

### 4. Standards & Best Practices
- Would the code pass linting (TypeScript: strict mode, Go: go fmt/vet)?
- Is formatting consistent with project standards?
- Are there missing type annotations or error handling?
- Any obvious security concerns or performance issues?

### 5. Maintainability
- Is the code easy for a junior developer to understand?
- Are there any TODOs, FIXMEs, or hacks that need addressing?
- Would this code be easy to test?
- Are edge cases handled appropriately?

### 6. Project-Specific Guidelines
Consider CLAUDE.md guidelines:
- Clean, simple, short methods
- Files should not exceed 200 lines
- Code should be understandable by junior developers
- Visual aids (ASCII diagrams) for complex concepts where helpful

## Review Process
1. First, check git status to understand scope of changes
2. Review unstaged changes (git diff)
3. Review staged changes (git diff --cached)
4. For each changed file, evaluate against the checklist
5. Provide specific, actionable feedback with file:line references
6. Suggest concrete improvements or refactoring if needed
7. If files are getting large, recommend specific splits

Arguments: $ARGUMENTS