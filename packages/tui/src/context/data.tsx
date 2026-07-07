import type {
  AgentV2Info,
  CommandV2Info,
  FormFormInfo,
  FormUrlInfo,
  IntegrationInfo,
  LocationRef,
  McpServer,
  ModelV2Info,
  PermissionSavedInfo,
  PermissionV2Request,
  ProviderV2Info,
  ReferenceInfo,
  SessionMessage,
  SessionMessageAssistant,
  SessionMessageAssistantReasoning,
  SessionMessageAssistantText,
  SessionMessageAssistantTool,
  SessionV2Info,
  Shell,
  SkillV2Info,
  V2Event,
} from "@opencode-ai/sdk/v2"
import { createStore, produce, reconcile } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { useSDK } from "./sdk"
import { createSignal, onCleanup } from "solid-js"

export type DataSessionStatus = "idle" | "running"

const messageIDFromEvent = (eventID: string) => eventID.replace(/^evt_/, "msg_")

export type FormInfo = FormFormInfo | FormUrlInfo

type LocationData = {
  agent?: AgentV2Info[]
  command?: CommandV2Info[]
  integration?: IntegrationInfo[]
  mcp?: McpServer[]
  model?: ModelV2Info[]
  provider?: ProviderV2Info[]
  reference?: ReferenceInfo[]
  // Currently running shell commands for this location, keyed by shell id. Entries are removed
  // once the command exits or is deleted, so this only ever holds in-flight shells.
  shell?: Record<string, Shell>
  skill?: SkillV2Info[]
}

type Data = {
  session: {
    info: Record<string, SessionV2Info>
    // Family index keyed by a family's root (or furthest-known-ancestor when the
    // true root is not yet loaded). The value is a flat deduplicated list of every
    // session ID in that family, including the key itself once its info arrives.
    family: Record<string, string[]>
    status: Record<string, DataSessionStatus>
    compaction: Partial<Record<string, string>>
    compactionReason: Partial<Record<string, "auto" | "manual">>
    message: Record<string, SessionMessage[]>
    input: Record<string, string[]>
    permission: Record<string, PermissionV2Request[]>
    // Pending forms keyed by session ID.
    form: Record<string, FormInfo[]>
  }
  project: {
    permission: Record<string, PermissionSavedInfo[]>
  }
  location: Record<string, LocationData>
}

function locationKey(location: LocationRef) {
  return JSON.stringify([location.directory, location.workspaceID])
}

function locationQuery(ref?: LocationRef) {
  return ref ? { directory: ref.directory, workspace: ref.workspaceID } : undefined
}

type Mutable<T> =
  T extends ReadonlyArray<infer U> ? Mutable<U>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T

function mutable<T>(value: T): Mutable<T> {
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- generated client data is readonly; the TUI store mutates cloned state.
  return structuredClone(value) as Mutable<T>
}

export const { use: useData, provider: DataProvider } = createSimpleContext({
  name: "Data",
  init: () => {
    const [store, setStore] = createStore<Data>({
      session: {
        info: {},
        family: {},
        status: {},
        compaction: {},
        compactionReason: {},
        message: {},
        input: {},
        permission: {},
        form: {},
      },
      project: {
        permission: {},
      },
      location: {},
    })

    const sdk = useSDK()
    const [defaultLocation, setDefaultLocation] = createSignal<LocationRef>({
      directory: process.cwd(),
    })
    const messageIndex = new Map<string, Map<string, number>>()
    const sessionRefreshGeneration = new Map<string, number>()
    const sessionRefreshApplied = new Map<string, number>()
    const sessionUsage = new Map<string, { generation: number; cost: number; tokens: SessionV2Info["tokens"] }>()
    let connectionGeneration = 0
    let statusChanges: Set<string> | undefined
    let bootstrapping: Promise<void> | undefined

    function setSessionStatus(sessionID: string, status: DataSessionStatus) {
      statusChanges?.add(sessionID)
      setStore("session", "status", sessionID, status)
    }

    function nextSessionRefresh(sessionID: string) {
      const generation = (sessionRefreshGeneration.get(sessionID) ?? 0) + 1
      sessionRefreshGeneration.set(sessionID, generation)
      return generation
    }

    function applySessionRefresh(sessionID: string, generation: number) {
      if ((sessionRefreshApplied.get(sessionID) ?? 0) > generation) return false
      sessionRefreshApplied.set(sessionID, generation)
      return true
    }

    function updateSessionUsage(sessionID: string, cost: number, tokens: SessionV2Info["tokens"]) {
      sessionUsage.set(sessionID, { generation: (sessionUsage.get(sessionID)?.generation ?? 0) + 1, cost, tokens })
      if (!store.session.info[sessionID]) return
      setStore("session", "info", sessionID, { cost, tokens })
    }

    const message = {
      update(sessionID: string, fn: (messages: SessionMessage[], index: Map<string, number>) => void) {
        setStore(
          "session",
          "message",
          produce((draft) => {
            fn((draft[sessionID] ??= []), index(sessionID))
          }),
        )
      },
      append(messages: SessionMessage[], index: Map<string, number>, item: SessionMessage) {
        if (index.has(item.id)) return
        index.set(item.id, messages.length)
        messages.push(item)
      },
      activeAssistant(messages: SessionMessage[]) {
        const item = messages.findLast((item) => item.type === "assistant" && !item.time.completed)
        return item?.type === "assistant" ? item : undefined
      },
      assistant(messages: SessionMessage[], index: Map<string, number>, messageID: string) {
        const position = index.get(messageID)
        const item = position === undefined ? undefined : messages[position]
        return item?.type === "assistant" ? item : undefined
      },
      shell(messages: SessionMessage[], shellID: string) {
        const item = messages.findLast((item) => item.type === "shell" && item.shell.id === shellID)
        return item?.type === "shell" ? item : undefined
      },
      compaction(messages: SessionMessage[]) {
        const item = messages.findLast(
          (item) => item.type === "compaction" && (item.status === "queued" || item.status === "running"),
        )
        return item?.type === "compaction" ? item : undefined
      },
      latestTool(assistant: SessionMessageAssistant | undefined, callID?: string) {
        return assistant?.content.findLast(
          (item): item is SessionMessageAssistantTool =>
            item.type === "tool" && (callID === undefined || item.id === callID),
        )
      },
      latestText(assistant: SessionMessageAssistant | undefined) {
        return assistant?.content.findLast((item): item is SessionMessageAssistantText => item.type === "text")
      },
      latestReasoning(assistant: SessionMessageAssistant | undefined) {
        return assistant?.content.findLast(
          (item): item is SessionMessageAssistantReasoning => item.type === "reasoning" && !item.time?.completed,
        )
      },
    }

    function index(sessionID: string) {
      const existing = messageIndex.get(sessionID)
      if (existing) return existing
      const created = new Map<string, number>()
      messageIndex.set(sessionID, created)
      return created
    }

    // Walk parentID upward through loaded session info to the family root. When a
    // parent's info is missing, that missing ID is the furthest-known ancestor and
    // is returned so orphan subtrees group under it until the parent arrives. A
    // seen set guards against parent cycles, stopping at the last non-repeating
    // ancestor.
    function resolveRoot(sessionID: string) {
      let current = sessionID
      let parentID = store.session.info[sessionID]?.parentID
      const seen = new Set([sessionID])
      while (parentID) {
        if (seen.has(parentID)) break
        seen.add(parentID)
        current = parentID
        parentID = store.session.info[parentID]?.parentID
      }
      return current
    }

    // Register one session into the family index. Idempotent: refreshing an
    // existing session never duplicates its ID. When a tentative family keyed by
    // sessionID exists (descendants arrived while sessionID's own info was
    // absent) but sessionID turns out to have a parent, fold the orphan subtree
    // into the resolved root's family and drop the tentative entry.
    function registerSession(sessionID: string) {
      const info = store.session.info[sessionID]
      if (!info) return
      const rootID = resolveRoot(sessionID)
      setStore(
        "session",
        "family",
        produce((draft) => {
          if (sessionID !== rootID && draft[sessionID]) {
            const members = (draft[rootID] ??= [])
            for (const id of draft[sessionID]) {
              if (!members.includes(id)) members.push(id)
            }
            delete draft[sessionID]
          }
          const family = (draft[rootID] ??= [])
          if (!family.includes(sessionID)) family.push(sessionID)
        }),
      )
    }

    function removeSession(sessionID: string) {
      sessionRefreshApplied.set(sessionID, nextSessionRefresh(sessionID))
      sessionUsage.delete(sessionID)
      messageIndex.delete(sessionID)
      setStore(
        "session",
        produce((draft) => {
          delete draft.info[sessionID]
          delete draft.status[sessionID]
          delete draft.compaction[sessionID]
          delete draft.message[sessionID]
          delete draft.input[sessionID]
          delete draft.permission[sessionID]
          delete draft.form[sessionID]
          for (const [rootID, family] of Object.entries(draft.family)) {
            const next = family.filter((id) => id !== sessionID)
            if (next.length === 0) delete draft.family[rootID]
            else draft.family[rootID] = next
          }
        }),
      )
    }

    function handleEvent(event: V2Event) {
      switch (event.type) {
        case "session.created":
          void result.session.refresh(event.data.sessionID)
          break
        case "session.deleted":
          removeSession(event.data.sessionID)
          break
        case "session.usage.updated":
          updateSessionUsage(event.data.sessionID, event.data.cost, event.data.tokens)
          break
        case "catalog.updated":
          void Promise.all([
            result.location.model.refresh(event.location),
            result.location.provider.refresh(event.location),
          ])
          break
        case "agent.updated":
          void result.location.agent.refresh(event.location)
          break
        case "command.updated":
          void result.location.command.refresh(event.location)
          break
        case "skill.updated":
          void result.location.skill.refresh(event.location)
          break
        case "session.agent.selected":
          if (store.session.info[event.data.sessionID])
            setStore("session", "info", event.data.sessionID, "agent", event.data.agent)
          message.update(event.data.sessionID, (draft, index) => {
            message.append(draft, index, {
              id: messageIDFromEvent(event.id),
              type: "agent-switched",
              agent: event.data.agent,
              time: { created: event.created },
            })
          })
          break
        case "session.model.selected":
          if (store.session.info[event.data.sessionID])
            setStore("session", "info", event.data.sessionID, "model", event.data.model)
          if (!store.session.message[event.data.sessionID]) break
          message.update(event.data.sessionID, (draft, index) => {
            message.append(draft, index, {
              id: messageIDFromEvent(event.id),
              type: "model-switched",
              model: event.data.model,
              time: { created: event.created },
            })
          })
          void sdk.api.session
            .message({ sessionID: event.data.sessionID, messageID: messageIDFromEvent(event.id) })
            .then((item) => {
              message.update(event.data.sessionID, (draft, index) => {
                const position = index.get(item.id)
                if (position === undefined) return message.append(draft, index, mutable(item))
                draft[position] = mutable(item)
              })
            })
            .catch((error) => console.error("Failed to load projected model switch message", error))
          break
        case "session.renamed":
          if (store.session.info[event.data.sessionID])
            setStore("session", "info", event.data.sessionID, "title", event.data.title)
          break
        case "session.moved":
          if (store.session.info[event.data.sessionID]) {
            setStore("session", "info", event.data.sessionID, "location", mutable(event.data.location))
            setStore("session", "info", event.data.sessionID, "subpath", event.data.subpath)
          }
          break
        case "session.prompt.promoted": {
          message.update(event.data.sessionID, (draft, index) => {
            const position = index.get(event.data.inputID)
            if (position === undefined) return
            const existing = draft[position]
            if (existing?.type === "user" && store.session.input[event.data.sessionID]?.includes(event.data.inputID)) {
              existing.time.created = event.created
              draft.splice(position, 1)
              draft.push(existing)
              index.clear()
              draft.forEach((message, indexValue) => index.set(message.id, indexValue))
              return
            }
          })
          setStore(
            "session",
            "input",
            event.data.sessionID,
            (store.session.input[event.data.sessionID] ?? []).filter((id) => id !== event.data.inputID),
          )
          break
        }
        case "session.prompt.admitted":
          if (!store.session.input[event.data.sessionID]?.includes(event.data.inputID))
            setStore("session", "input", event.data.sessionID, [
              ...(store.session.input[event.data.sessionID] ?? []),
              event.data.inputID,
            ])
          message.update(event.data.sessionID, (draft, index) => {
            message.append(draft, index, {
              id: event.data.inputID,
              type: "user",
              text: event.data.prompt.text,
              files: event.data.prompt.files,
              agents: event.data.prompt.agents,
              time: { created: event.created },
            })
          })
          break
        case "session.instructions.updated":
          message.update(event.data.sessionID, (draft, index) => {
            message.append(draft, index, {
              id: messageIDFromEvent(event.id),
              type: "system",
              text: event.data.text,
              time: { created: event.created },
            })
          })
          break
        case "session.synthetic":
          message.update(event.data.sessionID, (draft, index) => {
            message.append(draft, index, {
              id: messageIDFromEvent(event.id),
              type: "synthetic",
              sessionID: event.data.sessionID,
              text: event.data.text,
              description: event.data.description,
              time: { created: event.created },
            })
          })
          break
        case "session.shell.started":
          message.update(event.data.sessionID, (draft, index) => {
            message.append(draft, index, {
              id: messageIDFromEvent(event.id),
              type: "shell",
              shell: event.data.shell,
              time: { created: event.created },
            })
          })
          break
        case "session.shell.ended":
          message.update(event.data.sessionID, (draft) => {
            const match = message.shell(draft, event.data.shell.id)
            if (!match) return
            match.shell = event.data.shell
            match.output = event.data.output
            match.time.completed = event.created
          })
          break
        case "session.step.started":
          message.update(event.data.sessionID, (draft, index) => {
            const position = index.get(event.data.assistantMessageID)
            const existing = position === undefined ? undefined : draft[position]
            if (existing?.type === "assistant") {
              existing.agent = event.data.agent
              existing.model = event.data.model
              existing.retry = undefined
              existing.error = undefined
              existing.finish = undefined
              existing.time.completed = undefined
              if (event.data.snapshot) existing.snapshot = { ...existing.snapshot, start: event.data.snapshot }
              return
            }
            const currentAssistant = message.activeAssistant(draft)
            if (currentAssistant) {
              currentAssistant.retry = undefined
              currentAssistant.time.completed = event.created
            }
            message.append(draft, index, {
              id: event.data.assistantMessageID,
              type: "assistant",
              agent: event.data.agent,
              model: event.data.model,
              content: [],
              snapshot: event.data.snapshot ? { start: event.data.snapshot } : undefined,
              time: { created: event.created },
            })
          })
          break
        case "session.step.ended": {
          message.update(event.data.sessionID, (draft, index) => {
            const currentAssistant = message.assistant(draft, index, event.data.assistantMessageID)
            if (!currentAssistant) return
            currentAssistant.time.completed = event.created
            currentAssistant.finish = event.data.finish
            currentAssistant.cost = event.data.cost
            currentAssistant.tokens = event.data.tokens
            if (event.data.snapshot)
              currentAssistant.snapshot = { ...currentAssistant.snapshot, end: event.data.snapshot }
          })
          break
        }
        case "session.step.failed":
          message.update(event.data.sessionID, (draft, index) => {
            const currentAssistant = message.assistant(draft, index, event.data.assistantMessageID)
            if (!currentAssistant) return
            currentAssistant.time.completed = event.created
            currentAssistant.finish = "error"
            currentAssistant.error = event.data.error
            currentAssistant.retry = undefined
            if (event.data.cost !== undefined && event.data.tokens !== undefined) {
              currentAssistant.cost = event.data.cost
              currentAssistant.tokens = event.data.tokens
            }
          })
          break
        case "session.text.started":
          message.update(event.data.sessionID, (draft, index) => {
            message.assistant(draft, index, event.data.assistantMessageID)?.content.push({
              type: "text",
              text: "",
            })
          })
          break
        case "session.text.delta":
          message.update(event.data.sessionID, (draft, index) => {
            const match = message.latestText(message.assistant(draft, index, event.data.assistantMessageID))
            if (match) match.text += event.data.delta
          })
          break
        case "session.text.ended":
          message.update(event.data.sessionID, (draft, index) => {
            const match = message.latestText(message.assistant(draft, index, event.data.assistantMessageID))
            if (match) match.text = event.data.text
          })
          break
        case "session.tool.input.started":
          message.update(event.data.sessionID, (draft, index) => {
            message.assistant(draft, index, event.data.assistantMessageID)?.content.push({
              type: "tool",
              id: event.data.callID,
              name: event.data.name,
              time: { created: event.created },
              state: { status: "pending", input: "" },
            })
          })
          break
        case "session.tool.input.delta":
          message.update(event.data.sessionID, (draft, index) => {
            const match = message.latestTool(
              message.assistant(draft, index, event.data.assistantMessageID),
              event.data.callID,
            )
            if (match?.state.status === "pending") match.state.input += event.data.delta
          })
          break
        case "session.tool.input.ended":
          message.update(event.data.sessionID, (draft, index) => {
            const match = message.latestTool(
              message.assistant(draft, index, event.data.assistantMessageID),
              event.data.callID,
            )
            if (match?.state.status === "pending") match.state.input = event.data.text
          })
          break
        case "session.tool.called":
          message.update(event.data.sessionID, (draft, index) => {
            const match = message.latestTool(
              message.assistant(draft, index, event.data.assistantMessageID),
              event.data.callID,
            )
            if (!match) return
            match.time.ran = event.created
            match.executed = event.data.executed
            match.providerState = event.data.state
            match.state = { status: "running", input: event.data.input, structured: {}, content: [] }
          })
          break
        case "session.tool.progress":
          message.update(event.data.sessionID, (draft, index) => {
            const match = message.latestTool(
              message.assistant(draft, index, event.data.assistantMessageID),
              event.data.callID,
            )
            if (match?.state.status !== "running") return
            match.state.structured = event.data.structured
            match.state.content = [...event.data.content]
          })
          break
        case "session.tool.success":
          message.update(event.data.sessionID, (draft, index) => {
            const match = message.latestTool(
              message.assistant(draft, index, event.data.assistantMessageID),
              event.data.callID,
            )
            if (match?.state.status !== "running") return
            match.state = {
              status: "completed",
              input: match.state.input,
              structured: event.data.structured,
              content: [...event.data.content],
              result: event.data.result,
            }
            match.executed = event.data.executed || match.executed === true
            match.providerResultState = event.data.resultState
            match.time.completed = event.created
          })
          break
        case "session.tool.failed":
          message.update(event.data.sessionID, (draft, index) => {
            const match = message.latestTool(
              message.assistant(draft, index, event.data.assistantMessageID),
              event.data.callID,
            )
            if (!match || (match.state.status !== "pending" && match.state.status !== "running")) return
            match.state = {
              status: "error",
              error: event.data.error,
              input: typeof match.state.input === "string" ? {} : match.state.input,
              structured: match.state.status === "running" ? match.state.structured : {},
              content: match.state.status === "running" ? match.state.content : [],
              result: event.data.result,
            }
            match.executed = event.data.executed || match.executed === true
            match.providerResultState = event.data.resultState
            match.time.completed = event.created
          })
          break
        case "session.reasoning.started":
          message.update(event.data.sessionID, (draft, index) => {
            message.assistant(draft, index, event.data.assistantMessageID)?.content.push({
              type: "reasoning",
              text: "",
              state: event.data.state,
              time: { created: event.created },
            })
          })
          break
        case "session.reasoning.delta":
          message.update(event.data.sessionID, (draft, index) => {
            const match = message.latestReasoning(message.assistant(draft, index, event.data.assistantMessageID))
            if (match) match.text += event.data.delta
          })
          break
        case "session.reasoning.ended":
          message.update(event.data.sessionID, (draft, index) => {
            const match = message.latestReasoning(message.assistant(draft, index, event.data.assistantMessageID))
            if (match) {
              match.text = event.data.text
              match.time = { created: match.time?.created ?? event.created, completed: event.created }
              if (event.data.state !== undefined) match.state = event.data.state
            }
          })
          break
        case "session.retry.scheduled":
          message.update(event.data.sessionID, (draft, index) => {
            const currentAssistant = message.assistant(draft, index, event.data.assistantMessageID)
            if (!currentAssistant) return
            currentAssistant.retry = {
              attempt: event.data.attempt,
              at: event.data.at,
              error: event.data.error,
            }
          })
          break
        case "session.execution.started":
          setSessionStatus(event.data.sessionID, "running")
          break
        case "session.compaction.admitted":
          message.update(event.data.sessionID, (draft, index) => {
            if (message.compaction(draft)) return
            message.append(draft, index, {
              id: event.data.inputID,
              type: "compaction",
              status: "queued",
              reason: "manual",
              summary: "",
              recent: "",
              time: { created: event.created },
            })
          })
          break
        case "session.compaction.started":
          setStore("session", "compaction", event.data.sessionID, "")
          setStore("session", "compactionReason", event.data.sessionID, event.data.reason)
          if (event.data.reason === "manual")
            message.update(event.data.sessionID, (draft) => {
              const current = message.compaction(draft)
              if (current) current.status = "running"
            })
          break
        case "session.execution.succeeded":
        case "session.execution.failed":
        case "session.execution.interrupted":
          setSessionStatus(event.data.sessionID, "idle")
          if (store.session.compaction[event.data.sessionID] !== undefined)
            setStore("session", "compaction", event.data.sessionID, undefined)
          if (store.session.compactionReason[event.data.sessionID] !== undefined)
            setStore("session", "compactionReason", event.data.sessionID, undefined)
          message.update(event.data.sessionID, (draft) => {
            const currentAssistant = message.activeAssistant(draft)
            if (currentAssistant) currentAssistant.retry = undefined
          })
          break
        case "session.revert.staged":
          if (store.session.info[event.data.sessionID])
            setStore("session", "info", event.data.sessionID, "revert", event.data.revert)
          break
        case "session.revert.cleared":
          if (store.session.info[event.data.sessionID])
            setStore("session", "info", event.data.sessionID, "revert", undefined)
          break
        case "session.revert.committed":
          if (store.session.info[event.data.sessionID]) {
            setStore("session", "info", event.data.sessionID, "revert", undefined)
          }
          setStore(
            "session",
            "input",
            event.data.sessionID,
            (store.session.input[event.data.sessionID] ?? []).filter((id) => id < event.data.to),
          )
          message.update(event.data.sessionID, (draft, index) => {
            const position = draft.findIndex((item) => item.id >= event.data.to)
            if (position === -1) return
            for (const item of draft.splice(position)) index.delete(item.id)
          })
          break
        case "session.compaction.delta":
          setStore("session", "compaction", event.data.sessionID, (text) => (text ?? "") + event.data.text)
          if (store.session.compactionReason[event.data.sessionID] === "manual")
            message.update(event.data.sessionID, (draft) => {
              const current = message.compaction(draft)
              if (current) current.summary += event.data.text
            })
          break
        case "session.compaction.ended":
          setStore("session", "compaction", event.data.sessionID, undefined)
          setStore("session", "compactionReason", event.data.sessionID, undefined)
          message.update(event.data.sessionID, (draft, index) => {
            const current = event.data.reason === "manual" ? message.compaction(draft) : undefined
            if (current) {
              current.status = "completed"
              current.reason = event.data.reason
              current.summary = event.data.text
              current.recent = event.data.recent
              return
            }
            message.append(draft, index, {
              id: messageIDFromEvent(event.id),
              type: "compaction",
              status: "completed",
              reason: event.data.reason,
              summary: event.data.text,
              recent: event.data.recent,
              time: { created: event.created },
            })
          })
          break
        case "session.compaction.failed":
          setStore("session", "compaction", event.data.sessionID, undefined)
          setStore("session", "compactionReason", event.data.sessionID, undefined)
          message.update(event.data.sessionID, (draft) => {
            const current = message.compaction(draft)
            if (current) current.status = "failed"
          })
          break
        case "permission.v2.asked":
          if (store.session.permission[event.data.sessionID]?.some((request) => request.id === event.data.id)) break
          setStore("session", "permission", event.data.sessionID, [
            ...(store.session.permission[event.data.sessionID] ?? []),
            event.data,
          ])
          break
        case "permission.v2.replied":
          setStore(
            "session",
            "permission",
            event.data.sessionID,
            (store.session.permission[event.data.sessionID] ?? []).filter(
              (request) => request.id !== event.data.requestID,
            ),
          )
          break
        case "form.created":
          if (store.session.form[event.data.form.sessionID]?.some((form) => form.id === event.data.form.id)) break
          setStore("session", "form", event.data.form.sessionID, [
            ...(store.session.form[event.data.form.sessionID] ?? []),
            mutable(event.data.form),
          ])
          break
        case "form.replied":
        case "form.cancelled":
          setStore(
            "session",
            "form",
            event.data.sessionID,
            (store.session.form[event.data.sessionID] ?? []).filter((form) => form.id !== event.data.id),
          )
          break
        case "shell.created":
          setStore("location", locationKey(event.location ?? defaultLocation()), (data) => ({
            ...data,
            shell: { ...data?.shell, [event.data.info.id]: event.data.info },
          }))
          break
        case "shell.exited":
        case "shell.deleted":
          if (event.location) {
            setStore("location", locationKey(event.location), (data) => ({
              ...data,
              shell: Object.fromEntries(Object.entries(data?.shell ?? {}).filter(([id]) => id !== event.data.id)),
            }))
            break
          }
          setStore(
            "location",
            produce((draft) => {
              for (const data of Object.values(draft)) delete data.shell?.[event.data.id]
            }),
          )
          break
        case "reference.updated":
          void result.location.reference.refresh()
          break
        case "integration.updated":
          void Promise.all([
            result.location.integration.refresh(event.location),
            result.location.model.refresh(event.location),
            result.location.provider.refresh(event.location),
          ])
          break
        // Authenticating an MCP integration reconnects its server, which emits mcp.status.changed,
        // so the mcp list refreshes here rather than off integration.updated.
        case "mcp.status.changed":
          if (bootstrapping) break
          void result.location.mcp.refresh(event.location)
          break
      }
    }

    const result = {
      on: sdk.event.on,
      listen: sdk.event.listen,
      connection: {
        status() {
          return sdk.connection.status()
        },
        attempt() {
          return sdk.connection.attempt()
        },
        error() {
          return sdk.connection.error()
        },
        connectedOnce() {
          return sdk.connection.connectedOnce()
        },
      },
      session: {
        list() {
          return Object.values(store.session.info).toSorted((a, b) => b.time.updated - a.time.updated)
        },
        get(sessionID: string) {
          return store.session.info[sessionID]
        },
        root(sessionID: string) {
          return resolveRoot(sessionID)
        },
        family(sessionID: string) {
          return store.session.family[resolveRoot(sessionID)] ?? []
        },
        status(sessionID: string) {
          return store.session.status[sessionID] ?? "idle"
        },
        input: {
          list(sessionID: string) {
            return store.session.input[sessionID] ?? []
          },
          has(sessionID: string, inputID: string) {
            return store.session.input[sessionID]?.includes(inputID) ?? false
          },
        },
        compaction(sessionID: string) {
          return store.session.compaction[sessionID]
        },
        async refresh(sessionID: string) {
          const generation = nextSessionRefresh(sessionID)
          const usageGeneration = sessionUsage.get(sessionID)?.generation ?? 0
          const info = mutable(await sdk.api.session.get({ sessionID }))
          if (!applySessionRefresh(sessionID, generation)) return
          const usage = sessionUsage.get(sessionID)
          setStore(
            "session",
            "info",
            sessionID,
            usage && usage.generation !== usageGeneration ? { ...info, cost: usage.cost, tokens: usage.tokens } : info,
          )
          registerSession(sessionID)
        },
        message: {
          ids(sessionID: string) {
            return (store.session.message[sessionID] ?? []).map((message) => message.id)
          },
          list(sessionID: string) {
            return store.session.message[sessionID] ?? []
          },
          get(sessionID: string, messageID: string) {
            const messages = store.session.message[sessionID]
            const position = messageIndex.get(sessionID)?.get(messageID)
            return position === undefined ? undefined : messages?.[position]
          },
          async refresh(sessionID: string) {
            const live = [...(store.session.message[sessionID] ?? [])]
            setStore("session", "message", sessionID, [])
            messageIndex.set(sessionID, new Map())
            const loaded = mutable(
              (await sdk.api.message.list({ sessionID, limit: 200, order: "desc" })).data,
            ).toReversed()
            const loadedIDs = new Set(loaded.map((message) => message.id))
            const liveByID = new Map(live.map((message) => [message.id, message]))
            const messages = [
              ...loaded.map((message) => {
                if (message.type === "user") return message
                return liveByID.get(message.id) ?? message
              }),
              ...live.filter((message) => !loadedIDs.has(message.id)),
            ].toSorted((a, b) => a.time.created - b.time.created)
            messageIndex.set(sessionID, new Map(messages.map((message, index) => [message.id, index])))
            setStore("session", "message", sessionID, messages)
            const running = messages.find((message) => message.type === "compaction" && message.status === "running")
            setStore("session", "compaction", sessionID, running?.type === "compaction" ? running.summary : undefined)
            setStore(
              "session",
              "compactionReason",
              sessionID,
              running?.type === "compaction" ? running.reason : undefined,
            )
          },
        },
        permission: {
          list(sessionID: string) {
            return store.session.permission[sessionID]
          },
          async refresh(sessionID: string) {
            setStore("session", "permission", sessionID, mutable(await sdk.api.permission.list({ sessionID })))
          },
        },
        form: {
          list(sessionID: string) {
            return store.session.form[sessionID]
          },
          async refresh(sessionID: string) {
            setStore("session", "form", sessionID, mutable(await sdk.api.form.list({ sessionID })))
          },
        },
      },
      project: {
        permission: {
          list(projectID: string) {
            return store.project.permission[projectID]
          },
          async refresh(projectID: string) {
            setStore("project", "permission", projectID, mutable(await sdk.api.permission.saved.list({ projectID })))
          },
        },
      },
      shell: {
        list(location?: LocationRef) {
          return Object.values(store.location[locationKey(location ?? defaultLocation())]?.shell ?? {})
        },
        get(id: string) {
          return Object.values(store.location)
            .map((data) => data.shell?.[id])
            .find((shell) => shell !== undefined)
        },
        async refresh(ref?: LocationRef) {
          const result = await sdk.api.shell.list({ location: locationQuery(ref) })
          const key = locationKey(result.location)
          setStore("location", key, {
            ...store.location[key],
            shell: Object.fromEntries(mutable(result.data).map((info) => [info.id, info])),
          })
        },
      },
      location: {
        default() {
          return defaultLocation()
        },
        async refresh(ref?: LocationRef) {
          const location = await sdk.api.location.get({ location: locationQuery(ref ?? defaultLocation()) })
          const key = locationKey(location)
          if (!store.location[key]) setStore("location", key, {})
          if (!ref) setDefaultLocation({ directory: location.directory, workspaceID: location.workspaceID })
        },
        agent: {
          list(location?: LocationRef) {
            return store.location[locationKey(location ?? defaultLocation())]?.agent
          },
          async refresh(ref?: LocationRef) {
            const result = await sdk.api.agent.list({ location: locationQuery(ref ?? defaultLocation()) })
            const key = locationKey(result.location)
            setStore("location", key, { ...store.location[key], agent: mutable(result.data) })
          },
        },
        command: {
          list(location?: LocationRef) {
            return store.location[locationKey(location ?? defaultLocation())]?.command
          },
          async refresh(ref?: LocationRef) {
            const result = await sdk.api.command.list({ location: locationQuery(ref ?? defaultLocation()) })
            const key = locationKey(result.location)
            setStore("location", key, { ...store.location[key], command: mutable(result.data) })
          },
        },
        integration: {
          list(location?: LocationRef) {
            return store.location[locationKey(location ?? defaultLocation())]?.integration
          },
          async refresh(ref?: LocationRef) {
            const result = await sdk.api.integration.list({ location: locationQuery(ref ?? defaultLocation()) })
            const key = locationKey(result.location)
            setStore("location", key, { ...store.location[key], integration: mutable(result.data) })
          },
        },
        mcp: {
          list(location?: LocationRef) {
            return store.location[locationKey(location ?? defaultLocation())]?.mcp
          },
          async refresh(ref?: LocationRef) {
            const result = await sdk.client.v2.mcp.list({ location: locationQuery(ref) }, { throwOnError: true })
            const key = locationKey(result.data.location)
            setStore("location", key, { ...store.location[key], mcp: result.data.data })
          },
        },
        model: {
          list(location?: LocationRef) {
            return store.location[locationKey(location ?? defaultLocation())]?.model
          },
          async refresh(ref?: LocationRef) {
            const result = await sdk.api.model.list({ location: locationQuery(ref ?? defaultLocation()) })
            const key = locationKey(result.location)
            setStore("location", key, { ...store.location[key], model: mutable(result.data) })
          },
        },
        provider: {
          list(location?: LocationRef) {
            return store.location[locationKey(location ?? defaultLocation())]?.provider
          },
          async refresh(ref?: LocationRef) {
            const result = await sdk.api.provider.list({ location: locationQuery(ref ?? defaultLocation()) })
            const key = locationKey(result.location)
            setStore("location", key, { ...store.location[key], provider: mutable(result.data) })
          },
        },
        reference: {
          list(location?: LocationRef) {
            return store.location[locationKey(location ?? defaultLocation())]?.reference
          },
          async refresh(ref?: LocationRef) {
            const result = await sdk.api.reference.list({ location: locationQuery(ref ?? defaultLocation()) })
            const key = locationKey(result.location)
            setStore("location", key, { ...store.location[key], reference: mutable(result.data) })
          },
        },
        skill: {
          list(location?: LocationRef) {
            return store.location[locationKey(location ?? defaultLocation())]?.skill
          },
          async refresh(ref?: LocationRef) {
            const result = await sdk.api.skill.list({ location: locationQuery(ref ?? defaultLocation()) })
            const key = locationKey(result.location)
            setStore("location", key, { ...store.location[key], skill: mutable(result.data) })
          },
        },
      },
    }

    async function bootstrap() {
      if (bootstrapping) return bootstrapping
      const generation = new Map(sessionRefreshApplied)
      const usageGeneration = new Map(Array.from(sessionUsage, ([id, usage]) => [id, usage.generation]))
      bootstrapping = Promise.allSettled([
        sdk.api.session
          .list({
            limit: 50,
            order: "desc",
            directory: defaultLocation().directory,
            workspace: defaultLocation().workspaceID,
          })
          .then((response) => {
            setStore(
              "session",
              "info",
              produce((draft) => {
                for (const session of response.data) {
                  if ((sessionRefreshApplied.get(session.id) ?? 0) !== (generation.get(session.id) ?? 0)) continue
                  const usage = sessionUsage.get(session.id)
                  draft[session.id] = mutable(
                    usage && usage.generation !== (usageGeneration.get(session.id) ?? 0)
                      ? { ...session, cost: usage.cost, tokens: usage.tokens }
                      : session,
                  )
                }
              }),
            )
            for (const session of response.data) registerSession(session.id)
          }),
        sdk.api.permission.request.list({ location: locationQuery(defaultLocation()) }).then((response) => {
          const permissions = mutable(response.data).reduce<Record<string, PermissionV2Request[]>>(
            (result, request) => ({
              ...result,
              [request.sessionID]: [...(result[request.sessionID] ?? []), request],
            }),
            {},
          )
          setStore("session", "permission", reconcile(permissions))
        }),
        sdk.api.form.request.list({ location: locationQuery(defaultLocation()) }).then((response) => {
          const forms = mutable(response.data).reduce<Record<string, FormInfo[]>>(
            (result, form) => ({
              ...result,
              [form.sessionID]: [...(result[form.sessionID] ?? []), form],
            }),
            {},
          )
          setStore("session", "form", reconcile(forms))
        }),
        result.location.refresh(),
        result.location.agent.refresh(),
        result.location.integration.refresh(),
        result.location.mcp.refresh(),
        result.location.model.refresh(),
        result.location.provider.refresh(),
        result.location.reference.refresh(),
        result.location.command.refresh(),
        result.location.skill.refresh(),
        result.shell.refresh(),
      ])
        .then((settled) => {
          for (const failure of settled.filter((item) => item.status === "rejected"))
            console.error("Failed to refresh default location data", failure.reason)
        })
        .finally(() => {
          bootstrapping = undefined
        })
      return bootstrapping
    }

    function refreshActive() {
      const generation = ++connectionGeneration
      const changed = new Set<string>()
      statusChanges = changed
      void sdk.api.session
        .active()
        .then((active) => {
          if (generation !== connectionGeneration) return
          const status: Record<string, DataSessionStatus> = Object.fromEntries(
            Object.keys(active).map((sessionID) => [sessionID, "running" as const]),
          )
          for (const sessionID of changed) status[sessionID] = store.session.status[sessionID]
          setStore("session", "status", reconcile(status))
        })
        .catch(() => undefined)
        .finally(() => {
          if (statusChanges === changed) statusChanges = undefined
        })
    }

    onCleanup(
      sdk.event.listen(({ details }) => {
        if (details.type === "server.connected") {
          refreshActive()
          void bootstrap()
          return
        }
        handleEvent(details)
      }),
    )

    return result
  },
})
