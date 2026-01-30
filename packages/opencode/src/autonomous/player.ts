import { AutonomousTypes } from "./types"

export namespace Player {
  export function prompt(input: { requirements: string; coachFeedback: string; turn: number }): string {
    if (input.turn === 1 || !input.coachFeedback) {
      return `You are an AI coding agent in IMPLEMENTATION MODE.

Your task is to implement the following requirements:

${input.requirements}

Instructions:
1. Read and understand the requirements fully
2. Create a plan (TODO list recommended)
3. Implement step by step
4. Create all necessary files and code
5. Ensure code compiles/runs correctly

Use your tools to complete this task.`
    }

    return `You are an AI coding agent in IMPLEMENTATION MODE.

The coach has reviewed your implementation and provided feedback:

${input.coachFeedback}

Original requirements for context:
${input.requirements}

Focus on addressing the specific issues mentioned in the coach feedback above.
Do not start from scratch - fix and improve the existing implementation.`
  }
}
