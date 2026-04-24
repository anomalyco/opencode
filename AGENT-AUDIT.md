# Agent Architecture Audit

A diagnostic guide for auditing the health of any agent system — including those built on OpenCode.

**The base model rarely fails. The wrapper architecture corrupts good answers into bad behavior.**

This document helps OpenCode developers, plugin authors, and agent builders find where their agent stack is sabotaging itself — before shipping or when behavior degrades.

## When to Use

- You built an agent on top of OpenCode and it's behaving unexpectedly
- Tool calls are flaky — sometimes work, sometimes skipped
- Memory leaks old conversation context into new turns
- The agent sounds confident but is confidently wrong
- Output differs between internal generation and user delivery
- You added new prompts, tools, or memory layers and existing behavior degraded
- You want a pre-release health check for your agent application

## The 12-Layer Stack

Every agent system — including those built on OpenCode — has these layers. Any of them can corrupt the answer:

| # | Layer | What Goes Wrong |
|---|-------|----------------|
| 1 | System prompt | Conflicting instructions, instruction bloat |
| 2 | Session history | Stale context from previous turns |
| 3 | Long-term memory | Pollution across sessions |
| 4 | Distillation | Compressed artifacts re-entering as pseudo-facts |
| 5 | Active recall | Redundant re-summary layers wasting context |
| 6 | Tool selection | Wrong tool routing, model skips required tools |
| 7 | Tool execution | Hallucinated execution — claims to call but doesn't |
| 8 | Tool interpretation | Misread or ignored tool output |
| 9 | Answer shaping | Format corruption in final response |
| 10 | Platform rendering | TUI/Web/Desktop mutates valid answers |
| 11 | Hidden repair loops | Silent fallback/retry agents running second LLM pass |
| 12 | Persistence | Expired state or cached artifacts reused as live evidence |

## Quick Diagnostic

Run these grep commands against your agent codebase to find anti-patterns:

```bash
# Tool requirements in prompt only (not enforced in code)
rg "must.*tool|required.*call|必须.*工具" --type md --type ts

# Tool execution without validation
rg "tool_call|toolCall|tool_use" --type ts

# Hidden LLM calls outside the main agent loop
rg "completion|chat\.create|messages\.create" --type ts

# Memory admission without user-correction priority
rg "memory.*admit|long.*term.*update|persist.*memory" --type ts

# Fallback loops that run additional LLM calls
rg "fallback|retry.*llm|repair.*prompt" --type ts

# Silent output mutation
rg "mutate|rewrite.*response|transform.*output" --type ts
```

## Common Failure Patterns

### Wrapper Regression

The base model works fine via `opencode serve` API, but your wrapper agent breaks it.

**Check:**
- Does your plugin add prompt layers that conflict with OpenCode's built-in system prompts?
- Do tool definitions in your plugin overlap with OpenCode's native tools?

### Memory Contamination

Old conversation topics appear in new turns.

**Check:**
- Is `session.json` or memory files accumulating without cleanup?
- Are you reusing `project_id` across unrelated conversations?

### Tool Discipline Failure

The model declares it will use a tool but never actually calls it.

**Check:**
- Does your agent code validate that required tool calls were actually executed?
- Or is "must use tool X" only in the prompt text with no code enforcement?

### Rendering Corruption

The agent's internal answer is correct, but the TUI or web delivery mutates it.

**Check:**
- Does the answer in `session.json` differ from what the user sees in the TUI?
- Do any hooks or plugins transform the response before delivery?

## Fix Strategy

Default fix order — code-first, not prompt-first:

1. **Code-gate tool requirements** — enforce in your plugin code, not just in prompt text
2. **Remove hidden repair agents** — make fallback explicit with contracts
3. **Reduce context duplication** — same info should not be in prompt + history + memory
4. **Tighten memory admission** — user corrections should outweigh agent assertions
5. **Reduce rendering mutation** — pass through, don't transform

## Report Template

When auditing an agent system, produce a structured report:

```json
{
  "target_name": "your-agent-name",
  "symptoms": ["what the user reports"],
  "findings": [
    {
      "severity": "critical|high|medium|low",
      "title": "what went wrong",
      "source_layer": "which of the 12 layers",
      "mechanism": "how it happens",
      "root_cause": "deepest cause",
      "evidence_refs": ["file:line"],
      "recommended_fix": "what to change"
    }
  ],
  "ordered_fix_plan": [
    { "order": 1, "goal": "first thing to fix", "why_now": "why this comes first" }
  ]
}
```

## Severity Model

| Level | Meaning |
|-------|---------|
| `critical` | Agent produces confidently wrong operational behavior |
| `high` | Frequently degrades correctness or stability |
| `medium` | Correctness survives but output is fragile or wasteful |
| `low` | Cosmetic or maintainability issues |

## Related

- [OpenCode Documentation](https://opencode.ai/docs)
- [OpenCode Plugin System](./packages/plugin/)
- [Contributing Guide](./CONTRIBUTING.md)
