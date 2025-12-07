/**
 * Minimal helpers from src/cli/cmd/run.ts for unit testing.
 * We re-export the pure functions to avoid pulling in Bun/yargs deps.
 */
import { expectTypeOf } from "bun:test"

type ModeFlagArgs = {
  planAgent: string
  implementAgent: string
  planModel?: string
  implementModel?: string
}

export function parseAgentInput(input?: string | null): { agent?: string; model?: string } {
  if (!input) return {}
  const idx = input.lastIndexOf("/")
  if (idx > 0 && idx < input.length - 1) {
    return { agent: input.slice(0, idx), model: input.slice(idx + 1) }
  }
  return { agent: input }
}

export function collectModeFlags(args: Record<string, any>): ModeFlagArgs | null {
  const planInput = args["plan-agent"] ?? args.planAgent
  const implInput = args["impl-agent"] ?? args.implAgent

  const planParsed = parseAgentInput(planInput)
  const implParsed = parseAgentInput(implInput)

  if (planParsed.agent || implParsed.agent) {
    return {
      planAgent: planParsed.agent ?? "",
      implementAgent: implParsed.agent ?? "",
      planModel: planParsed.model,
      implementModel: implParsed.model,
    }
  }

  return null
}

export function validateModeFlags(flags: ModeFlagArgs | null, args: Record<string, any>) {
  if (!flags) return

  if (!flags.planAgent || !flags.implementAgent) {
    throw new Error("missing plan/impl agent")
  }

  if (args.agent) {
    throw new Error("cannot combine agent with plan/impl")
  }

  if (args.command) {
    throw new Error("plan/impl requires prompt mode")
  }
}
