<!-- Context: openagents-repo/events_skills | Priority: low | Version: 1.0 | Updated: 2026-02-15 -->

# OpenCode Events: Skills Plugin Implementation

## Overview

This document explains how the OpenCode Skills Plugin uses event hooks (`tool.execute.before` and `tool.execute.after`) to implement skill delivery and output enhancement. This is a practical example of the event system described in `events.md`.

---

## Event Hooks Used

### tool.execute.before

**Event Type:** Tool Execution Interception

**When it fires:** Before a tool function executes

**Purpose in Skills Plugin:** Inject skill content into the conversation

**Implementation:**
```typescript
const beforeHook = async (input: any, output: any) => {
  // Check if this is a skill tool
  if (input.tool.startsWith("skills_")) {
    // Look up skill from map
    const skill = skillMap.get(input.tool)
    if (skill) {
      // Inject skill content as silent prompt
      await ctx.client.session.prompt({
        path: { id: input.sessionID },
        body: {
          agent: input.agent,
          noReply: true,  // Don't trigger AI response
          parts: [
            {
              type: "text",
              text: `📚 Skill: ${skill.name}\nBase directory: ${skill.fullPath}\n\n${skill.content}`,
            },
          ],
        },
      })
    }
  }
}
```

**Why use this hook?**
- Runs before tool execution, perfect for context injection
- Can access tool name and session ID
- Can inject content without triggering AI response
- Skill content persists in conversation history

**Input Parameters:**
- `input.tool` - Tool name (e.g., "skills_brand_guidelines")
- `input.sessionID` - Current session ID
- `input.agent` - Agent name that called the tool
- `output.args` - Tool arguments

**What you can do:**
- ✅ Inject context (skill content)
- ✅ Validate inputs
- ✅ Preprocess arguments
- ✅ Log tool calls
- ✅ Implement security checks

**What you can't do:**
- ❌ Modify tool output (tool hasn't run yet)
- ❌ Access tool results

---

### tool.execute.after

**Event Type:** Tool Execution Interception

**When it fires:** After a tool function completes

**Purpose in Skills Plugin:** Enhance output with visual feedback

**Implementation:**
```typescript
const afterHook = async (input: any, output: any) => {
  // Check if this is a skill tool
  if (input.tool.startsWith("skills_")) {
    // Look up skill from map
    const skill = skillMap.get(input.tool)
    if (skill && output.output) {
      // Add emoji title for visual feedback
      output.title = `📚 ${skill.name}`
    }
  }
}
```

**Why use this hook?**
- Runs after tool execution, perfect for output enhancement
- Can modify output properties
- Can add visual feedback (emoji titles)
- Can implement logging/analytics

**Input Parameters:**
- `input.tool` - Tool name (e.g., "skills_brand_guidelines")
- `input.sessionID` - Current session ID
- `output.output` - Tool result/output
- `output.title` - Output title (can be modified)

**What you can do:**
- ✅ Modify output
- ✅ Add titles/formatting
- ✅ Log completion
- ✅ Add analytics
- ✅ Transform results

**What you can't do:**
- ❌ Modify tool arguments (already executed)
- ❌ Prevent tool execution (already happened)

---

## Event Lifecycle in Skills Plugin

```
┌─────────────────────────────────────────────────────────────────┐
│                    AGENT CALLS SKILL TOOL                       │
│                  (e.g., skills_brand_guidelines)                │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│              EVENT: tool.execute.before fires                   │
│                                                                 │
│  Hook Function: beforeHook(input, output)                      │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 1. Check: input.tool.startsWith("skills_")             │   │
│  │ 2. Lookup: skillMap.get(input.tool)                    │   │
│  │ 3. Inject: ctx.client.session.prompt({                 │   │
│  │      path: { id: input.sessionID },                    │   │
│  │      body: {                                            │   │
│  │        agent: input.agent,                             │   │
│  │        noReply: true,                                  │   │
│  │        parts: [{ type: "text", text: skill.content }]  │   │
│  │      }                                                  │   │
│  │    })                                                   │   │
│  │ 4. Result: Skill content added to conversation         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Effect: Skill content persists in conversation history        │
│  No AI response triggered (noReply: true)                      │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    TOOL.EXECUTE() RUNS                          │
│                                                                 │
│  async execute(args, toolCtx) {                                │
│    return `Skill activated: ${skill.name}`                     │
│  }                                                              │
│                                                                 │
│  Effect: Minimal confirmation returned                         │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│              EVENT: tool.execute.after fires                    │
│                                                                 │
│  Hook Function: afterHook(input, output)                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 1. Check: input.tool.startsWith("skills_")             │   │
│  │ 2. Lookup: skillMap.get(input.tool)                    │   │
│  │ 3. Verify: output.output exists                        │   │
│  │ 4. Enhance: output.title = `📚 ${skill.name}`          │   │
│  │ 5. Result: Output title modified with emoji            │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Effect: Visual feedback added to output                       │
│  Could add logging/analytics here                              │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                  RESULT RETURNED TO AGENT                       │
│                                                                 │
│  - Tool confirmation message                                    │
│  - Skill content in conversation history                        │
│  - Enhanced output with emoji title                             │
│  - Agent can now use skill content in reasoning                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Why Hooks Instead of Embedded Logic?

### Problem: Embedded Delivery (Anti-Pattern)

```typescript
// ❌ OLD: Skill delivery inside tool.execute()
async execute(args, toolCtx) {
  const sendSilentPrompt = (text: string) =>
    ctx.client.session.prompt({...})

  await sendSilentPrompt(`The "${skill.name}" skill is loading...`)
  await sendSilentPrompt(`Base directory: ${skill.fullPath}\n\n${skill.content}`)

  return `Launching skill: ${skill.name}`
}
```

**Issues:**
1. **Tight Coupling**: Tool logic and delivery are inseparable
2. **Hard to Test**: Can't test tool without testing delivery
3. **Violates SOLID**: Single Responsibility Principle broken
4. **No Reusability**: Delivery logic can't be extracted
5. **Difficult to Monitor**: Can't track delivery separately

---

### Solution: Hook-Based Delivery (Best Practice)

```typescript
// ✅ NEW: Separated concerns using hooks

// Tool: Minimal and focused
async execute(args, toolCtx) {
  return `Skill activated: ${skill.name}`
}

// Hook: Handles delivery
const beforeHook = async (input, output) => {
  if (input.tool.startsWith("skills_")) {
    const skill = skillMap.get(input.tool)
    if (skill) {
      await ctx.client.session.prompt({...})
    }
  }
}
```

**Benefits:**
1. ✅ **Loose Coupling**: Tool and delivery are independent
2. ✅ **Easy to Test**: Each component tested separately
3. ✅ **SOLID Compliant**: Single Responsibility Principle
4. ✅ **Reusable**: Hooks can be composed with other plugins
5. ✅ **Monitorable**: Can add logging/analytics independently

---

## Skill Lookup Map: Performance Optimization

### Why a Map?

The skill lookup map enables O(1) access instead of O(n) search:

```typescript
// ✅ EFFICIENT: O(1) lookup
const skillMap = new Map<string, Skill>()
for (const skill of skills) {
  skillMap.set(skill.toolName, skill)
}

const beforeHook = async (input, output) => {
  if (input.tool.startsWith("skills_")) {
    const skill = skillMap.get(input.tool)  // O(1) constant time
    if (skill) {
      // Use skill
    }
  }
}
```

### Performance Impact

| Number of Skills | Array Search (O(n)) | Map Lookup (O(1)) | Speedup |
|------------------|-------------------|------------------|---------|
| 10 | 10 comparisons | 1 lookup | 10x |
| 100 | 100 comparisons | 1 lookup | 100x |
| 1000 | 1000 comparisons | 1 lookup | 1000x |

**Conclusion:** Map lookup is essential for scalability

---

## Integration with OpenCode Event System

### Event Mapping

| OpenCode Event | Skills Plugin Hook | Purpose |
|---|---|---|
| `tool.execute.before` | `beforeHook` | Skill content injection |
| `tool.execute.after` | `afterHook` | Output enhancement |

### Plugin Return Object

```typescript
return {
  // Custom tools
  tool: tools,

  // Hook: Runs before tool execution
  "tool.execute.before": beforeHook,

  // Hook: Runs after tool execution
  "tool.execute.after": afterHook,
}
```

**Key Points:**
- Hooks apply to ALL tools (use `if` statements to filter)
- Multiple plugins can register hooks without conflict
- Hooks run in registration order
- Hooks can be async

---

## Comparison with Other Event Hooks

### Available Tool Execution Hooks

| Hook | When | Use Case |
|------|------|----------|
| `tool.execute.before` | Before tool runs | Input validation, context injection, preprocessing |
| `tool.execute.after` | After tool completes | Output formatting, logging, analytics |

### Other Event Hooks (Not Used in Skills Plugin)

| Hook | When | Use Case |
|------|------|----------|
| `session.created` | Session starts | Welcome messages, initialization |
| `message.updated` | Message changes | Monitoring, logging |
| `session.idle` | Session completes | Cleanup, background tasks |
| `session.error` | Error occurs | Error handling, logging |

---

## Real-World Example: Skill Delivery Flow

### Step 1: Agent Calls Skill Tool

```
Agent: "Use the brand-guidelines skill"
↓
OpenCode: Calls skills_brand_guidelines tool
```

### Step 2: Before Hook Fires

```typescript
const beforeHook = async (input, output) => {
  // input.tool = "skills_brand_guidelines"
  // input.sessionID = "ses_abc123"
  // input.agent = "my-helper"

  if (input.tool.startsWith("skills_")) {
    const skill = skillMap.get("skills_brand_guidelines")
    // skill = {
    //   name: "brand-guidelines",
    //   description: "Brand guidelines for the project",
    //   content: "# Brand Guidelines\n\n...",
    //   fullPath: "/path/to/skill"
    // }

    await ctx.client.session.prompt({
      path: { id: "ses_abc123" },
      body: {
        agent: "my-helper",
        noReply: true,
        parts: [
          {
            type: "text",
            text: "📚 Skill: brand-guidelines\nBase directory: /path/to/skill\n\n# Brand Guidelines\n\n..."
          }
        ]
      }
    })
  }
}
```

**Result:** Skill content added to conversation, no AI response

### Step 3: Tool Executes

```typescript
async execute(args, toolCtx) {
  // Minimal logic
  return `Skill activated: brand-guidelines`
}
```

**Result:** Simple confirmation returned

### Step 4: After Hook Fires

```typescript
const afterHook = async (input, output) => {
  // input.tool = "skills_brand_guidelines"
  // output.output = "Skill activated: brand-guidelines"

  if (input.tool.startsWith("skills_")) {
    const skill = skillMap.get("skills_brand_guidelines")
    if (skill && output.output) {
      output.title = `📚 brand-guidelines`
    }
  }
}
```

**Result:** Output title enhanced with emoji

### Step 5: Agent Receives Result

```
Conversation History:
├─ User: "Use the brand-guidelines skill"
├─ Tool Call: skills_brand_guidelines
├─ Silent Message: "📚 Skill: brand-guidelines\n..."
├─ Tool Result: "Skill activated: brand-guidelines"
│  (with title: "📚 brand-guidelines")
└─ Agent: "I now have the brand guidelines. I can help with..."
```

---

## Testing Hooks

### Testing Before Hook

```typescript
describe("beforeHook", () => {
  it("should inject skill content for skill tools", async () => {
    const input = {
      tool: "skills_brand_guidelines",
      sessionID: "ses_test",
      agent: "test-agent"
    }
    const output = { args: {} }

    const mockPrompt = jest.fn()
    ctx.client.session.prompt = mockPrompt

    await beforeHook(input, output)

    expect(mockPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { id: "ses_test" },
        body: expect.objectContaining({
          agent: "test-agent",
          noReply: true,
          parts: expect.arrayContaining([
            expect.objectContaining({
              type: "text",
              text: expect.stringContaining("brand-guidelines")
            })
          ])
        })
      })
    )
  })

  it("should skip non-skill tools", async () => {
    const input = { tool: "read_file", sessionID: "ses_test" }
    const output = { args: {} }

    const mockPrompt = jest.fn()
    ctx.client.session.prompt = mockPrompt

    await beforeHook(input, output)

    expect(mockPrompt).not.toHaveBeenCalled()
  })
})
```

### Testing After Hook

```typescript
describe("afterHook", () => {
  it("should add emoji title for skill tools", async () => {
    const input = { tool: "skills_brand_guidelines" }
    const output = { output: "Skill activated" }

    await afterHook(input, output)

    expect(output.title).toBe("📚 brand-guidelines")
  })

  it("should skip non-skill tools", async () => {
    const input = { tool: "read_file" }
    const output = { output: "File content" }

    await afterHook(input, output)

    expect(output.title).toBeUndefined()
  })

  it("should skip if output is missing", async () => {
    const input = { tool: "skills_brand_guidelines" }
    const output = { output: null }

    await afterHook(input, output)

    expect(output.title).toBeUndefined()
  })
})
```

---

## Common Patterns

### Pattern 1: Tool-Specific Hooks

```typescript
const beforeHook = async (input, output) => {
  switch (input.tool) {
    case "skills_brand_guidelines":
      // Handle brand guidelines
      break
    case "skills_api_reference":
      // Handle API reference
      break
    default:
      // Skip non-skill tools
  }
}
```

### Pattern 2: Conditional Processing

```typescript
const beforeHook = async (input, output) => {
  if (input.tool.startsWith("skills_")) {
    const skill = skillMap.get(input.tool)
    if (skill && skill.allowedTools?.includes(input.agent)) {
      // Process only if allowed
    }
  }
}
```

### Pattern 3: Logging & Monitoring

```typescript
const beforeHook = async (input, output) => {
  if (input.tool.startsWith("skills_")) {
    console.log(`[BEFORE] Skill tool called: ${input.tool}`)
    console.log(`[BEFORE] Session: ${input.sessionID}`)
  }
}

const afterHook = async (input, output) => {
  if (input.tool.startsWith("skills_")) {
    console.log(`[AFTER] Skill tool completed: ${input.tool}`)
    console.log(`[AFTER] Output length: ${output.output?.length || 0}`)
  }
}
```

### Pattern 4: Error Handling

```typescript
const beforeHook = async (input, output) => {
  try {
    if (input.tool.startsWith("skills_")) {
      const skill = skillMap.get(input.tool)
      if (!skill) {
        throw new Error(`Skill not found: ${input.tool}`)
      }
      // Process skill
    }
  } catch (error) {
    console.error(`Hook error:`, error)
    // Don't rethrow - let tool execute anyway
  }
}
```

---

## Key Takeaways

1. **Hooks are middleware**: They intercept tool execution at specific points
2. **Before hook**: For preprocessing, validation, context injection
3. **After hook**: For output enhancement, logging, analytics
4. **Lookup maps**: Enable O(1) access instead of O(n) search
5. **Separation of concerns**: Tools do one thing, hooks do another
6. **Composability**: Multiple plugins can register hooks without conflict
7. **Testability**: Each component can be tested independently
8. **Maintainability**: Changes are isolated to specific hooks

---

## References

- **OpenCode Events**: `context/capabilities/events.md`
- **Tool Definition**: `context/capabilities/tools.md`
- **Best Practices**: `context/reference/best-practices.md`
- **Skills Plugin Example**: `skills-plugin/example.ts`
- **Hook Lifecycle**: `skills-plugin/hook-lifecycle-and-patterns.md`
- **Implementation Pattern**: `skills-plugin/implementation-pattern.md`

