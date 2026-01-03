/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"

interface Task {
  id: string
  description: string
  dependencies: string[]
  dependents: string[]
  level: number
  status: "pending" | "running" | "completed" | "failed"
}

interface DAG {
  tasks: Map<string, Task>
  levels: Map<number, string[]>
  executionGroups: string[][]
}

// Topological sort to determine execution levels
function computeLevels(tasks: Map<string, Task>): Map<number, string[]> {
  const levels = new Map<number, string[]>()
  const inDegree = new Map<string, number>()
  
  // Initialize in-degrees
  for (const [id, task] of tasks) {
    inDegree.set(id, task.dependencies.length)
  }
  
  // Find all nodes with no dependencies (level 0)
  let currentLevel: string[] = []
  for (const [id, degree] of inDegree) {
    if (degree === 0) currentLevel.push(id)
  }
  
  let level = 0
  while (currentLevel.length > 0) {
    levels.set(level, [...currentLevel])
    
    // Update levels for dependent tasks
    const nextLevel: string[] = []
    for (const taskId of currentLevel) {
      const task = tasks.get(taskId)!
      task.level = level
      
      for (const dependentId of task.dependents) {
        const newDegree = inDegree.get(dependentId)! - 1
        inDegree.set(dependentId, newDegree)
        if (newDegree === 0) nextLevel.push(dependentId)
      }
    }
    
    currentLevel = nextLevel
    level++
  }
  
  return levels
}

// Check for circular dependencies
function detectCycles(tasks: Map<string, Task>): string[] | null {
  const visited = new Set<string>()
  const recursionStack = new Set<string>()
  const cycle: string[] = []
  
  function dfs(taskId: string): boolean {
    visited.add(taskId)
    recursionStack.add(taskId)
    
    const task = tasks.get(taskId)
    if (!task) return false
    
    for (const depId of task.dependents) {
      if (!visited.has(depId)) {
        if (dfs(depId)) {
          cycle.unshift(depId)
          return true
        }
      } else if (recursionStack.has(depId)) {
        cycle.push(depId)
        return true
      }
    }
    
    recursionStack.delete(taskId)
    return false
  }
  
  for (const taskId of tasks.keys()) {
    if (!visited.has(taskId)) {
      if (dfs(taskId)) {
        return cycle
      }
    }
  }
  
  return null
}

export const analyze = tool({
  description: "Analyze a list of tasks and build a DAG showing dependencies and parallel execution groups",
  args: {
    tasks: tool.schema.array(
      tool.schema.object({
        id: tool.schema.string().describe("Unique task identifier (e.g., T1, T2)"),
        description: tool.schema.string().describe("What the task does"),
        dependencies: tool.schema.array(tool.schema.string()).describe("List of task IDs this task depends on"),
      })
    ).describe("Array of tasks to analyze"),
  },
  async execute(args) {
    const taskMap = new Map<string, Task>()
    
    // Build task map
    for (const t of args.tasks) {
      taskMap.set(t.id, {
        id: t.id,
        description: t.description,
        dependencies: t.dependencies,
        dependents: [],
        level: -1,
        status: "pending",
      })
    }
    
    // Build dependents (reverse edges)
    for (const t of args.tasks) {
      for (const depId of t.dependencies) {
        const depTask = taskMap.get(depId)
        if (depTask) {
          depTask.dependents.push(t.id)
        }
      }
    }
    
    // Check for cycles
    const cycle = detectCycles(taskMap)
    if (cycle) {
      return JSON.stringify({
        error: "Circular dependency detected",
        cycle: cycle,
        message: `Tasks form a cycle: ${cycle.join(" → ")}`,
      }, null, 2)
    }
    
    // Compute levels
    const levels = computeLevels(taskMap)
    
    // Build execution groups
    const executionGroups: { level: number; tasks: { id: string; description: string; dependencies: string[] }[] }[] = []
    for (const [level, taskIds] of levels) {
      executionGroups.push({
        level,
        tasks: taskIds.map(id => {
          const t = taskMap.get(id)!
          return { id, description: t.description, dependencies: t.dependencies }
        }),
      })
    }
    
    // Generate visualization
    let visualization = "DAG Analysis:\n═══════════════════════════════════════\n\n"
    
    for (const group of executionGroups) {
      const levelLabel = group.level === 0 
        ? "Level 0 (Leaf Nodes - Execute First)"
        : group.level === executionGroups.length - 1
          ? `Level ${group.level} (Root - Final Output)`
          : `Level ${group.level}`
      
      visualization += `${levelLabel}:\n`
      
      for (let i = 0; i < group.tasks.length; i++) {
        const t = group.tasks[i]
        const prefix = i === group.tasks.length - 1 ? "└─" : "├─"
        const deps = t.dependencies.length > 0 ? ` ← depends on: ${t.dependencies.join(", ")}` : ""
        visualization += `${prefix} [${t.id}] ${t.description}${deps}\n`
      }
      visualization += "\n"
    }
    
    visualization += "Parallel Execution Groups:\n"
    for (const group of executionGroups) {
      const taskIds = group.tasks.map(t => t.id).join(", ")
      const parallel = group.tasks.length > 1 ? " (parallel)" : " (sequential)"
      visualization += `- Level ${group.level}: [${taskIds}]${parallel}\n`
    }
    
    return JSON.stringify({
      visualization,
      levels: executionGroups,
      totalTasks: taskMap.size,
      parallelizableCount: executionGroups.filter(g => g.tasks.length > 1).reduce((sum, g) => sum + g.tasks.length, 0),
    }, null, 2)
  },
})

export const generateHivemindPlan = tool({
  description: "Generate a Hivemind execution plan from DAG analysis",
  args: {
    levels: tool.schema.array(
      tool.schema.object({
        level: tool.schema.number(),
        tasks: tool.schema.array(
          tool.schema.object({
            id: tool.schema.string(),
            description: tool.schema.string(),
            dependencies: tool.schema.array(tool.schema.string()),
          })
        ),
      })
    ).describe("Execution levels from DAG analysis"),
  },
  async execute(args) {
    const plan: string[] = []
    
    plan.push("# Hivemind Execution Plan\n")
    
    for (const level of args.levels) {
      plan.push(`## Level ${level.level}`)
      
      if (level.tasks.length === 1) {
        const task = level.tasks[0]
        plan.push(`
### Sequential Execution
\`\`\`
mcp_hivemind_orchestrator_spawn({
  task: "Execute ${task.id}: ${task.description}",
  count: 1
})
\`\`\`
`)
      } else {
        plan.push(`
### Parallel Execution (${level.tasks.length} agents)
\`\`\`
// Spawn all agents for this level
${level.tasks.map((t, i) => `agent_${t.id} = mcp_hivemind_orchestrator_spawn({ task: "Execute ${t.id}: ${t.description}", count: 1 })`).join("\n")}

// Wait for all to complete
mcp_hivemind_orchestrator_wait({
  targets: [${level.tasks.map(t => `{ type: "agent", agent_id: agent_${t.id} }`).join(", ")}],
  mode: "all"
})
\`\`\`
`)
      }
    }
    
    return plan.join("\n")
  },
})
