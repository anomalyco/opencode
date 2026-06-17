import type { Goal, GoalPlan, GoalStep } from "./types"

export interface DeterministicGoalPlanOptions {
  id: string
  now: string
}

function step(input: Omit<GoalStep, "status">): GoalStep {
  return {
    ...input,
    status: "PENDING",
  }
}

export function createDeterministicGoalPlan(goal: Goal, options: DeterministicGoalPlanOptions): GoalPlan {
  return {
    id: options.id,
    goalId: goal.id,
    version: 1,
    createdAt: options.now,
    updatedAt: options.now,
    steps: [
      step({
        id: "inspect",
        title: "Inspect project context",
        description: "Inspect the repository, existing conventions, and relevant integration points before changing code.",
        dependencies: [],
        verification: [],
      }),
      step({
        id: "design",
        title: "Design implementation approach",
        description: "Define the minimal implementation approach, affected files, and verification commands.",
        dependencies: ["inspect"],
        verification: [],
      }),
      step({
        id: "implement",
        title: "Apply implementation changes",
        description: "Implement the goal using focused, test-driven changes.",
        dependencies: ["design"],
        verification: [],
      }),
      step({
        id: "verify",
        title: "Run verification",
        description: "Run package verification commands and capture evidence before claiming completion.",
        dependencies: ["implement"],
        verification: [
          {
            type: "COMMAND",
            command: "bun run --cwd packages/opencode typecheck",
            expectedExitCode: 0,
          },
        ],
      }),
      step({
        id: "summarize",
        title: "Summarize result",
        description: "Summarize changes, verification evidence, risks, and next steps.",
        dependencies: ["verify"],
        verification: [],
      }),
    ],
  }
}
