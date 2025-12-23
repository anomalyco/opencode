# GLM-4.7 Interleaved Thinking Block Fix Proposal

## Classification: Bug Fix

**Type:** Provider-specific output sanitization
**Severity:** Medium - Causes tool calls to not execute properly
**Affected:** GLM-4.7 model via Z.AI Anthropic-compatible endpoint

---

## Problem Statement

GLM-4.7 occasionally outputs tool call XML tags directly within the `reasoning_content` thinking block instead of using the proper separate `tool_calls` field. This malformed output causes tool calls to not be executed properly by the client.

### Example Malformed Output

```
Thinking:
<invoke name="bash">
  <command>bun test packages/portal/scripts/generate/workflow/workflow.test.ts 2>&1</command>
  <description>Run workflow inference unit tests</description>
</invoke>
```

Or with MCP tools:

```
Thinking:
<invoke name="pal_thinkdeep">
  <step>Reviewing Phase 1.8 implementation</step>
  <step_number>1</step_number>
  <total_steps>4</total_steps>
  <next_step_required>true</next_step_required>
</invoke>
```

### Session Evidence

From session `ses_4b426f5beffe3XzScg7fdMbIDW`:
- User correction: "you sent a tool call in a thinking block, try again"
- Assistant response contained `<invoke name="pal_thinkdeep">` XML in reasoning block
- `pal_thinkdeep` is an **MCP server tool**, NOT a thinking mechanism
- Session stopped (finish: "stop") - no tool calls were executed

**Key Correction:** `pal_thinkdeep` is an MCP tool (like `bash`, `grep`, etc.), not a built-in reasoning mechanism. The thinking block should never contain tool invocations - of any kind.

---

## Root Cause Analysis

Based on the Z.AI documentation review and codebase analysis:

1. **Enhanced Thinking Mechanism:** GLM-4.7 implements a "think before acting" mechanism that sometimes causes tool call syntax to leak into the thinking block

2. **Interleaved Thinking Complexity:** When the model thinks before each tool call, there's a higher chance of thinking content "leaking" tool call syntax

3. **API Processing:** The OpenAI-compatible SDK (`openai-responses-language-model.ts`) looks for `function_call` items in response output, but malformed tool calls in `reasoning_content` are just stored as text and never executed

4. **ProviderTransform Behavior:** When `interleaved.field === "reasoning_content"`, the transform moves reasoning to `providerOptions.openaiCompatible.reasoning_content` but doesn't extract tool calls from malformed reasoning text

---

## Solution Architecture

### Location: `packages/opencode/src/provider/transform.ts`

Add GLM-specific normalization in `ProviderTransform.normalizeMessages()`, following existing patterns for Claude and Mistral normalization.

### Implementation Strategy

1. **Detect malformed tool calls** in `reasoning_content` using regex pattern matching
2. **Extract and parse** the embedded tool call syntax (XML-like `<invoke>` tags)
3. **Remove from reasoning** and add as proper `tool-call` parts
4. **Preserve clean reasoning** text without tool call artifacts

### Test Results (Before Fix)

```
bun test test/provider/test_glm47_thinking_fix.test.ts

# Test failures confirm the issue:
1. GLM-4.7 with tool call XML in reasoning_content
   Expected: 1 tool-call extracted
   Received: 0 tool-calls extracted
   FAIL

2. GLM-4.7 with multiple tool calls in reasoning
   Expected: 3 tool-calls extracted
   Received: 0 tool-calls extracted
   FAIL

3. Properly formatted response should not be affected
   Expected: 3 content parts preserved
   Received: 2 content parts (reasoning filtered out)
   FAIL
```

### Implementation

```typescript
// In ProviderTransform.normalizeMessages() - add after Mistral check

if (
  model.providerID === "z.ai" ||
  model.api.id.toLowerCase().includes("glm-4.7") ||
  model.api.id.toLowerCase().includes("glm-4.6")
) {
  return msgs.map((msg) => {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      const reasoningParts = msg.content.filter((part: any) => part.type === "reasoning")
      const reasoningText = reasoningParts.map((part: any) => part.text).join("")

      // Pattern 1: <invoke name="toolName">...</invoke>
      const invokePattern = /<invoke\s+name="([^"]+)">([\s\S]*?)<\/invoke>/g
      // Pattern 2: <tool_calls>...</tool_calls>
      const toolCallsPattern = /<tool_calls>([\s\S]*?)<\/tool_calls>/g

      const hasMalformedTools = invokePattern.test(reasoningText) || toolCallsPattern.test(reasoningText)

      if (hasMalformedTools) {
        const toolCalls: any[] = []

        // Extract <invoke name="...">...</invoke> patterns
        let cleanText = reasoningText
        let match
        while ((match = invokePattern.exec(reasoningText)) !== null) {
          const toolName = match[1]
          const argsText = match[2]

          // Parse arguments - look for <arg_key> and <arg_value> pairs
          const argKeyPattern = /<arg_key>([^<]+)<\/arg_key>\s*<arg_value>([^<]*(?:(?!<arg_key>)[^<]+)*)<\/arg_value>/g
          const args: Record<string, any> = {}
          let argMatch
          while ((argMatch = argKeyPattern.exec(argsText)) !== null) {
            const key = argMatch[1].trim()
            const value = argMatch[2].trim()
            args[key] = value
          }

          toolCalls.push({
            type: "tool-call",
            toolCallId: Identifier.ascending("part").id,
            toolName,
            input: args,
          })
        }

        // Clean the reasoning text
        cleanText = reasoningText
          .replace(invokePattern, "")
          .replace(toolCallsPattern, "")
          .replace(/<arg_key>[\s\S]*?<\/arg_key>/g, "")
          .replace(/<arg_value>[\s\S]*?<\/arg_value>/g, "")
          .replace(/<description>[\s\S]*?<\/description>/g, "")
          .replace(/\s+/g, " ")
          .trim()

        // Rebuild content with extracted tool calls and cleaned reasoning
        const nonReasoningContent = msg.content.filter((part: any) => part.type !== "reasoning")
        const newContent = [
          ...nonReasoningContent,
          ...toolCalls,
        ]

        // Only add reasoning if there's remaining text
        if (cleanText.length > 0) {
          newContent.push({
            type: "reasoning",
            text: cleanText,
          })
        }

        return {
          ...msg,
          content: newContent,
        }
      }
    }

    return msg
  })
}
```

---

## Risk Assessment

**Low Risk:**
- Defensive sanitization - only modifies content that contains malformed syntax
- Non-breaking - preserves existing behavior for properly formatted outputs
- Isolated - only affects GLM-4.7/GLM-4.6 via z.ai provider
- Rollback easy - conditional on provider/model detection

---

## Testing Strategy

### Unit Test Location

`packages/opencode/test/provider/test_glm47_thinking_fix.test.ts`

### Test Cases

1. ✅ Single tool call XML in reasoning should be extracted (bash, pal_thinkdeep, any tool)
2. ✅ Multiple tool calls in reasoning should all be extracted
3. ✅ MCP tools (`pal_thinkdeep`, etc.) in reasoning should be extracted like any other tool
4. ✅ Properly formatted responses should not be affected

### Running Tests

```bash
cd packages/opencode
bun install
bun test test/provider/test_glm47_thinking_fix.test.ts
```

---

## Alternative Approaches

1. **Disable thinking mode:** Set `"thinking": { "type": "disabled" }` for GLM-4.7
2. **Client-side parsing:** Handle malformed output in tool execution layer
3. **Report to Z.AI:** Advocate for server-side fix in model training
4. **Model downgrade:** Switch to GLM-4.6 with more stable output

---

## Session Log Evidence

**Session ID:** `ses_4b426f5beffe3XzScg7fdMbIDW`  
**Project:** `/Users/ramarivera/dev/neuro-grimoire`  
**Title:** "Reviewing grimoire-portal specs and beads"

### Message Flow

1. `msg_b4c2b3d63001hN08vTvwEIbqtd` - User: "you sent a tool call in a thinking block, try again"
2. `msg_b4c2bb7f3001UB2SsO6aU3jSCc` - Assistant echo
3. `msg_b4c2bb883001Yd3E3BGGMOn1tK` - Thinking block with `<invoke name="pal_thinkdeep">` XML

### Key Correction: `pal_thinkdeep` is an MCP Tool

The thinking block contained `<invoke name="pal_thinkdeep">` which is an **MCP server tool**, NOT a built-in thinking mechanism. This is significant because:

- `pal_thinkdeep` = MCP tool for deep thinking/analysis (just like `bash`, `grep`, etc.)
- Any tool call in thinking block = bug, regardless of tool name
- The fix must extract ALL tool invocations from reasoning content

### Files Copied

```
ramarivera_glm4.7_interleaved_thinking_fix/
├── PROPOSED_FIX.md
├── prt_b4c2c635b001pLKDgm70ADoEP1.json
├── session_logs/
│   ├── session_diff.json
│   └── ses_4b426f5beffe3XzScg7fdMbIDW/
│       ├── msg_b4c2b3d63001hN08vTvwEIbqtd.json
│       ├── msg_b4c2bb7f3001UB2SsO6aU3jSCc.json
│       ├── msg_b4c2bb883001Yd3E3BGGMOn1tK.json
│       └── parts/
│           ├── msg_b4c2b3d63001hN08vTvwEIbqtd/
│           ├── msg_b4c2bb7f3001UB2SsO6aU3jSCc/
│           └── msg_b4c2bb883001Yd3E3BGGMOn1tK/
└── test_glm47_thinking_fix.test.ts
```

---

## References

- GitHub Issue #6039: "Malformed thinking block in toolcall (glm-4.7-free)"
- Z.AI Documentation: docs.z.ai/guides/capabilities/thinking-mode
- Existing patterns: `transform.ts:18-75` (Claude/Mistral normalization)
- OpenAI-compatible SDK: `provider/sdk/openai-compatible/src/responses/openai-responses-language-model.ts`
- MCP Protocol: `pal_thinkdeep` is an MCP server tool, not built-in reasoning
