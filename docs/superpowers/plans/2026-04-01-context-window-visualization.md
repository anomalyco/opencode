# Context Window Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/ctx-viz` command that shows a breakdown of what's consuming the context window — system prompts, messages, tool definitions — with token estimates and color-coded percentages.

**Architecture:** A new `ContextViz` namespace that assembles the same data the LLM receives, estimates tokens for each category using the existing `Token.estimate()`, and renders a formatted breakdown. Exposed as a CLI command (`opencode ctx-viz`) and available as a tool for agents.

**Tech Stack:** TypeScript, existing `Token.estimate()`, `SystemPrompt`, `MessageV2`, yargs CLI

---

### Task 1: Create the ContextViz data module

**Files:**

- Create: `packages/opencode/src/session/ctx-viz.ts`
- Test: `packages/opencode/test/session/ctx-viz.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/session/ctx-viz.test.ts
import { test, expect } from "bun:test"
import { ContextViz } from "../../src/session/ctx-viz"

test("estimateSystemPromptTokens returns 0 for empty input", () => {
  const result = ContextViz.estimateSystemPromptTokens({ header: "", provider: "", environment: "", custom: [] })
  expect(result.tokens).toBe(0)
  expect(result.breakdown).toEqual([])
})

test("estimateSystemPromptTokens estimates token counts for each section", () => {
  const result = ContextViz.estimateSystemPromptTokens({
    header: "You are Claude, made by Anthropic.",
    provider: "You are a helpful assistant.",
    environment: "Working directory: /tmp/test\nPlatform: linux",
    custom: ["Instructions from: AGENTS.md\nFollow these rules."],
  })
  expect(result.tokens).toBeGreaterThan(0)
  expect(result.breakdown.length).toBe(4)
  expect(result.breakdown[0].label).toBe("Provider Header")
  expect(result.breakdown[1].label).toBe("System Prompt")
  expect(result.breakdown[2].label).toBe("Environment")
  expect(result.breakdown[3].label).toBe("Custom Rules")
  // Each breakdown item should have tokens > 0
  for (const item of result.breakdown) {
    expect(item.tokens).toBeGreaterThan(0)
  }
  // Sum of breakdown tokens should equal total
  const breakdownSum = result.breakdown.reduce((sum, item) => sum + item.tokens, 0)
  expect(breakdownSum).toBe(result.tokens)
})

test("estimateMessagesTokens classifies user and assistant messages", () => {
  const messages = [
    { role: "user" as const, content: "Hello, please help me with my code", tokens: 0 },
    { role: "assistant" as const, content: "I'd be happy to help!", tokens: 0 },
    { role: "user" as const, content: "Great, let me show you the file", tokens: 0 },
  ]
  const result = ContextViz.estimateMessagesTokens(messages)
  expect(result.userTokens).toBeGreaterThan(0)
  expect(result.assistantTokens).toBeGreaterThan(0)
  expect(result.totalTokens).toBe(result.userTokens + result.assistantTokens)
  expect(result.messageCount).toBe(3)
})

test("estimateToolDefinitionsTokens returns 0 for no tools", () => {
  const result = ContextViz.estimateToolDefinitionsTokens([])
  expect(result.tokens).toBe(0)
  expect(result.count).toBe(0)
})

test("estimateToolDefinitionsTokens estimates based on tool schemas", () => {
  const tools = [
    {
      name: "bash",
      description: "Execute bash commands",
      schema: JSON.stringify({ type: "object", properties: { command: { type: "string" } } }),
    },
    {
      name: "read",
      description: "Read file contents",
      schema: JSON.stringify({ type: "object", properties: { filePath: { type: "string" } } }),
    },
  ]
  const result = ContextViz.estimateToolDefinitionsTokens(tools)
  expect(result.tokens).toBeGreaterThan(0)
  expect(result.count).toBe(2)
})

test("buildReport assembles full context breakdown", () => {
  const report = ContextViz.buildReport({
    systemPromptTokens: 500,
    userMessageTokens: 200,
    assistantMessageTokens: 300,
    toolDefinitionTokens: 800,
    contextLimit: 200000,
    modelID: "claude-sonnet-4-20250514",
  })
  expect(report.totalTokens).toBe(1800)
  expect(report.contextLimit).toBe(200000)
  expect(report.usagePercent).toBeCloseTo(0.9, 1)
  expect(report.segments.length).toBe(4)
  expect(report.segments[0].percent).toBeCloseTo(27.8, 0) // 500/1800
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/session/ctx-viz.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the ContextViz module**

```typescript
// src/session/ctx-viz.ts
import { Token } from "../util/token"

export namespace ContextViz {
  export interface SystemPromptInput {
    header: string
    provider: string
    environment: string
    custom: string[]
  }

  export interface BreakdownItem {
    label: string
    tokens: number
  }

  export interface SystemPromptEstimate {
    tokens: number
    breakdown: BreakdownItem[]
  }

  export interface MessagesEstimate {
    userTokens: number
    assistantTokens: number
    totalTokens: number
    messageCount: number
  }

  export interface ToolDefInput {
    name: string
    description: string
    schema: string
  }

  export interface ToolDefinitionsEstimate {
    tokens: number
    count: number
  }

  export interface ReportInput {
    systemPromptTokens: number
    userMessageTokens: number
    assistantMessageTokens: number
    toolDefinitionTokens: number
    contextLimit: number
    modelID: string
  }

  export interface ReportSegment {
    label: string
    tokens: number
    percent: number
  }

  export interface Report {
    modelID: string
    contextLimit: number
    totalTokens: number
    usagePercent: number
    segments: ReportSegment[]
    generatedAt: number
  }

  export function estimateSystemPromptTokens(input: SystemPromptInput): SystemPromptEstimate {
    const breakdown: BreakdownItem[] = [
      { label: "Provider Header", tokens: Token.estimate(input.header) },
      { label: "System Prompt", tokens: Token.estimate(input.provider) },
      { label: "Environment", tokens: Token.estimate(input.environment) },
      { label: "Custom Rules", tokens: input.custom.reduce((sum, rule) => sum + Token.estimate(rule), 0) },
    ]
    return {
      tokens: breakdown.reduce((sum, item) => sum + item.tokens, 0),
      breakdown,
    }
  }

  export function estimateMessagesTokens(
    messages: Array<{ role: "user" | "assistant"; content: string }>,
  ): MessagesEstimate {
    let userTokens = 0
    let assistantTokens = 0
    for (const msg of messages) {
      const tokens = Token.estimate(msg.content)
      if (msg.role === "user") userTokens += tokens
      else assistantTokens += tokens
    }
    return {
      userTokens,
      assistantTokens,
      totalTokens: userTokens + assistantTokens,
      messageCount: messages.length,
    }
  }

  export function estimateToolDefinitionsTokens(tools: ToolDefInput[]): ToolDefinitionsEstimate {
    let tokens = 0
    for (const tool of tools) {
      tokens += Token.estimate(tool.name) + Token.estimate(tool.description) + Token.estimate(tool.schema)
    }
    return { tokens, count: tools.length }
  }

  export function buildReport(input: ReportInput): Report {
    const totalTokens =
      input.systemPromptTokens + input.userMessageTokens + input.assistantMessageTokens + input.toolDefinitionTokens
    const usagePercent = input.contextLimit > 0 ? (totalTokens / input.contextLimit) * 100 : 0

    const segments: ReportSegment[] = [
      { label: "System Prompt", tokens: input.systemPromptTokens, percent: 0 },
      { label: "User Messages", tokens: input.userMessageTokens, percent: 0 },
      { label: "Assistant Messages", tokens: input.assistantMessageTokens, percent: 0 },
      { label: "Tool Definitions", tokens: input.toolDefinitionTokens, percent: 0 },
    ]

    for (const seg of segments) {
      seg.percent = totalTokens > 0 ? (seg.tokens / totalTokens) * 100 : 0
    }

    return {
      modelID: input.modelID,
      contextLimit: input.contextLimit,
      totalTokens,
      usagePercent,
      segments,
      generatedAt: Date.now(),
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/session/ctx-viz.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/session/ctx-viz.ts packages/opencode/test/session/ctx-viz.test.ts
git commit -m "feat: add ContextViz data module for context window breakdown"
```

---

### Task 2: Add the CLI command

**Files:**

- Create: `packages/opencode/src/cli/cmd/ctx-viz.ts`

- [ ] **Step 1: Create the CLI command**

Follow the pattern from `packages/opencode/src/cli/cmd/stats.ts` and `packages/opencode/src/cli/cmd/cmd.ts`.

```typescript
// src/cli/cmd/ctx-viz.ts
import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { Session } from "../../session"
import { ContextViz } from "../../session/ctx-viz"
import { SystemPrompt } from "../../session/system"
import { SessionPrompt } from "../../session/prompt"
import { Instance } from "../../project/instance"
import { Config } from "../../config/config"
import { MessageV2 } from "../../session/message-v2"

export const CtxVizCommand = cmd({
  command: "ctx-viz",
  describe: "visualize context window usage breakdown",
  builder: (yargs: Argv) => {
    return yargs
      .option("session", {
        alias: "s",
        describe: "session ID (default: latest)",
        type: "string",
      })
      .option("json", {
        describe: "output as JSON",
        type: "boolean",
        default: false,
      })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      // Get session
      let sessionID = args.session
      if (!sessionID) {
        const sessions: Instance.Session.Info[] = []
        for await (const s of Session.list()) {
          if (!s.parentID) sessions.push(s)
        }
        sessions.sort((a, b) => b.time.updated - a.time.updated)
        if (sessions.length === 0) {
          console.log("No sessions found.")
          return
        }
        sessionID = sessions[0].id
      }

      const session = await Session.get(sessionID)
      if (!session) {
        console.log(`Session ${sessionID} not found.`)
        return
      }

      // Gather system prompt data
      const cfg = await Config.get()
      const model = cfg.model ? cfg.model.default : undefined

      const header = SystemPrompt.header(model?.providerID ?? "")
      const providerPrompt = model ? SystemPrompt.provider(model) : [""]
      const envInfo = await SystemPrompt.environment()
      const customRules = await SystemPrompt.custom()

      const systemEstimate = ContextViz.estimateSystemPromptTokens({
        header: header.join("\n"),
        provider: providerPrompt.join("\n"),
        environment: envInfo.join("\n"),
        custom: customRules,
      })

      // Gather message data
      const messages = await Session.messages({ sessionID })
      const userContents: string[] = []
      const assistantContents: string[] = []
      for (const msg of messages) {
        if (msg.info.role === "user") {
          for (const part of msg.parts) {
            if (part.type === "text") userContents.push(part.text ?? "")
          }
        } else if (msg.info.role === "assistant") {
          for (const part of msg.parts) {
            if (part.type === "text") assistantContents.push(part.text ?? "")
          }
        }
      }

      const messagesEstimate = ContextViz.estimateMessagesTokens([
        ...userContents.map((c) => ({ role: "user" as const, content: c })),
        ...assistantContents.map((c) => ({ role: "assistant" as const, content: c })),
      ])

      // Tool definitions estimate (use token count from last assistant message if available)
      const toolDefTokens = messagesEstimate.totalTokens > 0 ? Math.round(messagesEstimate.totalTokens * 0.15) : 0

      // Context limit
      const contextLimit = 200000 // Default; in production, read from model config

      const report = ContextViz.buildReport({
        systemPromptTokens: systemEstimate.tokens,
        userMessageTokens: messagesEstimate.userTokens,
        assistantMessageTokens: messagesEstimate.assistantTokens,
        toolDefinitionTokens: toolDefTokens,
        contextLimit,
        modelID: model?.modelID ?? "unknown",
      })

      if (args.json) {
        console.log(JSON.stringify(report, null, 2))
        return
      }

      // Render formatted output
      displayReport(report, systemEstimate)
    })
  },
})

function formatTokens(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M"
  if (n >= 1000) return (n / 1000).toFixed(1) + "K"
  return n.toString()
}

function usageColor(percent: number): string {
  if (percent < 50) return "\x1B[32m" // green
  if (percent < 80) return "\x1B[33m" // yellow
  return "\x1B[31m" // red
}

function resetColor(): string {
  return "\x1B[0m"
}

function bar(percent: number, width: number = 30): string {
  const filled = Math.round((percent / 100) * width)
  return "█".repeat(filled) + "░".repeat(width - filled)
}

function displayReport(report: ContextViz.Report, systemEstimate: ContextViz.SystemPromptEstimate) {
  const W = 56

  function row(label: string, value: string): string {
    const pad = Math.max(0, W - 1 - label.length - value.length)
    return `│${label}${" ".repeat(pad)}${value} │`
  }

  console.log("┌" + "─".repeat(W) + "┐")
  console.log("│" + "CONTEXT WINDOW USAGE".padEnd(W) + "│")
  console.log("├" + "─".repeat(W) + "┤")
  console.log(row("Model", report.modelID))
  console.log(row("Total Tokens", formatTokens(report.totalTokens)))
  console.log(row("Context Limit", formatTokens(report.contextLimit)))
  const color = usageColor(report.usagePercent)
  console.log(row("Usage", `${color}${report.usagePercent.toFixed(1)}%${resetColor()} ${bar(report.usagePercent)}`))
  console.log("├" + "─".repeat(W) + "┤")

  // System prompt breakdown
  console.log("│ System Prompt Breakdown:".padEnd(W + 1) + "│")
  for (const item of systemEstimate.breakdown) {
    const pct = report.totalTokens > 0 ? ((item.tokens / report.totalTokens) * 100).toFixed(1) : "0.0"
    console.log(row(`  ${item.label}`, `${formatTokens(item.tokens)} (${pct}%)`))
  }
  console.log("├" + "─".repeat(W) + "┤")

  // Other segments
  for (const seg of report.segments) {
    if (seg.label === "System Prompt") continue
    console.log(row(seg.label, `${formatTokens(seg.tokens)} (${seg.percent.toFixed(1)}%)`))
  }

  console.log("└" + "─".repeat(W) + "┘")
}
```

- [ ] **Step 2: Register the command in the CLI**

Find where commands are registered (likely `packages/opencode/src/cli/index.ts` or similar). Import and add `CtxVizCommand` to the yargs command list. Look at how `StatsCommand` is registered.

- [ ] **Step 3: Test the command manually**

Run: `bun run --conditions=browser ./src/index.ts ctx-viz`
Expected: Formatted table showing context window breakdown

- [ ] **Step 4: Commit**

```bash
git add packages/opencode/src/cli/cmd/ctx-viz.ts
git commit -m "feat: add ctx-viz CLI command for context window visualization"
```

---

### Task 3: Add a tool for agent access

**Files:**

- Modify: `packages/opencode/src/tool/registry.ts` (or wherever tools are registered)

- [ ] **Step 1: Add the ctx_viz tool definition**

Add a new tool entry following the pattern of existing tools like `Tool.define()` in the tool registry. The tool should:

- Name: `ctx_viz`
- Description: "Visualize context window usage breakdown"
- Parameters: `sessionID?` (optional, defaults to current)
- Execute: calls `ContextViz.buildReport()` and returns formatted string

- [ ] **Step 2: Test via agent invocation**

Run: start opencode TUI, type `/ctx-viz` and verify the tool is available and returns a breakdown.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: add ctx_viz tool for agent-accessible context visualization"
```

---

### Task 4: Read actual tool definitions from the session

**Files:**

- Modify: `packages/opencode/src/cli/cmd/ctx-viz.ts`
- Modify: `packages/opencode/src/session/ctx-viz.ts`

- [ ] **Step 1: Improve tool definition estimation**

Instead of using a percentage heuristic, read the actual active tool definitions from the session's resolved tools. Look at how `SessionPrompt.resolveTools()` works in `packages/opencode/src/session/prompt.ts` and use the same tool list to compute token estimates from the tool descriptions and schemas.

- [ ] **Step 2: Read actual model context limit**

Instead of hardcoding 200000, read the context limit from the model config. Look at how `SessionCompaction.isOverflow()` in `packages/opencode/src/session/compaction.ts` accesses `model.limit.context`.

- [ ] **Step 3: Test with a real session**

Run: `bun run --conditions=browser ./src/index.ts ctx-viz`
Expected: Accurate token counts with real model limits

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: improve ctx-viz with real tool defs and model limits"
```

---

### Task 5: Add typecheck and final validation

- [ ] **Step 1: Run typecheck**

Run: `cd packages/opencode && bun run typecheck`
Expected: No type errors

- [ ] **Step 2: Run full test suite**

Run: `cd packages/opencode && bun test`
Expected: All tests pass, no regressions
