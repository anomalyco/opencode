import { teamPermissionNames } from "@/permission/groups"
import z from "zod"

export function teamPermissionFields(input: { rule: z.ZodTypeAny }) {
  return Object.fromEntries(teamPermissionNames.map((item) => [item, input.rule.optional()])) as Record<
    (typeof teamPermissionNames)[number],
    z.ZodOptional<z.ZodTypeAny>
  >
}

export function teamAgentFields() {
  return {
    read_agentmd: z.boolean().optional().describe("Allow AGENTS.md-style instruction loading for this agent."),
  }
}

export const teamAgentKnownKeys = ["read_agentmd"]

export function teamLocaleField() {
  return {
    locale: z.string().optional().describe("User interface locale for translated user-facing records"),
  }
}

export function teamReadAgentMdField() {
  return {
    read_agentmd: z.boolean().optional().describe("Allow loading AGENTS.md-style instruction files (default: false)"),
  }
}
