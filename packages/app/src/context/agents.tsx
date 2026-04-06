import { createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { Persist, persisted } from "@/utils/persist"

export type AgentKey = "supervisor" | "planner" | "coder" | "reviewer" | "qa-agent" | "bug-locator"

export interface AgentConfig {
  key: AgentKey
  name: string
  description: string
  model: string
  provider: string
  color: string
  temperature: number
  top_p: number
}

export const DEFAULT_AGENTS: AgentConfig[] = [
  {
    key: "supervisor",
    name: "Supervisor",
    description: "Main orchestrator - analyzes prompts and routes to the right agent",
    model: "qwen/qwen-3.6-plus-free",
    provider: "openrouter",
    color: "#a855f7",
    temperature: 0.7,
    top_p: 0.9,
  },
  {
    key: "planner",
    name: "Planner",
    description: "Task planning and risk scoring",
    model: "qwen/qwen-3.6-plus-free",
    provider: "openrouter",
    color: "#3b82f6",
    temperature: 0.6,
    top_p: 0.9,
  },
  {
    key: "coder",
    name: "Coder",
    description: "Code generation and unified diff",
    model: "qwen/qwen-2.5-coder-32b-instruct",
    provider: "openrouter",
    color: "#22c55e",
    temperature: 0.7,
    top_p: 0.9,
  },
  {
    key: "reviewer",
    name: "Reviewer",
    description: "4-layer code review",
    model: "qwen/qwen-3.6-plus-free",
    provider: "openrouter",
    color: "#f59e0b",
    temperature: 0.4,
    top_p: 0.8,
  },
  {
    key: "qa-agent",
    name: "QA Agent",
    description: "Test scenarios and UI testing with UI-TARS",
    model: "avil/UI-TARS:latest",
    provider: "ollama",
    color: "#ef4444",
    temperature: 0.3,
    top_p: 0.8,
  },
  {
    key: "bug-locator",
    name: "Bug Locator",
    description: "Error root cause analysis",
    model: "qwen/qwen-3.6-plus-free",
    provider: "openrouter",
    color: "#f97316",
    temperature: 0.5,
    top_p: 0.85,
  },
]

type Store = {
  agents: Partial<Record<AgentKey, { model: string; provider: string }>>
  activeAgent: AgentKey | null
}

export const { use: useAgents, provider: AgentsProvider } = createSimpleContext({
  name: "Agents",
  init: () => {
    const [store, setStore, _, ready] = persisted(
      Persist.global("agents", ["agents.v1"]),
      createStore<Store>({
        agents: {},
        activeAgent: null,
      }),
    )

    const configs = createMemo(() =>
      DEFAULT_AGENTS.map((a) => {
        const override = store.agents[a.key]
        return {
          ...a,
          model: override?.model ?? a.model,
          provider: override?.provider ?? a.provider,
        }
      }),
    )

    const getAgent = (key: AgentKey) => configs().find((a) => a.key === key)

    const setAgentModel = (key: AgentKey, model: string, provider: string) => {
      setStore("agents", key, { model, provider })
    }

    const setActiveAgent = (key: AgentKey | null) => {
      setStore("activeAgent", key)
    }

    return {
      ready,
      configs,
      getAgent,
      setAgentModel,
      activeAgent: () => store.activeAgent,
      setActiveAgent,
    }
  },
})
