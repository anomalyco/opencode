import type { Event, Part, PermissionRequest, QuestionRequest, ToolPart } from "@opencode-ai/sdk/v2"
import * as Locale from "@/util/locale"
import {
  bootstrapSessionData,
  createSessionData,
  formatError,
  reduceSessionData,
  type SessionData,
} from "./session-data"
import type { FooterSubagentState, FooterSubagentTab, StreamCommit } from "./types"

export const SUBAGENT_BOOTSTRAP_LIMIT = 200
export const SUBAGENT_CALL_BOOTSTRAP_LIMIT = 80

const SUBAGENT_COMMIT_LIMIT = 80
const SUBAGENT_CALL_LIMIT = 32
const SUBAGENT_ROLE_LIMIT = 32
const SUBAGENT_ERROR_LIMIT = 16
const SUBAGENT_ECHO_LIMIT = 8

type SessionMessage = {
  parts: Part[]
}

type Frame = {
  key: string
  commit: StreamCommit
}

type DetailState = {
  sessionID: string
  data: SessionData
  frames: Frame[]
}

export type SubagentData = {
  tabs: Map<string, FooterSubagentTab>
  details: Map<string, DetailState>
}

export type BootstrapSubagentInput = {
  data: SubagentData
  messages: SessionMessage[]
  children: Array<{ id: string; title?: string }>
  permissions: PermissionRequest[]
  questions: QuestionRequest[]
}

function createDetail(sessionID: string): DetailState {
  return {
    sessionID,
    data: createSessionData({
      includeUserText: true,
    }),
    frames: [],
  }
}

function ensureDetail(data: SubagentData, sessionID: string) {
  const current = data.details.get(sessionID)
  if (current) {
    return current
  }

  const next = createDetail(sessionID)
  data.details.set(sessionID, next)
  return next
}

export function sameSubagentTab(a: FooterSubagentTab | undefined, b: FooterSubagentTab | undefined) {
  if (!a || !b) {
    return false
  }

  return (
    a.sessionID === b.sessionID &&
    a.partID === b.partID &&
    a.callID === b.callID &&
    a.label === b.label &&
    a.description === b.description &&
    a.status === b.status &&
    a.title === b.title &&
    a.toolCalls === b.toolCalls &&
    a.lastUpdatedAt === b.lastUpdatedAt
  )
}

function sameQueue<T extends { id: string }>(left: T[], right: T[]) {
  return (
    left.length === right.length && left.every((item, index) => item.id === right[index]?.id && item === right[index])
  )
}

function queueSnapshot(data: SessionData) {
  return {
    permissions: data.permissions.slice(),
    questions: data.questions.slice(),
  }
}

function queueChanged(data: SessionData, before: ReturnType<typeof queueSnapshot>) {
  return !sameQueue(before.permissions, data.permissions) || !sameQueue(before.questions, data.questions)
}

function sameCommit(left: StreamCommit, right: StreamCommit) {
  return (
    left.kind === right.kind &&
    left.text === right.text &&
    left.phase === right.phase &&
    left.source === right.source &&
    left.messageID === right.messageID &&
    left.partID === right.partID &&
    left.tool === right.tool &&
    left.interrupted === right.interrupted &&
    left.toolState === right.toolState &&
    left.toolError === right.toolError
  )
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const next = value.trim()
  return next || undefined
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  return undefined
}

function inputLabel(input: Record<string, unknown>): string | undefined {
  const description = text(input.description)
  if (description) {
    return description
  }

  const command = text(input.command)
  if (command) {
    return command
  }

  const filePath = text(input.filePath) ?? text(input.filepath)
  if (filePath) {
    return filePath
  }

  const pattern = text(input.pattern)
  if (pattern) {
    return pattern
  }

  const query = text(input.query)
  if (query) {
    return query
  }

  const url = text(input.url)
  if (url) {
    return url
  }

  const path = text(input.path)
  if (path) {
    return path
  }

  const prompt = text(input.prompt)
  if (prompt) {
    return prompt
  }

  return undefined
}

function stateTitle(part: ToolPart) {
  return text("title" in part.state ? part.state.title : undefined)
}

function callKey(messageID: string | undefined, callID: string | undefined): string | undefined {
  if (!messageID || !callID) {
    return undefined
  }

  return `${messageID}:${callID}`
}

function compactToolState(part: ToolPart): ToolPart["state"] {
  if (part.state.status === "pending") {
    return {
      status: "pending",
      input: part.state.input,
      raw: part.state.raw,
    }
  }

  if (part.state.status === "running") {
    return {
      status: "running",
      input: part.state.input,
      time: part.state.time,
      ...(part.state.metadata ? { metadata: part.state.metadata } : {}),
      ...(part.state.title ? { title: part.state.title } : {}),
    }
  }

  if (part.state.status === "completed") {
    return {
      status: "completed",
      input: part.state.input,
      output: part.state.output,
      title: part.state.title,
      metadata: part.state.metadata,
      time: part.state.time,
    }
  }

  return {
    status: "error",
    input: part.state.input,
    error: part.state.error,
    time: part.state.time,
    ...(part.state.metadata ? { metadata: part.state.metadata } : {}),
  }
}

function recent<T>(input: Iterable<T>, limit: number) {
  const list = [...input]
  return list.slice(Math.max(0, list.length - limit))
}

function copyMap<K, V>(source: Map<K, V>, keep: Set<K>) {
  const out = new Map<K, V>()
  for (const [key, value] of source) {
    if (!keep.has(key)) {
      continue
    }

    out.set(key, value)
  }
  return out
}

function compactToolPart(part: ToolPart): ToolPart {
  return {
    id: part.id,
    type: "tool",
    sessionID: part.sessionID,
    messageID: part.messageID,
    callID: part.callID,
    tool: part.tool,
    state: compactToolState(part),
    ...(part.metadata ? { metadata: part.metadata } : {}),
  }
}

function compactCommit(commit: StreamCommit): StreamCommit {
  if (!commit.part) {
    return commit
  }

  return {
    ...commit,
    part: compactToolPart(commit.part),
  }
}

function stateUpdatedAt(part: ToolPart) {
  if (!("time" in part.state)) {
    return Date.now()
  }

  const time = part.state.time
  if (!("end" in time)) {
    return time.start ?? Date.now()
  }

  return time.end ?? time.start ?? Date.now()
}

function metadata(part: ToolPart, key: string) {
  return ("metadata" in part.state ? part.state.metadata?.[key] : undefined) ?? part.metadata?.[key]
}

function taskTab(part: ToolPart, sessionID: string): FooterSubagentTab {
  const label = Locale.titlecase(text(part.state.input.subagent_type) ?? "general")
  const description = text(part.state.input.description) ?? stateTitle(part) ?? inputLabel(part.state.input) ?? ""
  const status = part.state.status === "error" ? "error" : part.state.status === "completed" ? "completed" : "running"

  return {
    sessionID,
    partID: part.id,
    callID: part.callID,
    label,
    description,
    status,
    title: stateTitle(part),
    toolCalls: num(metadata(part, "toolcalls")) ?? num(metadata(part, "toolCalls")) ?? num(metadata(part, "calls")),
    lastUpdatedAt: stateUpdatedAt(part),
  }
}

function taskSessionID(part: ToolPart) {
  return text(metadata(part, "sessionId")) ?? text(metadata(part, "sessionID"))
}

function syncTaskTab(data: SubagentData, part: ToolPart, children?: Set<string>) {
  if (part.tool !== "task") {
    return false
  }

  const sessionID = taskSessionID(part)
  if (!sessionID) {
    return false
  }

  if (children && children.size > 0 && !children.has(sessionID)) {
    return false
  }

  const next = taskTab(part, sessionID)
  if (sameSubagentTab(data.tabs.get(sessionID), next)) {
    ensureDetail(data, sessionID)
    return false
  }

  data.tabs.set(sessionID, next)
  ensureDetail(data, sessionID)
  return true
}

function frameKey(commit: StreamCommit) {
  if (commit.partID) {
    return `${commit.kind}:${commit.partID}:${commit.phase}`
  }

  if (commit.messageID) {
    return `${commit.kind}:${commit.messageID}:${commit.phase}`
  }

  return `${commit.kind}:${commit.phase}:${commit.text}`
}

function limitFrames(detail: DetailState) {
  if (detail.frames.length <= SUBAGENT_COMMIT_LIMIT) {
    return
  }

  detail.frames.splice(0, detail.frames.length - SUBAGENT_COMMIT_LIMIT)
}

function mergeLiveCommit(current: StreamCommit, next: StreamCommit) {
  if (current.phase !== "progress" || next.phase !== "progress") {
    if (sameCommit(current, next)) {
      return current
    }

    return next
  }

  const merged = {
    ...current,
    ...next,
    text: current.text + next.text,
  }

  if (sameCommit(current, merged)) {
    return current
  }

  return merged
}

function appendCommits(detail: DetailState, commits: StreamCommit[]) {
  let changed = false

  for (const commit of commits.map(compactCommit)) {
    const key = frameKey(commit)
    const index = detail.frames.findIndex((item) => item.key === key)
    if (index === -1) {
      detail.frames.push({
        key,
        commit,
      })
      changed = true
      continue
    }

    const next = mergeLiveCommit(detail.frames[index].commit, commit)
    if (sameCommit(detail.frames[index].commit, next)) {
      continue
    }

    detail.frames[index] = {
      key,
      commit: next,
    }
    changed = true
  }

  if (changed) {
    limitFrames(detail)
  }

  return changed
}

function ensureBlockerTab(
  data: SubagentData,
  sessionID: string,
  title: string | undefined,
  kind: "permission" | "question",
) {
  if (data.tabs.has(sessionID)) {
    ensureDetail(data, sessionID)
    return false
  }

  data.tabs.set(sessionID, {
    sessionID,
    partID: `bootstrap:${sessionID}`,
    callID: `bootstrap:${sessionID}`,
    label: text(title) ?? Locale.titlecase(kind),
    description: kind === "permission" ? "Pending permission" : "Pending question",
    status: "running",
    lastUpdatedAt: Date.now(),
  })
  ensureDetail(data, sessionID)
  return true
}

function compactCallMap(detail: DetailState) {
  const keep = new Set(recent(detail.data.call.keys(), SUBAGENT_CALL_LIMIT))

  for (const request of detail.data.permissions) {
    const key = callKey(request.tool?.messageID, request.tool?.callID)
    if (key) {
      keep.add(key)
    }
  }

  for (const item of detail.frames) {
    const key = callKey(item.commit.part?.messageID, item.commit.part?.callID)
    if (key) {
      keep.add(key)
    }
  }

  return copyMap(detail.data.call, keep)
}

function compactEchoMap(data: SessionData, messageIDs: Set<string>) {
  const keys = new Set([...messageIDs, ...recent(data.echo.keys(), SUBAGENT_ECHO_LIMIT)])
  return copyMap(data.echo, keys)
}

function compactIDs(detail: DetailState) {
  return new Set(recent(detail.data.ids, SUBAGENT_COMMIT_LIMIT + SUBAGENT_ERROR_LIMIT))
}

function compactDetail(detail: DetailState) {
  const next = createSessionData({
    includeUserText: true,
  })
  const activePartIDs = new Set(detail.data.part.keys())
  const framePartIDs = new Set(detail.frames.flatMap((item) => (item.commit.partID ? [item.commit.partID] : [])))
  const partIDs = new Set([...activePartIDs, ...framePartIDs, ...detail.data.tools])
  const messageIDs = new Set([
    ...[...activePartIDs]
      .map((partID) => detail.data.msg.get(partID))
      .filter((item): item is string => typeof item === "string"),
    ...recent(detail.data.role.keys(), SUBAGENT_ROLE_LIMIT),
  ])

  next.announced = detail.data.announced
  next.permissions = detail.data.permissions
  next.questions = detail.data.questions
  next.ids = compactIDs(detail)
  next.tools = new Set([...detail.data.tools].filter((item) => partIDs.has(item)))
  next.call = compactCallMap(detail)
  next.role = copyMap(detail.data.role, messageIDs)
  next.msg = copyMap(detail.data.msg, activePartIDs)
  next.part = copyMap(detail.data.part, activePartIDs)
  next.text = copyMap(detail.data.text, activePartIDs)
  next.sent = copyMap(detail.data.sent, activePartIDs)
  next.end = new Set([...detail.data.end].filter((item) => activePartIDs.has(item)))
  next.echo = compactEchoMap(detail.data, messageIDs)
  detail.data = next
}

function applyChildEvent(input: {
  detail: DetailState
  event: Event
  thinking: boolean
  limits: Record<string, number>
}) {
  const before = queueSnapshot(input.detail.data)
  const out = reduceSessionData({
    data: input.detail.data,
    event: input.event,
    sessionID: input.detail.sessionID,
    thinking: input.thinking,
    limits: input.limits,
  })
  const changed = appendCommits(input.detail, out.commits)
  compactDetail(input.detail)

  return changed || queueChanged(input.detail.data, before)
}

function knownSession(data: SubagentData, sessionID: string) {
  return data.tabs.has(sessionID)
}

export function listSubagentPermissions(data: SubagentData) {
  return [...data.details.values()].flatMap((detail) => detail.data.permissions)
}

export function listSubagentQuestions(data: SubagentData) {
  return [...data.details.values()].flatMap((detail) => detail.data.questions)
}

export function createSubagentData(): SubagentData {
  return {
    tabs: new Map(),
    details: new Map(),
  }
}

function snapshotDetail(detail: DetailState) {
  return {
    sessionID: detail.sessionID,
    commits: detail.frames.map((item) => item.commit),
  }
}

export function listSubagentTabs(data: SubagentData) {
  return [...data.tabs.values()].sort((a, b) => {
    const active = Number(b.status === "running") - Number(a.status === "running")
    if (active !== 0) {
      return active
    }

    return b.lastUpdatedAt - a.lastUpdatedAt
  })
}

function snapshotQueues(data: SubagentData) {
  return {
    permissions: listSubagentPermissions(data).sort((a, b) => a.id.localeCompare(b.id)),
    questions: listSubagentQuestions(data).sort((a, b) => a.id.localeCompare(b.id)),
  }
}

function snapshotState(data: SubagentData, details: FooterSubagentState["details"]): FooterSubagentState {
  return {
    tabs: listSubagentTabs(data),
    details,
    ...snapshotQueues(data),
  }
}

export function snapshotSubagentData(data: SubagentData): FooterSubagentState {
  return snapshotState(
    data,
    Object.fromEntries([...data.details.entries()].map(([sessionID, detail]) => [sessionID, snapshotDetail(detail)])),
  )
}

export function snapshotSelectedSubagentData(
  data: SubagentData,
  selectedSessionID: string | undefined,
): FooterSubagentState {
  const detail = selectedSessionID ? data.details.get(selectedSessionID) : undefined

  return snapshotState(data, detail ? { [detail.sessionID]: snapshotDetail(detail) } : {})
}

export function bootstrapSubagentData(input: BootstrapSubagentInput) {
  const child = new Map(input.children.map((item) => [item.id, item]))
  const children = new Set(child.keys())
  let changed = false

  for (const message of input.messages) {
    for (const part of message.parts) {
      if (part.type !== "tool") {
        continue
      }

      changed = syncTaskTab(input.data, part, children) || changed
    }
  }

  for (const item of input.permissions) {
    if (!children.has(item.sessionID)) {
      continue
    }

    changed = ensureBlockerTab(input.data, item.sessionID, child.get(item.sessionID)?.title, "permission") || changed
  }

  for (const item of input.questions) {
    if (!children.has(item.sessionID)) {
      continue
    }

    changed = ensureBlockerTab(input.data, item.sessionID, child.get(item.sessionID)?.title, "question") || changed
  }

  for (const sessionID of input.data.tabs.keys()) {
    const detail = ensureDetail(input.data, sessionID)
    const before = queueSnapshot(detail.data)

    bootstrapSessionData({
      data: detail.data,
      messages: [],
      permissions: input.permissions
        .filter((item) => item.sessionID === sessionID)
        .sort((a, b) => a.id.localeCompare(b.id)),
      questions: input.questions
        .filter((item) => item.sessionID === sessionID)
        .sort((a, b) => a.id.localeCompare(b.id)),
    })
    compactDetail(detail)

    changed = queueChanged(detail.data, before) || changed
  }

  return changed
}

export function bootstrapSubagentCalls(input: { data: SubagentData; sessionID: string; messages: SessionMessage[] }) {
  if (!knownSession(input.data, input.sessionID) || input.messages.length === 0) {
    return false
  }

  const detail = ensureDetail(input.data, input.sessionID)
  const before = queueSnapshot(detail.data)
  const beforeCallCount = detail.data.call.size
  bootstrapSessionData({
    data: detail.data,
    messages: input.messages,
    permissions: detail.data.permissions,
    questions: detail.data.questions,
  })
  compactDetail(detail)

  return beforeCallCount !== detail.data.call.size || queueChanged(detail.data, before)
}

export function clearFinishedSubagents(data: SubagentData) {
  let changed = false

  for (const [sessionID, tab] of data.tabs.entries()) {
    if (tab.status === "running") {
      continue
    }

    data.tabs.delete(sessionID)
    data.details.delete(sessionID)
    changed = true
  }

  return changed
}

export function reduceSubagentData(input: {
  data: SubagentData
  event: Event
  sessionID: string
  thinking: boolean
  limits: Record<string, number>
}) {
  const event = input.event

  if (event.type === "message.part.updated") {
    const part = event.properties.part
    if (part.sessionID === input.sessionID) {
      if (part.type !== "tool") {
        return false
      }

      return syncTaskTab(input.data, part)
    }
  }

  const sessionID =
    event.type === "message.updated" ||
    event.type === "message.part.delta" ||
    event.type === "permission.asked" ||
    event.type === "permission.replied" ||
    event.type === "question.asked" ||
    event.type === "question.replied" ||
    event.type === "question.rejected" ||
    event.type === "session.error" ||
    event.type === "session.status"
      ? event.properties.sessionID
      : event.type === "message.part.updated"
        ? event.properties.part.sessionID
        : undefined

  if (!sessionID || !knownSession(input.data, sessionID)) {
    return false
  }

  const detail = ensureDetail(input.data, sessionID)
  if (event.type === "session.status") {
    if (event.properties.status.type !== "retry") {
      return false
    }

    return appendCommits(detail, [
      {
        kind: "error",
        text: event.properties.status.message,
        phase: "start",
        source: "system",
        messageID: `retry:${event.properties.status.attempt}`,
      },
    ])
  }

  if (event.type === "session.error" && event.properties.error) {
    return appendCommits(detail, [
      {
        kind: "error",
        text: formatError(event.properties.error),
        phase: "start",
        source: "system",
        messageID: `session.error:${event.properties.sessionID}:${formatError(event.properties.error)}`,
      },
    ])
  }

  return applyChildEvent({
    detail,
    event,
    thinking: input.thinking,
    limits: input.limits,
  })
}
