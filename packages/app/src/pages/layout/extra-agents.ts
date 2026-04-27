import { base64Encode } from "@opencode-ai/util/encode"
import type { IconName } from "@opencode-ai/ui/icon"
import type { LocalProject } from "@/context/layout"
import { decode64 } from "@/utils/base64"
import { workspaceKey } from "./helpers"

export type ExtraAgentErrorMatcher = {
  kind: string
  match: (lowerMessage: string) => boolean
  lines: ReadonlyArray<{ key: string; fallback: string }>
  appendOriginal?: boolean
}

export type ExtraAgentCapabilities = {
  slashCommands?: ReadonlyArray<readonly [trigger: string, description: string]>
  agentChoose?: {
    agent: string
    model: { providerID: string; modelID: string }
  }
  hideAgent?: boolean
  hideVariant?: boolean
  errorMatchers?: ReadonlyArray<ExtraAgentErrorMatcher>
}

export type ExtraAgentDescriptor = {
  id: string
  label: string
  labelKey: string
  icon: IconName
  emptyIcon: IconName
  emptySessionTitleKey: string
  sessionListFailedTitleKey: string
  fileListEmptyKey: string
  directory: string
  configSection: string
  configPick: string
  capabilities?: ExtraAgentCapabilities
}

const OPENCLAW_SLASH: ExtraAgentCapabilities["slashCommands"] = [
  ["help", "Show help"],
  ["commands", "List commands"],
  ["tools", "Show available tools"],
  ["skill", "Run a skill by name"],
  ["status", "Show current status"],
  ["allowlist", "Manage allowlist entries"],
  ["approve", "Resolve exec approval prompts"],
  ["context", "Explain current context"],
  ["btw", "Ask a side question"],
  ["export-session", "Export current session"],
  ["whoami", "Show sender id"],
  ["session", "Manage session settings"],
  ["subagents", "Inspect or control subagents"],
  ["acp", "Control ACP runtime sessions"],
  ["agents", "List session agents"],
  ["focus", "Bind thread to a target"],
  ["unfocus", "Remove current thread binding"],
  ["kill", "Abort subagents"],
  ["steer", "Steer a running subagent"],
  ["tell", "Alias for steer"],
  ["config", "Read or write config"],
  ["mcp", "Manage MCP config"],
  ["plugins", "Inspect or toggle plugins"],
  ["plugin", "Alias for plugins"],
  ["debug", "Set runtime debug overrides"],
  ["usage", "Control usage footer"],
  ["tts", "Control text to speech"],
  ["stop", "Stop current run"],
  ["restart", "Restart gateway"],
  ["dock-telegram", "Switch replies to Telegram"],
  ["dock-discord", "Switch replies to Discord"],
  ["dock-slack", "Switch replies to Slack"],
  ["activation", "Set group activation mode"],
  ["send", "Control sending behavior"],
  ["reset", "Start a new session"],
  ["new", "Start a new session"],
  ["think", "Set thinking level"],
  ["fast", "Toggle fast mode"],
  ["verbose", "Set verbosity"],
  ["reasoning", "Control reasoning output"],
  ["elevated", "Control elevated mode"],
  ["exec", "Show or set exec policy"],
  ["model", "Select model"],
  ["models", "Alias for model"],
  ["queue", "Manage queue mode"],
  ["bash", "Run a host command"],
  ["compact", "Compact current context"],
] as const

const OPENCLAW_ERRORS: ReadonlyArray<ExtraAgentErrorMatcher> = [
  {
    kind: "file_unsupported",
    match: (msg) => msg.includes("does not expose a project filesystem yet"),
    lines: [
      {
        key: "error.openclaw.fileUnsupported",
        fallback:
          "OpenClaw 目前还不提供项目文件树。你可以继续在 OpenClaw 中对话，但文件浏览/打开请切回普通项目。",
      },
      {
        key: "error.openclaw.fileUnsupported.hint",
        fallback: "如果你想让 OpenClaw 管理某个项目，后续更适合做成项目内悬浮管家，而不是直接复用项目文件树。",
      },
    ],
  },
  {
    kind: "gateway_unavailable",
    match: (msg) =>
      msg.includes("gateway not connected") ||
      msg.includes("failed to connect to openclaw gateway") ||
      msg.includes("gateway connect timeout") ||
      msg.includes("gateway connection closed") ||
      msg.includes("openclaw gateway session listing failed") ||
      msg.includes("openclaw gateway history loading"),
    lines: [
      {
        key: "error.openclaw.gatewayUnavailable",
        fallback: "OpenClaw gateway 当前不可用，导致会话列表或历史消息无法加载。",
      },
      {
        key: "error.openclaw.gatewayUnavailable.hint",
        fallback:
          "请检查桌面设置里的 Gateway URL 是否正确，然后确认 gateway 进程仍在线；如果刚重启电脑，通常需要重新启动或重新连接 gateway。",
      },
    ],
    appendOriginal: true,
  },
  {
    kind: "gateway_auth",
    match: (msg) =>
      msg.includes("accepted") ||
      msg.includes("unauthorized") ||
      msg.includes("forbidden") ||
      msg.includes("token"),
    lines: [
      { key: "error.openclaw.gatewayAuth", fallback: "OpenClaw gateway 鉴权可能失败了。" },
      {
        key: "error.openclaw.gatewayAuth.hint",
        fallback:
          "请检查桌面设置中的 Gateway Token 是否仍然有效，并确认当前账号/设备有权限连接该 gateway。",
      },
    ],
    appendOriginal: true,
  },
]

export const extraAgents: readonly ExtraAgentDescriptor[] = [
  {
    id: "openclaw",
    label: "OpenClaw",
    labelKey: "sidebar.openclaw",
    icon: "openclaw" as IconName,
    emptyIcon: "openclaw" as IconName,
    emptySessionTitleKey: "session.new.openclaw.title",
    sessionListFailedTitleKey: "toast.session.listFailed.openclaw.title",
    fileListEmptyKey: "toast.file.listFailed.openclaw",
    directory: "/openclaw",
    configSection: "claws",
    configPick: "claw:openclaw",
    capabilities: {
      slashCommands: OPENCLAW_SLASH,
      agentChoose: {
        agent: "claw",
        model: { providerID: "openclaw", modelID: "claw" },
      },
      errorMatchers: OPENCLAW_ERRORS,
    },
  },
  {
    id: "hermes",
    label: "Hermes",
    labelKey: "sidebar.hermes",
    icon: "hermes" as IconName,
    emptyIcon: "hermes" as IconName,
    emptySessionTitleKey: "session.new.hermes.title",
    sessionListFailedTitleKey: "toast.session.listFailed.hermes.title",
    fileListEmptyKey: "toast.file.listFailed.hermes",
    directory: "/hermes",
    configSection: "claws",
    configPick: "claw:hermes",
    capabilities: {
      hideAgent: true,
      hideVariant: true,
    },
  },
  {
    id: "genericagent",
    label: "GenericAgent",
    labelKey: "sidebar.genericagent",
    icon: "robot" as IconName,
    emptyIcon: "robot" as IconName,
    emptySessionTitleKey: "session.new.genericagent.title",
    sessionListFailedTitleKey: "toast.session.listFailed.genericagent.title",
    fileListEmptyKey: "toast.file.listFailed.genericagent",
    directory: "/genericagent",
    configSection: "claws",
    configPick: "claw:genericagent",
    capabilities: {
      hideAgent: true,
      hideVariant: true,
    },
  },
]

export type ExtraAgentId = string

export type ExtraAgent = ExtraAgentDescriptor

export const mainDomain = "opencode" as const

export type DomainId = typeof mainDomain | `extra-agent/${string}`

export const extraAgentIds: readonly string[] = extraAgents.map((agent) => agent.id)

export const extraAgentDomain = (id: ExtraAgentId): DomainId => `extra-agent/${id}`

export const domainFromIntegration = (value?: string): DomainId =>
  isExtraAgentIntegration(value) ? extraAgentDomain(value) : mainDomain

export const extraAgentIdFromDomain = (value?: string) => {
  if (!value?.startsWith("extra-agent/")) return
  const id = value.slice("extra-agent/".length)
  return isExtraAgentIntegration(id) ? id : undefined
}

export const isExtraAgentDomain = (value?: string): value is `extra-agent/${string}` =>
  !!extraAgentIdFromDomain(value)

export const extraAgentDir = (id: ExtraAgentId) => extraAgents.find((agent) => agent.id === id)?.directory ?? ""

export const extraAgentSlug = (id: ExtraAgentId) => base64Encode(extraAgentDir(id))

export const extraAgentLabelKey = (id: ExtraAgentId) => extraAgents.find((agent) => agent.id === id)?.labelKey ?? ""

export const extraAgentIcon = (id: ExtraAgentId) => extraAgents.find((agent) => agent.id === id)?.icon ?? ""

export const extraAgentConfig = (id: ExtraAgentId) => {
  const agent = extraAgents.find((item) => item.id === id)
  if (!agent) return
  return { section: agent.configSection, pick: agent.configPick }
}

export const extraAgentById = (id?: string) => {
  if (!id) return
  return extraAgents.find((agent) => agent.id === id)
}

export const extraAgentByIntegration = (value?: string) => extraAgentById(value)

export const extraAgentCapabilities = (id?: string): ExtraAgentCapabilities | undefined =>
  id ? extraAgentById(id)?.capabilities : undefined

export const enabledExtraAgents = (list: Array<{ integration?: string }>) =>
  extraAgents.filter((agent) => list.some((item) => item.integration === agent.id))

export const extraAgentByDirectory = (directory?: string) => {
  if (!directory) return
  return extraAgents.find((agent) => workspaceKey(agent.directory) === workspaceKey(directory))
}

export const extraAgentActive = (
  id: ExtraAgentId,
  input?: { directory?: string; integration?: string; pathname?: string },
) => {
  if (input?.integration !== id) return false
  if (extraAgentByDirectory(input.directory)?.id !== id) return false
  return !!input.pathname?.match(/\/session(?:\/|$)/)
}

export const domainFromDirectory = (directory?: string): DomainId => {
  const agent = extraAgentByDirectory(directory)
  return agent ? extraAgentDomain(agent.id) : mainDomain
}

export const extraAgentBySlug = (slug?: string) => {
  if (!slug) return
  return extraAgentByDirectory(decode64(slug))
}

export const isExtraAgentDirectory = (directory?: string) => !!extraAgentByDirectory(directory)

export const isDomainDirectory = (value?: string, directory?: string) => domainFromDirectory(directory) === value

export const isExtraAgentIntegration = (value?: string): value is ExtraAgentId =>
  !!value && extraAgentIds.includes(value)

export const extraAgentProject = (id: ExtraAgentId): LocalProject => {
  const agent = extraAgents.find((item) => item.id === id)
  return {
    id,
    worktree: agent?.directory ?? extraAgentDir(id),
    name: agent?.label ?? id,
    expanded: true,
    vcs: undefined,
    sandboxes: [],
  }
}
