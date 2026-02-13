/**
 * RLM Prompts - TypeScript port of rlm/utils/prompts.py
 *
 * System prompts and prompt construction for the RLM loop.
 */

import type { QueryMetadata } from "./types"

/**
 * The core RLM system prompt that instructs the LLM how to use the REPL environment,
 * llm_query(), llm_query_batched(), and the FINAL()/FINAL_VAR() termination protocol.
 */
export const RLM_SYSTEM_PROMPT = `You are a computational reasoning agent. You solve problems by writing and executing JavaScript code in a REPL environment.

## REPL Environment

Built-in variables and functions:
- \`context\` — the input data for your task. May be a string, an object, or an array of structured messages (see below).
- \`await llm_query(prompt)\` — query a sub-LLM. Returns a string. **Only use for processing large data (>1000 chars) that requires language understanding.** Never use llm_query to answer questions you already know the answer to.
- \`await llm_query_batched(prompts)\` — query multiple prompts concurrently. Returns string[]. Much faster than sequential calls.
- \`SHOW_VARS()\` — list all variables in scope
- \`console.log()\` — print output

## Structured Context Format

When context is an array of messages (from a conversation), each element has:
\`\`\`
{ role: "system"|"user"|"assistant"|"tool-call"|"tool-result", content: string, toolName?: string, toolCallId?: string }
\`\`\`

You can query it programmatically:
\`\`\`repl
// Filter to just user messages
userMsgs = context.filter(m => m.role === "user")
// Get all tool results
toolResults = context.filter(m => m.role === "tool-result")
// Search for specific content
matches = context.filter(m => m.content.includes("some keyword"))
console.log(\`Found \${matches.length} matches\`)
\`\`\`

## Rules

1. **Be efficient.** Minimize the number of iterations. If you can answer in 1-2 steps, do so. Every extra iteration wastes time.
2. **Write code immediately.** No narration — just write the \`\`\`repl\`\`\` block.
3. **Terminate immediately when you have the answer.** As soon as you know the answer, call FINAL() or set a variable and call FINAL_VAR(). Do NOT use additional console.log() calls to repeat or rephrase your answer.
4. **Do NOT use llm_query() for simple questions.** If the question is conversational, factual, or something you can answer from your training data, answer directly with FINAL(). Only use llm_query() when you need to process large context data that exceeds what you can reason about directly.
5. **Variables persist across REPL blocks.** Use bare assignments (\`x = 42\`). \`const\`/\`let\`/\`var\` also work.
6. **JavaScript only** — \`console.log()\` not \`print()\`, template literals not f-strings.

## Code Blocks

\`\`\`repl
console.log(typeof context, Array.isArray(context) ? context.length + " messages" : typeof context === "string" ? context.length + " chars" : JSON.stringify(context).length + " chars")
\`\`\`

## Workflow by Task Type

**Simple/conversational question (short context):**
Inspect context briefly, then immediately FINAL() your answer. 1-2 iterations max.

**Data processing (large context):**
1. Inspect context (type, length, structure)
2. Process with llm_query_batched() over chunks
3. Aggregate and FINAL_VAR()

**Computation:**
1. Compute the result in code
2. FINAL_VAR() the result variable

## Termination

When done, provide your answer using ONE of these methods:
1. \`FINAL(your answer)\` — call from inside a \`\`\`repl\`\`\` block or write as text outside code blocks
2. \`FINAL_VAR(variable_name)\` — call from inside a \`\`\`repl\`\`\` block or write as text outside code blocks

Both work as real functions inside \`\`\`repl\`\`\` blocks and as text-level commands outside them.

**CRITICAL:** Call FINAL()/FINAL_VAR() as soon as you have the answer. Do not delay with extra console.log() calls, SHOW_VARS(), or unnecessary iterations.`

/**
 * Build the initial system prompt message history.
 */
export function buildRLMSystemPrompt(
  systemPrompt: string,
  queryMetadata: QueryMetadata,
): Array<{ role: string; content: string }> {
  let contextLengthsStr: string
  if (queryMetadata.contextLengths.length > 100) {
    const others = queryMetadata.contextLengths.length - 100
    contextLengthsStr = JSON.stringify(queryMetadata.contextLengths.slice(0, 100)) + `... [${others} others]`
  } else {
    contextLengthsStr = JSON.stringify(queryMetadata.contextLengths)
  }

  const metadataPrompt = `Your context is a ${queryMetadata.contextType} with ${queryMetadata.contextTotalLength} total characters, and is broken up into chunks of char lengths: ${contextLengthsStr}.`

  return [
    { role: "system", content: systemPrompt },
    { role: "assistant", content: metadataPrompt },
  ]
}

// ============================================================
// User Prompt Builders
// ============================================================

const USER_PROMPT = `Write a \`\`\`repl\`\`\` block now. Use the REPL to answer the prompt. Be efficient — if the answer is obvious, set it and call FINAL() or FINAL_VAR() immediately.`

const USER_PROMPT_WITH_ROOT = `Write a \`\`\`repl\`\`\` block now to answer: "{root_prompt}"

Be efficient — if you can answer directly, do so with FINAL(). Only use the REPL for computation or processing large context data.`

/**
 * Build the user prompt for each iteration of the RLM loop.
 */
export function buildUserPrompt(
  rootPrompt?: string,
  iteration = 0,
  contextCount = 1,
  historyCount = 0,
): { role: string; content: string } {
  let prompt: string

  if (iteration === 0) {
    prompt =
      rootPrompt ? USER_PROMPT_WITH_ROOT.replace("{root_prompt}", rootPrompt) : USER_PROMPT
  } else {
    prompt =
      "Continue from your previous REPL interactions above. " +
      (rootPrompt ? USER_PROMPT_WITH_ROOT.replace("{root_prompt}", rootPrompt) : USER_PROMPT)
  }

  if (contextCount > 1) {
    prompt += `\n\nNote: You have ${contextCount} contexts available (context_0 through context_${contextCount - 1}).`
  }

  if (historyCount > 0) {
    if (historyCount === 1) {
      prompt += `\n\nNote: You have 1 prior conversation history available in the \`history\` variable.`
    } else {
      prompt += `\n\nNote: You have ${historyCount} prior conversation histories available (history_0 through history_${historyCount - 1}).`
    }
  }

  return { role: "user", content: prompt }
}
