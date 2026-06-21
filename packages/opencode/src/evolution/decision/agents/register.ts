import type { AgentManifest } from "@/evolution/decision/agents/types"
import { execute as contextAnalyst } from "./context-analyst"
import { execute as riskAgent } from "./risk"
import { execute as planningAgent } from "./planning"

export const REGISTERED_AGENTS: readonly AgentManifest[] = [
  {
    id: "context-analyst",
    capabilities: ["proposal"],
    execute: contextAnalyst,
  },
  {
    id: "risk-agent",
    capabilities: ["risk-analysis"],
    execute: riskAgent,
  },
  {
    id: "planning-agent",
    capabilities: ["execution-plan"],
    execute: planningAgent,
  },
]
