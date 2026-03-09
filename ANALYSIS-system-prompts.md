# OpenCode System Prompt Analysis

## Overview

OpenCode uses **entirely different system prompts** depending on which model is selected. This is not minor tweaks — the prompts have fundamentally different philosophies, tones, and behavioral instructions.

## Routing Logic

The core routing is in `packages/opencode/src/session/system.ts:19-27`:

```typescript
export function provider(model: Provider.Model) {
  if (model.api.id.includes("gpt-5"))     return [PROMPT_CODEX]      // codex_header.txt
  if (model.api.id.includes("gpt-") ||
      model.api.id.includes("o1") ||
      model.api.id.includes("o3"))         return [PROMPT_BEAST]      // beast.txt
  if (model.api.id.includes("gemini-"))    return [PROMPT_GEMINI]     // gemini.txt
  if (model.api.id.includes("claude"))     return [PROMPT_ANTHROPIC]  // anthropic.txt
  if (model.api.id.toLowerCase().includes("trinity")) return [PROMPT_TRINITY] // trinity.txt
  return [PROMPT_ANTHROPIC_WITHOUT_TODO]                              // qwen.txt (fallback)
}
```

## 6 Distinct System Prompts

| Prompt File | Models | Size | Key Personality Traits |
|---|---|---|---|
| `anthropic.txt` | Claude | 8 KB | Task management heavy (TodoWrite emphasis), balanced autonomy, professional objectivity |
| `beast.txt` | GPT-4, O1, O3 | 11 KB | Hyper-autonomous "agent mode", insists on internet research, memory file system, never yields to user until done |
| `gemini.txt` | Gemini | 15 KB | Extremely concise (< 4 lines), no comments ever, security-paranoid (refuses malware code), one-tool-per-message |
| `codex_header.txt` | GPT-5 | 7 KB | Frontend design focus, collaborative tone, no questions asked, detailed formatting rules |
| `trinity.txt` | Trinity | 8 KB | Similar to Gemini prompt (concise, < 4 lines), parallel tool calls allowed, security-paranoid |
| `qwen.txt` | Everything else (fallback) | 10 KB | Similar to Gemini but even more constrained — one tool per message, sequential only |

## Major Differences

### 1. Autonomy Level
- **beast.txt (GPT-4/O1/O3):** Maximally autonomous. Literally says "You MUST iterate and keep going until the problem is solved", "You have everything you need... solve this autonomously", and "THE PROBLEM CAN NOT BE SOLVED WITHOUT EXTENSIVE INTERNET RESEARCH" (all caps in original).
- **anthropic.txt (Claude):** Moderate autonomy with structured task planning via TodoWrite.
- **gemini.txt / qwen.txt:** Conservative — prioritize user control, explain before acting.

### 2. Tool Parallelism
- **anthropic.txt / trinity.txt / codex_header.txt:** Parallel tool calls encouraged.
- **qwen.txt (fallback):** "Use exactly one tool per assistant message. After each tool call, wait for the result before continuing."
- **gemini.txt:** Parallel allowed but more cautious.

### 3. Verbosity
- **beast.txt:** Chatty, friendly-casual ("Whelp - I see we have some problems. Let's fix those up.").
- **gemini.txt / qwen.txt / trinity.txt:** Extremely terse — "MUST answer concisely with fewer than 4 lines", one-word answers preferred.
- **anthropic.txt:** Concise but not aggressively minimal.
- **codex_header.txt:** Collaborative, structured summaries for substantial work.

### 4. Internet Research
- **beast.txt:** Demands constant web research. Tells the model "Your knowledge on everything is out of date" and requires recursive URL fetching.
- **All others:** No such emphasis; web fetching is just a normal tool.

### 5. Task Management
- **anthropic.txt:** Heavy TodoWrite tool usage with detailed examples of tracking progress.
- **beast.txt:** Uses markdown todo lists with emoji checkboxes (not the TodoWrite tool).
- **Others:** No special task management emphasis.

### 6. Memory System
- **beast.txt:** Has a persistent memory file at `.github/instructions/memory.instruction.md`.
- **Others:** No memory file system.

### 7. Security Posture
- **gemini.txt / trinity.txt:** Explicit malware refusal instructions — "Refuse to write code or explain code that may be used maliciously" and "think about what the code you're editing is supposed to do based on filenames".
- **Others:** Standard security best practices only.

## System Prompt Assembly

Beyond the model-specific prompt, every request also gets:

1. **Environment info** (`system.ts:29-53`) — working directory, platform, date, model ID
2. **Project instructions** — `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md` files found in the project
3. **Plugin transforms** — plugins can modify the system prompt via `experimental.chat.system.transform`
4. **Agent overrides** — sub-agents (explore, compaction, title, summary) replace the provider prompt entirely with their own

## Special Case: GitHub Copilot (OAuth OpenAI)

When OpenAI is used with OAuth auth (GitHub Copilot), the provider prompt is **not** included in the system messages at all. Instead, `PROMPT_CODEX` is sent via `options.instructions` (a Codex-specific API field). See `llm.ts:65,110-112`.

## Conclusion

OpenCode maintains radically different prompting strategies per model family. This reflects genuine behavioral tuning:
- GPT-4/O models get an aggressive, autonomous agent persona
- Claude gets structured task management
- Gemini/Qwen get an ultra-concise, cautious persona
- GPT-5/Codex gets a polished collaborative persona
- The fallback (qwen.txt) is the most constrained, restricting models to sequential single-tool usage — likely because less-tested models need tighter guardrails
