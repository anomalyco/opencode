import type { MatchResult } from "../util/match.js"
import { fuzzyMatch } from "../util/match.js"

export interface ACPAgentDefinition {
  name: string
  description: string
  command: string
  acpStartupArgs: string[]
  installGuide?: string
}

export const ACP_AGENTS: ACPAgentDefinition[] = [
  {
    name: "Claude Code",
    description: "Anthropic's official Claude Code agent",
    command: "npx",
    acpStartupArgs: ["@zed-industries/claude-code-acp"],
    installGuide: "https://github.com/zed-industries/claude-code-acp",
  },
  {
    name: "Codex CLI",
    description: "Zed's Codex agent for code editing",
    command: "npx",
    acpStartupArgs: ["@zed-industries/codex-acp"],
    installGuide: "https://github.com/zed-industries/codex-acp",
  },
  {
    name: "Gemini CLI",
    description: "Google's Gemini code assistant (recommended for ACP testing)",
    command: "npx",
    acpStartupArgs: ["@google/gemini-cli", "--experimental-acp"],
    installGuide: "https://github.com/google-gemini/gemini-cli",
  },
  {
    name: "Kimi CLI",
    description: "Moonshot AI's Kimi code assistant",
    command: "uvx",
    acpStartupArgs: ["--python", "3.13", "kimi-cli", "--acp"],
    installGuide: "https://github.com/MoonshotAI/kimi-cli",
  },
  {
    name: "Fast Agent",
    description: "Framework for multimodal agents with ACP support (requires Python 3.13+)",
    command: "uvx",
    acpStartupArgs: ["fast-agent-acp@latest"],
    installGuide: "https://github.com/evalstate/fast-agent",
  },
  {
    name: "OpenHands",
    description: "All-Hands AI's autonomous coding agent (experimental ACP)",
    command: "uvx",
    acpStartupArgs: ["--python", "3.12", "--from", "openhands-ai", "openhands", "acp"],
    installGuide: "https://docs.openhands.dev/openhands/usage/run-openhands/acp",
  },
  {
    name: "Mistral Vibe",
    description: "Mistral AI's coding agent with ACP support",
    command: "uvx",
    acpStartupArgs: ["mistral-vibe", "vibe-acp"],
    installGuide: "https://github.com/mistralai/mistral-vibe",
  },
  {
    name: "Auggie",
    description: "Augment Code's AI coding assistant",
    command: "npx",
    acpStartupArgs: ["@augmentcode/auggie@latest", "--acp"],
    installGuide: "https://docs.augmentcode.com/cli/acp",
  },
  {
    name: "Goose",
    description: "Block's autonomous coding agent (requires v1.14.2+)",
    command: "goose",
    acpStartupArgs: ["acp"],
    installGuide: "https://block.github.io/goose/docs/getting-started/installation",
  },
  {
    name: "OpenCode",
    description: "SST's open-source code agent",
    command: "npx",
    acpStartupArgs: ["opencode-ai@latest", "acp"],
    installGuide: "https://github.com/sst/opencode",
  },
  {
    name: "Stakpak",
    description: "Stakpak's AI development agent",
    command: "stakpak",
    acpStartupArgs: ["acp"],
    installGuide: "https://github.com/stakpak/agent",
  },
  {
    name: "Docker cagent",
    description: "Docker's container agent (ACP support unclear)",
    command: "",
    acpStartupArgs: [],
    installGuide: "https://github.com/docker/cagent",
  },
  {
    name: "Code Assistant",
    description: "Rust-based coding agent with streaming and tool execution support",
    command: "code-assistant",
    acpStartupArgs: ["acp"],
    installGuide: "https://github.com/stippi/code-assistant",
  },
  {
    name: "LLMling-Agent",
    description: "Python-based agent framework with file and terminal access",
    command: "uvx",
    acpStartupArgs: ["--python", "3.13", "llmling-agent[default]@latest", "serve-acp", "config.yml", "--file-access", "--terminal-access"],
    installGuide: "https://phil65.github.io/llmling-agent/cli/",
  },
  {
    name: "Qwen Code",
    description: "AI-powered coding agent optimized for Qwen3-Coder models (experimental ACP)",
    command: "npx",
    acpStartupArgs: ["@qwen-code/qwen-code@latest", "--experimental-acp"],
    installGuide: "https://github.com/QwenLM/qwen-code",
  },
  {
    name: "VT Code",
    description: "Rust-based coding agent with ACP support",
    command: "vtcode",
    acpStartupArgs: ["acp"],
    installGuide: "https://github.com/vinhnx/vtcode",
  },
]

export function getAgent(name: string): ACPAgentDefinition | undefined {
  return ACP_AGENTS.find((agent) => agent.name === name)
}

export function matchAgent(name: string): MatchResult<ACPAgentDefinition> {
  return fuzzyMatch(name, ACP_AGENTS, (agent) => agent.name)
}

export function getAllAgents(): ACPAgentDefinition[] {
  return ACP_AGENTS
}

// Export the default agent (Claude Code)
export const DEFAULT_AGENT = ACP_AGENTS.find((agent) => agent.name === "Claude Code")!
if (!DEFAULT_AGENT) {
  throw new Error("Default agent 'Claude Code' not found in ACP_AGENTS")
}
