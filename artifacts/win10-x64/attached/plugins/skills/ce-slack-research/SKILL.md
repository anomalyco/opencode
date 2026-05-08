---
name: ce-slack-research
description: "Search Slack for interpreted organizational context -- decisions, constraints, and discussion arcs that shape the current task. Produces a research digest with cross-cutting analysis and research-value assessment, not raw message lists. Use when searching Slack for context during planning, brainstorming, or any task where organizational knowledge matters. Trigger phrases: 'search slack for', 'what did we discuss about', 'slack context for', 'organizational context about', 'what does the team think about', 'any slack discussions on'. Differs from slack:find-discussions which returns individual message results without synthesis."
---

# /ce-slack-research

Search Slack for organizational context and receive an interpreted research digest.

## Usage

```
/ce-slack-research [topic or question]
/ce-slack-research
```

## Examples

```
/ce-slack-research free trial
/ce-slack-research What did we say about free trial recently?
/ce-slack-research free trial in #proj-reverse-trial
/ce-slack-research onboarding flow after:2026-03-01
```

The input can be a keyword, a natural language question, or include Slack search modifiers like channel hints (`in:#channel`) and date filters (`after:YYYY-MM-DD`). The agent extracts the topic and formulates searches from whatever form the input takes.

## Execution

If no argument is provided, ask what topic to research. Use the platform's blocking question tool: `AskUserQuestion` in Claude Code (call `ToolSearch` with `select:AskUserQuestion` first if its schema isn't loaded), `request_user_input` in Codex, `ask_user` in Gemini, `ask_user` in Pi (requires the `pi-ask-user` extension). Fall back to asking in plain text only when no blocking tool exists in the harness or the call errors (e.g., Codex edit modes) — not because a schema load is required. Never silently skip the question.

Dispatch `ce-slack-researcher` with the user's topic as the task prompt. Omit the `mode` parameter so the user's configured permission settings apply.

The agent handles everything from here -- Slack MCP discovery, search execution, thread reads, and synthesis. It returns a digest with:

- **Workspace identifier** so the user can verify the correct Slack instance was searched
- **Research-value assessment** (high / moderate / low / none) with justification
- **Findings organized by topic** with source channels and dates
- **Cross-cutting analysis** surfacing patterns across findings

If the agent reports that Slack is unavailable (MCP not connected or auth expired), relay the message to the user. Do not attempt alternative research methods.
