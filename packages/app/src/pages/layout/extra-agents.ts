import { base64Encode } from "@opencode-ai/util/encode"
import type { IconName } from "@opencode-ai/ui/icon"
import type { LocalProject } from "@/context/layout"
import { decode64 } from "@/utils/base64"
import { workspaceKey } from "./helpers"

export const extraAgents = [
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
  },
] as const

export type ExtraAgentId = (typeof extraAgents)[number]["id"]

export type ExtraAgent = (typeof extraAgents)[number]

export const mainDomain = "opencode" as const

export type DomainId = typeof mainDomain | `extra-agent/${ExtraAgentId}`

export const extraAgentIds = extraAgents.map((agent) => agent.id)

export const extraAgentDomain = (id: ExtraAgentId): DomainId => `extra-agent/${id}`

export const domainFromIntegration = (value?: string): DomainId =>
  isExtraAgentIntegration(value) ? extraAgentDomain(value) : mainDomain

export const extraAgentIdFromDomain = (value?: string) => {
  if (!value?.startsWith("extra-agent/")) return
  const id = value.slice("extra-agent/".length)
  return isExtraAgentIntegration(id) ? id : undefined
}

export const isExtraAgentDomain = (value?: string): value is `extra-agent/${ExtraAgentId}` =>
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

export const enabledExtraAgents = (list: Array<{ integration?: string }>) =>
  extraAgents.filter((agent) => list.some((item) => item.integration === agent.id))

export const extraAgentByDirectory = (directory?: string) => {
  if (!directory) return
  return extraAgents.find((agent) => workspaceKey(agent.directory) === workspaceKey(directory))
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
  !!value && extraAgentIds.includes(value as ExtraAgentId)

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
