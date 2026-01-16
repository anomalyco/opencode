/**
 * Orchestration Module
 *
 * Provides enhanced orchestration capabilities for OpenCode:
 * - Ralph Loop: Continuous execution until completion marker
 * - Background Agents: Async task delegation
 * - Complexity Detection: Automatic orchestration strategy selection
 *
 * Ported from Claude Code orchestration integration (2026-01-16)
 * Based on analysis of opencode architecture and our requirements.
 */

export { RalphLoop } from "./ralph-loop"
export { BackgroundAgent } from "./background"
export { Complexity } from "./complexity"
export { OrchestrationEvents } from "./events"

import { RalphLoop } from "./ralph-loop"
import { BackgroundAgent } from "./background"
import { Complexity } from "./complexity"
import { Log } from "../util/log"

const log = Log.create({ service: "orchestration" })

/**
 * Orchestration capabilities that can be injected into prompts
 */
export function getOrchestrationCapabilities(): string {
  return `
## Available Orchestration Capabilities

You have access to enhanced orchestration patterns. Use them when appropriate:

### 1. Background Agents
For tasks that can run asynchronously while you continue other work.
Available agent types: oracle (research), librarian (docs), explore (codebase), research, analyze, implement

### 2. Continuous Execution (Ralph Loop)
For tasks that MUST complete fully. Include \`<promise>DONE</promise>\` when truly complete.
The system will re-prompt you if you stop without the completion marker.

### 3. Parallel Agent Pattern
When you have independent subtasks, launch multiple Task agents in a SINGLE message.
- Identify independent subtasks
- Use Task tool multiple times in one response
- Aggregate results

### 4. Todo Enforcement
If you create todos with TodoWrite, you'll be prompted to complete them if you try to stop with pending items.

**When to use these:**
- Complex multi-file changes → Consider parallel agents
- Research that takes time → Spawn background oracle
- Must-complete tasks → Activate Ralph Loop
- Documentation tasks → Spawn librarian

Use your judgment - these are tools, not requirements.
`
}

/**
 * Research-specific capabilities
 */
export function getResearchCapabilities(): string {
  return `
### Research-Specific Tools

For this research task, consider:
1. **Spawn Oracle**: Background agent for deep research
2. **Use Explore agent**: Task tool for codebase investigation
3. **Web search**: For external documentation/context

Take time for thorough investigation before conclusions.
`
}

/**
 * Check if orchestration awareness should be injected based on prompt complexity
 */
export function shouldInjectAwareness(prompt: string): {
  inject: boolean
  capabilities: string
  complexity: Complexity.Level
} {
  const result = Complexity.estimate(prompt)

  if (result.level === "complex" || result.level === "research") {
    let capabilities = getOrchestrationCapabilities()

    if (result.level === "research") {
      capabilities += getResearchCapabilities()
    }

    return {
      inject: true,
      capabilities,
      complexity: result.level,
    }
  }

  return {
    inject: false,
    capabilities: "",
    complexity: result.level,
  }
}

/**
 * Process orchestration hooks on session stop
 */
export async function processStopHooks(transcriptSummary: string): Promise<{
  continuePrompt?: string
  completedTasks?: BackgroundAgent.Task[]
}> {
  const result: {
    continuePrompt?: string
    completedTasks?: BackgroundAgent.Task[]
  } = {}

  // Check Ralph Loop continuation
  const ralphResult = await RalphLoop.checkContinuation(transcriptSummary)
  if (ralphResult.shouldContinue && ralphResult.prompt) {
    result.continuePrompt = ralphResult.prompt
    return result
  }

  // Check for completed background tasks
  const completedTasks = await BackgroundAgent.getCompletedTasks()
  if (completedTasks.length > 0) {
    result.completedTasks = completedTasks

    // Mark them as reported
    for (const task of completedTasks) {
      await BackgroundAgent.markReported(task.id)
    }
  }

  return result
}

/**
 * Initialize orchestration module
 */
export async function initialize(): Promise<void> {
  log.info("Orchestration module initialized")
}
