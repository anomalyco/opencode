export type ACPAgentInstallMethod = "npx" | "uvx" | "system" | "skip"

export interface ACPAgentDefinition {
  id: string
  name: string
  description: string
  installMethod: ACPAgentInstallMethod
  command: string
  args: string[]
  envRequired?: string[]
  installCheck?: string
  installGuide?: string
}

export const ACP_AGENTS: ACPAgentDefinition[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    description: "Anthropic's official Claude Code agent",
    installMethod: "npx",
    command: "npx",
    args: ["@zed-industries/claude-code-acp"],
    installGuide: "https://github.com/zed-industries/claude-code-acp",
  },
  {
    id: "codex-cli",
    name: "Codex CLI",
    description: "Zed's Codex agent for code editing",
    installMethod: "npx",
    command: "npx",
    args: ["@zed-industries/codex-acp"],
    installGuide: "https://github.com/zed-industries/codex-acp",
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    description: "Google's Gemini code assistant (recommended for ACP testing)",
    installMethod: "npx",
    command: "npx",
    args: ["@google/gemini-cli", "--experimental-acp"],
    envRequired: ["GEMINI_API_KEY"],
    installGuide: "https://github.com/google-gemini/gemini-cli",
  },
  {
    id: "kimi-cli",
    name: "Kimi CLI",
    description: "Moonshot AI's Kimi code assistant",
    installMethod: "uvx",
    command: "uvx",
    args: ["--python", "3.13", "kimi-cli", "--acp"],
    installGuide: "https://github.com/MoonshotAI/kimi-cli",
  },
  {
    id: "auggie",
    name: "Auggie",
    description: "Augment Code's AI coding assistant",
    installMethod: "system",
    command: "auggie",
    args: ["--acp"],
    installCheck: "which auggie",
    installGuide: "https://docs.augmentcode.com/cli/acp",
  },
  {
    id: "goose",
    name: "Goose",
    description: "Block's autonomous coding agent (requires v1.14.2+)",
    installMethod: "system",
    command: "goose",
    args: ["acp"],
    installCheck: "which goose",
    installGuide: "https://block.github.io/goose/docs/guides/acp-clients",
  },
  {
    id: "opencode",
    name: "OpenCode",
    description: "SST's open-source code agent",
    installMethod: "system",
    command: "opencode",
    args: ["--acp"],
    installCheck: "which opencode",
    installGuide: "https://github.com/sst/opencode",
  },
  {
    id: "stakpak",
    name: "Stakpak",
    description: "Stakpak's AI development agent",
    installMethod: "system",
    command: "stakpak",
    args: ["acp"],
    installCheck: "which stakpak",
    installGuide: "https://github.com/stakpak/agent",
  },
  {
    id: "docker-cagent",
    name: "Docker cagent",
    description: "Docker's container agent (ACP support unclear)",
    installMethod: "skip",
    command: "",
    args: [],
    installGuide: "https://github.com/docker/cagent",
  },
]

export function getAgent(id: string): ACPAgentDefinition | undefined {
  return ACP_AGENTS.find((agent) => agent.id === id)
}

export function getAllAgents(): ACPAgentDefinition[] {
  return ACP_AGENTS
}

export function getInstallableAgents(): ACPAgentDefinition[] {
  return ACP_AGENTS.filter((agent) => agent.installMethod !== "skip")
}

export function getAgentsByInstallMethod(method: ACPAgentInstallMethod): ACPAgentDefinition[] {
  return ACP_AGENTS.filter((agent) => agent.installMethod === method)
}
