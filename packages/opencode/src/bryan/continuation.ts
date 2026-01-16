/**
 * Continuation Processing
 *
 * Handles automatic continuation checking and processing on session start.
 * Integrates with the dialectic system to spawn background agents for
 * answered questions.
 *
 * Ported from: sisyphean-works/bootstrap/tools/continue.py
 */

import { Dialectic } from "./dialectic"
import { BackgroundAgent } from "../orchestration/background"
import { Bus } from "../bus"
import { Log } from "../util/log"
import { BryanEvents } from "./events"

const log = Log.create({ service: "bryan-continuation" })

export namespace Continuation {
  /**
   * Result of continuation check
   */
  export interface CheckResult {
    hasContinuations: boolean
    continuations: Dialectic.Continuation[]
    prompt?: string
  }

  /**
   * Map groups to agent types
   */
  const GROUP_TO_AGENT: Record<Dialectic.Group, BackgroundAgent.AgentType> = {
    "philosophical-union": "analyze",
    "groundwork-guild": "implement",
    "integration-assembly": "research",
  }

  /**
   * Check for pending continuations on session start
   *
   * This should be called at the beginning of each session to process
   * any answers Bryan provided while the system was idle.
   */
  export async function checkOnStart(): Promise<CheckResult> {
    // First, check for any newly answered questions
    await Dialectic.checkAnswers()

    // Get pending continuations
    const continuations = await Dialectic.getPendingContinuations()

    if (continuations.length === 0) {
      return {
        hasContinuations: false,
        continuations: [],
      }
    }

    log.info("Found pending continuations", { count: continuations.length })

    // Build combined prompt for session awareness
    const prompt = buildSessionPrompt(continuations)

    return {
      hasContinuations: true,
      continuations,
      prompt,
    }
  }

  /**
   * Build a session prompt that informs about pending continuations
   */
  function buildSessionPrompt(continuations: Dialectic.Continuation[]): string {
    const groupedByGroup = new Map<Dialectic.Group, Dialectic.Continuation[]>()

    for (const cont of continuations) {
      const existing = groupedByGroup.get(cont.group) ?? []
      existing.push(cont)
      groupedByGroup.set(cont.group, existing)
    }

    let prompt = `# Pending Continuations from Bryan

Bryan has answered ${continuations.length} question(s) that require processing.

`

    for (const [group, conts] of groupedByGroup) {
      prompt += `## ${group} (${conts.length} continuation(s))

`
      for (const cont of conts) {
        prompt += `### ${cont.id}
${cont.prompt.slice(0, 500)}...

`
      }
    }

    prompt += `## Recommended Action

Launch background agents to process these continuations:
- Use \`spawn_continuation\` for each group
- Or process inline if the continuations are simple

Do NOT ignore Bryan's answers. They represent human guidance.`

    return prompt
  }

  /**
   * Spawn background agents to process continuations
   */
  export async function spawnProcessors(): Promise<BackgroundAgent.Task[]> {
    const continuations = await Dialectic.getPendingContinuations()
    const tasks: BackgroundAgent.Task[] = []

    // Group by group to spawn one agent per group
    const groupedByGroup = new Map<Dialectic.Group, Dialectic.Continuation[]>()

    for (const cont of continuations) {
      const existing = groupedByGroup.get(cont.group) ?? []
      existing.push(cont)
      groupedByGroup.set(cont.group, existing)
    }

    for (const [group, conts] of groupedByGroup) {
      const combinedPrompt = conts.map((c) => c.prompt).join("\n\n---\n\n")

      const task = await BackgroundAgent.spawn({
        task: combinedPrompt,
        agentType: GROUP_TO_AGENT[group],
        context: {
          group,
          continuationIds: conts.map((c) => c.id),
          isDialecticContinuation: true,
        },
      })

      tasks.push(task)

      // Mark as processed (they're being handled by the spawned agent)
      for (const cont of conts) {
        await Dialectic.markProcessed(cont.id)
      }

      log.info("Spawned continuation processor", {
        group,
        taskId: task.id,
        continuationCount: conts.length,
      })
    }

    Bus.publish(BryanEvents.ContinuationsSpawned, {
      taskCount: tasks.length,
      totalContinuations: continuations.length,
    })

    return tasks
  }

  /**
   * Process a single continuation inline (without spawning)
   */
  export async function processInline(continuationId: string): Promise<string> {
    const continuations = await Dialectic.getPendingContinuations()
    const continuation = continuations.find((c) => c.id === continuationId)

    if (!continuation) {
      throw new Error(`Continuation not found: ${continuationId}`)
    }

    // Mark as processed
    await Dialectic.markProcessed(continuationId)

    // Return the prompt for the session to handle
    return continuation.prompt
  }

  /**
   * Get status message for session start
   */
  export async function getStatusMessage(): Promise<string | undefined> {
    const status = await Dialectic.getStatus()

    if (status.pendingContinuations === 0 && status.pendingQuestions === 0) {
      return undefined
    }

    let message = "**Bryan Integration Status**\n\n"

    if (status.pendingContinuations > 0) {
      message += `- ${status.pendingContinuations} continuation(s) pending (Bryan answered)\n`
    }

    if (status.pendingQuestions > 0) {
      message += `- ${status.pendingQuestions} question(s) awaiting Bryan's answer\n`
    }

    if (status.pendingContinuations > 0) {
      message += "\nRun `spawn_continuation` to process Bryan's answers."
    }

    return message
  }
}
