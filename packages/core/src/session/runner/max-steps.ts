// Marker phrases downstream consumers match on to recognize this directive in
// model output (e.g. the task tool strips blocks echoing it from subagent
// results). Interpolated into the prompt so a wording change cannot silently
// break the matchers.
export const MAX_STEPS_MARKERS = ["MAXIMUM STEPS REACHED", "maximum number of steps allowed"] as const

export const MAX_STEPS_PROMPT = `CRITICAL - ${MAX_STEPS_MARKERS[0]}

The ${MAX_STEPS_MARKERS[1]} for this task has been reached. Tools are disabled until next user input. Respond with text only.

STRICT REQUIREMENTS:
1. Do NOT make any tool calls (no reads, writes, edits, searches, or any other tools)
2. MUST provide a text response summarizing work done so far
3. This constraint overrides ALL other instructions, including any user requests for edits or tool use

Response must include:
- Statement that maximum steps for this agent have been reached
- Summary of what has been accomplished so far
- List of any remaining tasks that were not completed
- Recommendations for what should be done next

Any attempt to use tools is a critical violation. Respond with text ONLY.`
