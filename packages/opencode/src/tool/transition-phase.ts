import z from "zod"
import { Tool } from "./tool"
import { DebugPhase } from "../session/debug-phase"

export const TransitionPhaseTool = Tool.define("transitionPhase", {
  description: [
    "Move to the next phase of the debug workflow.",
    "Valid phases: PLANNING, CODING, BREAKPOINTING, DEBUGGING, EXPLAINING, CONFIRMING.",
    "Transitions must follow the sequence: PLANNING -> CODING -> BREAKPOINTING -> DEBUGGING -> EXPLAINING -> CONFIRMING -> PLANNING (next step).",
    "Call this when you have completed the work for the current phase.",
  ].join("\n"),
  parameters: z.object({
    to: z.enum(DebugPhase.PHASES).describe("The phase to transition to"),
    reason: z.string().describe("Brief explanation of why you are transitioning"),
  }),
  async execute(args, ctx) {
    const state = DebugPhase.getOrCreate(ctx.sessionID)
    try {
      const next = DebugPhase.transition(state, args.to)
      const allowedTools = DebugPhase.toolsForPhase(next.currentPhase)
      return {
        title: `Phase: ${next.currentPhase}`,
        output: [
          `Transitioned to ${next.currentPhase} (step ${next.currentStep}).`,
          `Reason: ${args.reason}`,
          `Available tools: ${allowedTools.join(", ")}`,
        ].join("\n"),
        metadata: {
          phase: next.currentPhase,
          step: next.currentStep,
          error: false as boolean,
        },
      }
    } catch (err: any) {
      return {
        title: "Transition Failed",
        output: err.message as string,
        metadata: {
          phase: state.currentPhase,
          step: state.currentStep,
          error: true as boolean,
        },
      }
    }
  },
})
