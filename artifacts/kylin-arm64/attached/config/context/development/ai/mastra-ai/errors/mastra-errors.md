<!-- Context: development/mastra-errors | Priority: medium | Version: 1.0 | Updated: 2026-02-15 -->

# Errors: Mastra Implementation

**Purpose**: Common errors, their causes, and recovery strategies.

**Last Updated**: 2026-01-09

---

## Core Idea
Errors in Mastra typically fall into three categories: AI generation failures, structured output validation errors, and context/resource missing errors.

## Key Points
- **AIGenerationError**: Occurs when the LLM fails to generate a response (e.g., safety filters, model downtime).
- **StructuredOutputError**: Triggered when the LLM response doesn't match the Zod schema defined in the tool or step.
- **RateLimitError**: Hit when exceeding provider limits. Includes a `retryAfter` value.
- **MastraContextError**: Raised when a required resource (like `services` or `mastra` instance) is missing from the execution context.
- **Retry Strategy**: Use `isRetryableError(error)` to determine if a transient failure can be recovered with exponential backoff.

## Common Errors Table

| Error | Cause | Fix |
|-------|-------|-----|
| `StructuredOutputError` | LLM hallucinated wrong JSON | Refine prompt or use simpler schema |
| `RateLimitError` | Too many concurrent requests | Implement rate limiting or increase quota |
| `NotFoundError` | Case or Document ID missing in DB | Check DB state before workflow start |
| `MastraContextError` | `services` not passed to tool | Ensure `services` is in `ToolExecutionContext` |

**Reference**: `src/lib/errors.ts`
**Related**:
- concepts/core.md
- guides/testing.md
