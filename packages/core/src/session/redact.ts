export * as SessionRedact from "./redact.js"

import type { AgentAttachment, PromptMention, SkillAttachment } from "@opencode/schema/prompt"
import type { SessionError } from "@opencode/schema/session-error"
import type { SessionInbox } from "@opencode/schema/session-inbox"
import type { Tool } from "@opencode/schema/tool"
import { redactSecrets, redactValue } from "@opencode/util/redact"
import type { SessionMessage } from "./message.js"
import type { SessionStored } from "./stored.js"

function mapPreserving<T>(items: ReadonlyArray<T>, fn: (item: T) => T): ReadonlyArray<T> {
  const next = items.map(fn)
  return next.some((item, index) => item !== items[index]) ? next : items
}

function mapNonEmpty<T>(items: readonly [T, ...T[]], fn: (item: T) => T): readonly [T, ...T[]] {
  const next = items.map(fn)
  if (!next.some((item, index) => item !== items[index])) return items
  return next as [T, ...T[]]
}

function redactMention(mention: PromptMention | undefined): PromptMention | undefined {
  if (!mention) return mention
  const text = redactSecrets(mention.text)
  return text === mention.text ? mention : { ...mention, text }
}

function redactFile<T extends SessionStored.File>(file: T): T {
  const description = file.description === undefined ? undefined : redactSecrets(file.description)
  const mention = redactMention(file.mention)
  const source =
    file.source.type === "uri" && !file.source.uri.startsWith("data:") && !file.source.uri.startsWith("media:")
      ? (() => {
          const uri = redactSecrets(file.source.uri)
          return uri === file.source.uri ? file.source : { ...file.source, uri }
        })()
      : file.source
  if (description === file.description && mention === file.mention && source === file.source) return file
  return { ...file, description, mention, source }
}

function redactAgent(agent: AgentAttachment): AgentAttachment {
  const mention = redactMention(agent.mention)
  return mention === agent.mention ? agent : { ...agent, mention }
}

function redactSkillAttachment(skill: SkillAttachment): SkillAttachment {
  const text = skill.text === undefined ? undefined : redactSecrets(skill.text)
  const mention = redactMention(skill.mention)
  if (text === skill.text && mention === skill.mention) return skill
  return { ...skill, text, mention }
}

function redactToolContent(content: Tool.Content): Tool.Content {
  if (content.type === "text") {
    const text = redactSecrets(content.text)
    return text === content.text ? content : { ...content, text }
  }
  const name = content.name === undefined ? undefined : redactSecrets(content.name)
  return name === content.name ? content : { ...content, name }
}

function redactError(error: SessionError.Error | undefined): SessionError.Error | undefined {
  if (!error) return error
  const message = redactSecrets(error.message)
  const response = error.response
    ? (() => {
        const body = redactSecrets(error.response.body)
        return body === error.response.body ? error.response : { ...error.response, body }
      })()
    : undefined
  if (message === error.message && response === error.response) return error
  return { ...error, message, ...(response ? { response } : {}) }
}

function redactToolState(state: SessionMessage.ToolState): SessionMessage.ToolState {
  if (state.status === "streaming") {
    const input = redactSecrets(state.input)
    return input === state.input ? state : { ...state, input }
  }
  if (state.status === "running") {
    const input = redactValue(state.input)
    const metadata = redactValue(state.metadata)
    if (input === state.input && metadata === state.metadata) return state
    return { ...state, input, metadata }
  }
  if (state.status === "completed") {
    const input = redactValue(state.input)
    const content = mapNonEmpty(state.content, redactToolContent)
    const metadata = state.metadata === undefined ? undefined : redactValue(state.metadata)
    if (input === state.input && content === state.content && metadata === state.metadata) return state
    return { ...state, input, content, ...(metadata === undefined ? {} : { metadata }) }
  }
  const input = redactValue(state.input)
  const error = redactError(state.error)!
  const content = state.content === undefined ? undefined : mapNonEmpty(state.content, redactToolContent)
  const metadata = state.metadata === undefined ? undefined : redactValue(state.metadata)
  if (input === state.input && error === state.error && content === state.content && metadata === state.metadata)
    return state
  return {
    ...state,
    input,
    error,
    ...(content === undefined ? {} : { content }),
    ...(metadata === undefined ? {} : { metadata }),
  }
}

export function assistantPart<T extends SessionMessage.AssistantContent>(part: T): T {
  // Provider-owned `native` replay blobs must stay verbatim so providers accept subsequent turns.
  if (part.type === "text" || part.type === "reasoning") {
    const text = redactSecrets(part.text)
    return text === part.text ? part : { ...part, text }
  }
  const state = redactToolState(part.state)
  return state === part.state ? part : { ...part, state }
}

export function userPayload(payload: SessionInbox.UserPayload): SessionInbox.UserPayload {
  const text = redactSecrets(payload.text)
  const files = payload.files === undefined ? undefined : mapPreserving(payload.files, redactFile)
  const agents = payload.agents === undefined ? undefined : mapPreserving(payload.agents, redactAgent)
  const skills = payload.skills === undefined ? undefined : mapPreserving(payload.skills, redactSkillAttachment)
  const metadata = payload.metadata === undefined ? undefined : redactValue(payload.metadata)
  if (
    text === payload.text &&
    files === payload.files &&
    agents === payload.agents &&
    skills === payload.skills &&
    metadata === payload.metadata
  )
    return payload
  return { ...payload, text, files, agents, skills, metadata }
}

export function syntheticPayload(payload: SessionInbox.SyntheticPayload): SessionInbox.SyntheticPayload {
  const text = redactSecrets(payload.text)
  const description = payload.description === undefined ? undefined : redactSecrets(payload.description)
  const metadata = payload.metadata === undefined ? undefined : redactValue(payload.metadata)
  if (text === payload.text && description === payload.description && metadata === payload.metadata) return payload
  return { ...payload, text, description, metadata }
}

export function message<T extends SessionMessage.Info | SessionStored.User>(input: T): T {
  const metadata = input.metadata === undefined ? undefined : redactValue(input.metadata)
  if (input.type === "user") {
    const text = redactSecrets(input.text)
    const files = input.files === undefined ? undefined : mapPreserving(input.files, redactFile)
    const agents = input.agents === undefined ? undefined : mapPreserving(input.agents, redactAgent)
    const skills = input.skills === undefined ? undefined : mapPreserving(input.skills, redactSkillAttachment)
    if (
      text === input.text &&
      files === input.files &&
      agents === input.agents &&
      skills === input.skills &&
      metadata === input.metadata
    )
      return input
    return { ...input, text, files, agents, skills, metadata }
  }
  if (input.type === "synthetic" || input.type === "system") {
    const text = redactSecrets(input.text)
    const description = input.description === undefined ? undefined : redactSecrets(input.description)
    if (text === input.text && description === input.description && metadata === input.metadata) return input
    return { ...input, text, description, metadata }
  }
  if (input.type === "skill") {
    const text = redactSecrets(input.text)
    if (text === input.text && metadata === input.metadata) return input
    return { ...input, text, metadata }
  }
  if (input.type === "shell") {
    const command = redactSecrets(input.command)
    const output = input.output
      ? (() => {
          const text = redactSecrets(input.output.output)
          return text === input.output.output ? input.output : { ...input.output, output: text }
        })()
      : undefined
    if (command === input.command && output === input.output && metadata === input.metadata) return input
    return { ...input, command, output, metadata }
  }
  if (input.type === "assistant") {
    const content = mapPreserving(input.content, assistantPart)
    const error = redactError(input.error)
    const retry = input.retry
      ? (() => {
          const retryError = redactError(input.retry.error)!
          return retryError === input.retry.error ? input.retry : { ...input.retry, error: retryError }
        })()
      : undefined
    if (content === input.content && error === input.error && retry === input.retry && metadata === input.metadata)
      return input
    return { ...input, content, error, retry, metadata }
  }
  if (input.type === "compaction") {
    if (input.status === "failed") {
      const error = redactError(input.error)!
      if (error === input.error && metadata === input.metadata) return input
      return { ...input, error, metadata }
    }
    const summary = redactSecrets(input.summary)
    if (summary === input.summary && metadata === input.metadata) return input
    return { ...input, summary, metadata }
  }
  if (input.type === "idle") {
    const error = redactError(input.error)
    if (error === input.error && metadata === input.metadata) return input
    return { ...input, error, metadata }
  }
  return metadata === input.metadata ? input : { ...input, metadata }
}
