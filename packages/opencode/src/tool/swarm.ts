import z from "zod"
import { Tool } from "./tool"
import { Log } from "../util/log"
import { AgentSwarm } from "../agent/swarm"

/**
 * Swarm Tool - Enables multi-agent collaboration for complex tasks
 * 
 * This tool allows the agent to decompose complex problems and coordinate
 * multiple specialized agents working in parallel. It's like having a team
 * of expert developers working together instead of one lone coder.
 */

const log = Log.create({ service: "tool-swarm" })

export const SwarmTool = Tool.define("swarm", {
  description: `Execute complex tasks using a swarm of specialized AI agents working in parallel.

This tool orchestrates multiple agents to:
- Decompose large problems into parallelizable subtasks
- Assign subtasks to the most qualified agents
- Execute tasks concurrently while managing dependencies
- Synthesize results into a coherent solution
- Resolve conflicts between concurrent modifications

Use this when facing:
- Large-scale refactoring across multiple files
- Complex feature implementation requiring various skills
- Comprehensive testing and documentation generation
- Multi-faceted code analysis and optimization

The swarm approach can complete complex tasks 3-5x faster than sequential execution.`,

  parameters: z.object({
    description: z.string().describe("Comprehensive description of the complex task to be solved"),
    context: z.array(z.string()).describe("Relevant context, file paths, or previous findings"),
    maxParallelAgents: z.number().optional().describe("Maximum number of agents to run in parallel (default: 5)"),
    priority: z.enum(["low", "medium", "high", "critical"]).optional().describe("Task priority level"),
  }),

  async execute(args, ctx) {
    log.info("Initializing agent swarm", { 
      description: args.description,
      contextItems: args.context.length 
    })

    const orchestrator = new AgentSwarm.SwarmOrchestrator(ctx.sessionID, {
      maxParallelAgents: args.maxParallelAgents,
    })

    // Decompose the task
    const subtasks = await orchestrator.decomposeTask({
      description: args.description,
      context: args.context,
    })

    log.info("Decomposed into subtasks", { count: subtasks.length })

    // Assign tasks to agents
    await orchestrator.assignTasks(subtasks)

    // Execute tasks in parallel
    const results = await orchestrator.executeTasks()

    // Monitor swarm metrics
    const metrics = await orchestrator.monitorSwarm()

    // Synthesize final results
    const synthesis = await orchestrator.synthesizeResults(results)

    const output = `# Swarm Execution Complete

## Task Summary
${args.description}

## Execution Metrics
- Total Subtasks: ${metrics.totalTasks}
- Completed: ${metrics.completedTasks}
- Failed: ${metrics.failedTasks}
- Efficiency: ${metrics.efficiency.toFixed(1)}%

## Results
${synthesis}

## Performance
The swarm completed ${metrics.completedTasks} parallel tasks with ${metrics.efficiency.toFixed(1)}% efficiency.
${metrics.bottlenecks.length > 0 ? `\n⚠️ Bottlenecks detected: ${metrics.bottlenecks.join(", ")}` : ""}
`

    return {
      title: `Swarm: ${args.description}`,
      metadata: {
        subtasks: subtasks.length,
        completed: metrics.completedTasks,
        efficiency: metrics.efficiency,
      },
      output,
    }
  },
})
