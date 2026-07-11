// Client data layer: apply server events and cache API reads into a Solid store.
// Prefer straightforward projection. Do not add generation counters, stale-response
// merges, live/history overlays, or other race machinery here—last write wins.
// Reconnect may re-bootstrap; that is enough. UI and the server own ordering concerns.

import type {
  AgentInfo,
  CommandInfo,
  FormInfo,
  IntegrationInfo,
  LocationRef,
  McpServer,
  ModelInfo,
  PermissionSavedInfo,
  PermissionV2Request,
  ProviderV2Info,
  ReferenceInfo,
  SessionMessageInfo,
  SessionMessageAssistant,
  SessionMessageAssistantReasoning,
  SessionMessageAssistantText,
  SessionMessageAssistantTool,
  SessionInfo,
  Shell,
  SkillInfo,
} from "@opencode-ai/sdk/v2"
import type { OpenCodeEvent } from "@opencode-ai/client/promise"
import { createStore, produce, reconcile } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { useSDK } from "./sdk"
import { createSignal, onCleanup } from "solid-js"

export type DataSessionStatus = "idle" | "running"

const messageIDFromEvent = (eventID: string) => eventID.replace(/^evt_/, "msg_")

// Global MCP elicitations temporarily use "global" instead of a real session ID, so the
// server cannot recover their Location when settling them. Preserve the event Location
// until MCP elicitations carry session ownership.
export type FormWithLocation = FormInfo & { readonly location?: LocationRef }

type LocationData = {
  agent?: AgentInfo[]
  command?: CommandInfo[]
  integration?: IntegrationInfo[]
  mcp?: McpServer[]
  model?: ModelInfo[]
  provider?: ProviderV2Info[]
  reference?: ReferenceInfo[]
  // Currently running shell commands for this location, keyed by shell id. Entries are removed
  // once the command exits or is deleted, so this only ever holds in-flight shells.
  shell?: Record<string, Shell>
  skill?: SkillInfo[]
}

type Data = {
  session: {
    info: Record<string, SessionInfo>
    // Family index keyed by a family's root (or furthest-known-ancestor when the
    // true root is not yet loaded). The value is a flat deduplicated list of every
    // session ID in that family, including the key itself once its info arrives.
    family: Record<string, string[]>
    status: Record<string, DataSessionStatus>
    message: Record<string, SessionMessageInfo[]>
    input: Record<string, string[]>
    compaction: Record<string, string[]>
    permission: Record<string, PermissionV2Request[]>
    // Pending forms keyed by owner: a session ID or the temporary "global" elicitation sentinel.
    form: Record<string, FormWithLocation[]>
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

export const { use: useData, provider: DataProvider } = createSimpleContext({
  name: "Data",
  init: () => {
    const [store, setStore] = createStore<Data>({
      session: {
        info: {},
        family: {},
        status: {},
        message: {},
        input: {},
        compaction: {},
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
    let bootstrapping: Promise<void> | undefined
    let connected = false

    function setSessionStatus(sessionID: string, status: DataSessionStatus) {
      setStore("session", "status", sessionID, status)
    }

    function addCompaction(sessionID: string, inputID: string) {
      if (store.session.compaction[sessionID]?.includes(inputID)) return
      setStore("session", "compaction", sessionID, [...(store.session.compaction[sessionID] ?? []), inputID])
    }

    function removeCompaction(sessionID: string, inputID?: string) {
      if (!inputID || !store.session.compaction[sessionID]?.includes(inputID)) return
      setStore(
        "session",
        "compaction",
        sessionID,
        store.session.compaction[sessionID].filter((id) => id !== inputID),
      )
    }

    const message = {
      update(sessionID: string, fn: (messages: SessionMessageInfo[], index: Map<string, number>) => void) {
        setStore(
          "session",
          "message",
          produce((draft) => {
            fn((draft[sessionID] ??= []), index(sessionID))
          }),
        )
      },
      append(messages: SessionMessageInfo[], index: Map<string, number>, item: SessionMessageInfo) {
        if (index.has(item.id)) return
        index.set(item.id, messages.length)
        messages.push(item)
      },
      activeAssistant(messages: SessionMessageInfo[]) {
        const item = messages.findLast((item) => item.type === "assistant" && !item.time.completed)
        return item?.type === "assistant" ? item : undefined
      },
      assistant(messages: SessionMessageInfo[], index: Map<string, number>, messageID: string) {
        const position = index.get(messageID)
        const item = position === undefined ? undefined : messages[position]
        return item?.type === "assistant" ? item : undefined
      },
      shell(messages: SessionMessageInfo[], shellID: string) {
        const item = messages.findLast((item) => item.type === "shell" && item.shellID === shellID)
        return item?.type === "shell" ? item : undefined
      },
      compaction(messages: SessionMessageInfo[]) {
        const item = messages.findLast((item) => item.type === "compaction" && item.status === "running")
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
      messageIndex.delete(sessionID)
      setStore(
        "session",
        produce((draft) => {
          delete draft.info[sessionID]
          delete draft.status[sessionID]
          delete draft.message[sessionID]
          delete draft.input[sessionID]
          delete draft.compaction[sessionID]
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

    function handleEvent(event: OpenCodeEvent) {
      switch (event.type) {
        case "session.created":
          void result.session.refresh(event.data.sessionID)
          break
        case "session.deleted":
          removeSession(event.data.sessionID)
          break
        case "session.usage.updated":
          if (store.session.info[event.data.sessionID])
            setStore("session", "info", event.data.sessionID, {
              cost: event.data.cost,
              tokens: event.data.tokens,
            })
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
                if (position === undefined) return message.append(draft, index, item)
                draft[position] = item
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
            setStore("session", "info", event.data.sessionID, "location", event.data.location)
            setStore("session", "info", event.data.sessionID, "subpath", event.data.subpath)
          }
          break
        case "session.input.promoted": {
          message.update(event.data.sessionID, (draft, index) => {
            const position = index.get(event.data.inputID)
            if (position === undefined) return
            const existing = draft[position]
            if (!existing || !store.session.input[event.data.sessionID]?.includes(event.data.inputID)) return
            existing.time.created = event.created
            draft.splice(position, 1)
            draft.push(existing)
            index.clear()
            draft.forEach((message, indexValue) => index.set(message.id, indexValue))
          })
          setStore(
            "session",
            "input",
            event.data.sessionID,
            (store.session.input[event.data.sessionID] ?? []).filter((id) => id !== event.data.inputID),
          )
          break
        }
        case "session.input.admitted":
          if (!store.session.input[event.data.sessionID]?.includes(event.data.inputID))
            setStore("session", "input", event.data.sessionID, [
              ...(store.session.input[event.data.sessionID] ?? []),
              event.data.inputID,
            ])
          message.update(event.data.sessionID, (draft, index) => {
            message.append(
              draft,
              index,
              event.data.input.type === "user"
                ? {
                    id: event.data.inputID,
                    type: "user",
                    ...event.data.input.data,
                    time: { created: event.created },
                  }
                : {
                    id: event.data.inputID,
                    type: "synthetic",
                    ...event.data.input.data,
                    time: { created: event.created },
                  },
            )
          })
          break
        case "session.instructions.updated":
          message.update(event.data.sessionID, (draft, index) => {
            message.append(draft, index, {
              id: messageIDFromEvent(event.id),
              type: "system",
              text: `Instructions updated: ${Object.keys(event.data.delta).join(", ")}`,
              metadata: event.metadata,
              time: { created: event.created },
            })
          })
          break
        case "session.synthetic":
          message.update(event.data.sessionID, (draft, index) => {
            message.append(draft, index, {
              id: messageIDFromEvent(event.id),
              type: "synthetic",
              text: event.data.text,
              description: event.data.description,
              metadata: event.data.metadata,
              time: { created: event.created },
            })
          })
          break
        case "session.shell.started":
          message.update(event.data.sessionID, (draft, index) => {
            message.append(draft, index, {
              id: messageIDFromEvent(event.id),
              type: "shell",
              shellID: event.data.shell.id,
              command: event.data.shell.command,
              status: event.data.shell.status,
              exit: event.data.shell.exit,
              metadata: event.metadata,
              time: { created: event.created },
            })
          })
          break
        case "session.shell.ended":
          message.update(event.data.sessionID, (draft) => {
            const match = message.shell(draft, event.data.shell.id)
            if (!match) return
            match.status = event.data.shell.status
            match.exit = event.data.shell.exit
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
              metadata: event.metadata,
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
              state: { status: "streaming", input: "" },
            })
          })
          break
        case "session.tool.input.delta":
          message.update(event.data.sessionID, (draft, index) => {
            const match = message.latestTool(
              message.assistant(draft, index, event.data.assistantMessageID),
              event.data.callID,
            )
            if (match?.state.status === "streaming") match.state.input += event.data.delta
          })
          break
        case "session.tool.input.ended":
          message.update(event.data.sessionID, (draft, index) => {
            const match = message.latestTool(
              message.assistant(draft, index, event.data.assistantMessageID),
              event.data.callID,
            )
            if (match?.state.status === "streaming") match.state.input = event.data.text
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
            if (!match || (match.state.status !== "streaming" && match.state.status !== "running")) return
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
          addCompaction(event.data.sessionID, event.data.inputID)
          break
        case "session.compaction.started":
          removeCompaction(event.data.sessionID, event.data.inputID)
          message.update(event.data.sessionID, (draft, index) => {
            message.append(draft, index, {
              id: event.data.inputID ?? messageIDFromEvent(event.id),
              type: "compaction",
              status: "running",
              reason: event.data.reason,
              summary: "",
              recent: event.data.recent ?? "",
              time: { created: event.created },
            })
          })
          break
        case "session.execution.succeeded":
        case "session.execution.failed":
        case "session.execution.interrupted":
          setSessionStatus(event.data.sessionID, "idle")
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
          message.update(event.data.sessionID, (draft) => {
            const current = message.compaction(draft)
            if (current?.status === "running") current.summary += event.data.text
          })
          break
        case "session.compaction.ended":
          message.update(event.data.sessionID, (draft, index) => {
            const position = draft.findLastIndex((item) => item.type === "compaction" && item.status === "running")
            const current = draft[position]
            if (current?.type === "compaction") {
              Object.assign(current, {
                status: "completed",
                reason: event.data.reason,
                summary: event.data.text,
                recent: event.data.recent,
              })
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
          removeCompaction(event.data.sessionID, event.data.inputID)
          message.update(event.data.sessionID, (draft, index) => {
            const position = draft.findLastIndex((item) => item.type === "compaction" && item.status === "running")
            const current = draft[position]
            const failed: Extract<SessionMessageInfo, { type: "compaction"; status: "failed" }> = {
              id: current?.id ?? event.data.inputID ?? messageIDFromEvent(event.id),
              type: "compaction",
              status: "failed",
              reason: event.data.reason ?? "manual",
              error: event.data.error ?? {
                type: "compaction.failed",
                message: "Compaction failed before recording an error",
              },
              metadata: current?.type === "compaction" ? current.metadata : event.metadata,
              time: current?.type === "compaction" ? current.time : { created: event.created },
            }
            if (current?.type === "compaction") {
              draft[position] = failed
              return
            }
            message.append(draft, index, failed)
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
            event.data.form.sessionID === "global" ? { ...event.data.form, location: event.location } : event.data.form,
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
        cost(sessionID: string) {
          const session = store.session.info[sessionID]
          if (!session) return 0
          if (session.parentID) return session.cost
          return (store.session.family[sessionID] ?? [sessionID]).reduce(
            (total, id) => total + (store.session.info[id]?.cost ?? 0),
            0,
          )
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
        compaction: {
          list(sessionID: string) {
            return store.session.compaction[sessionID] ?? []
          },
          async refresh(sessionID: string) {
            if (!store.session.compaction[sessionID]) setStore("session", "compaction", sessionID, [])
            setStore(
              "session",
              "compaction",
              sessionID,
              reconcile(
                (await sdk.api.session.pending.list({ sessionID }))
                  .filter((item) => item.type === "compaction")
                  .map((item) => item.id),
              ),
            )
          },
        },
        async refresh(sessionID: string) {
          setStore("session", "info", sessionID, await sdk.api.session.get({ sessionID }))
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
            const messages = (await sdk.api.message.list({ sessionID, limit: 200, order: "desc" })).data.toReversed()
            messageIndex.set(sessionID, new Map(messages.map((message, index) => [message.id, index])))
            setStore("session", "message", sessionID, reconcile(messages))
          },
        },
        permission: {
          list(sessionID: string) {
            return store.session.permission[sessionID]
          },
          async refresh(sessionID: string) {
            setStore("session", "permission", sessionID, await sdk.api.permission.list({ sessionID }))
          },
        },
        form: {
          list(sessionID: string, ref?: LocationRef) {
            const forms = store.session.form[sessionID]
            if (sessionID !== "global") return forms
            if (!ref) return
            const key = locationKey(ref)
            return forms?.filter((form) => form.location && locationKey(form.location) === key)
          },
          async refresh(sessionID: string, ref?: LocationRef) {
            if (sessionID === "global") {
              const response = await sdk.api.form.request.list({ location: locationQuery(ref ?? defaultLocation()) })
              const location = {
                directory: response.location.directory,
                workspaceID: response.location.workspaceID,
              }
              const key = locationKey(location)
              setStore("session", "form", sessionID, [
                ...(store.session.form[sessionID] ?? []).filter(
                  (form) => form.location && locationKey(form.location) !== key,
                ),
                ...response.data.filter((form) => form.sessionID === "global").map((form) => ({ ...form, location })),
              ])
              return
            }
            setStore("session", "form", sessionID, await sdk.api.form.list({ sessionID }))
          },
        },
      },
      project: {
        permission: {
          list(projectID: string) {
            return store.project.permission[projectID]
          },
          async refresh(projectID: string) {
            setStore("project", "permission", projectID, await sdk.api.permission.saved.list({ projectID }))
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
            shell: Object.fromEntries(result.data.map((info) => [info.id, info])),
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
            setStore("location", key, { ...store.location[key], agent: result.data })
          },
        },
        command: {
          list(location?: LocationRef) {
            return store.location[locationKey(location ?? defaultLocation())]?.command
          },
          async refresh(ref?: LocationRef) {
            const result = await sdk.api.command.list({ location: locationQuery(ref ?? defaultLocation()) })
            const key = locationKey(result.location)
            setStore("location", key, { ...store.location[key], command: result.data })
          },
        },
        integration: {
          list(location?: LocationRef) {
            return store.location[locationKey(location ?? defaultLocation())]?.integration
          },
          async refresh(ref?: LocationRef) {
            const result = await sdk.api.integration.list({ location: locationQuery(ref ?? defaultLocation()) })
            const key = locationKey(result.location)
            setStore("location", key, { ...store.location[key], integration: result.data })
          },
        },
        mcp: {
          list(location?: LocationRef) {
            return store.location[locationKey(location ?? defaultLocation())]?.mcp
          },
          async refresh(ref?: LocationRef) {
            const result = await sdk.api["server.mcp"].list({ location: locationQuery(ref) })
            const key = locationKey(result.location)
            setStore("location", key, { ...store.location[key], mcp: result.data })
          },
        },
        model: {
          list(location?: LocationRef) {
            return store.location[locationKey(location ?? defaultLocation())]?.model
          },
          async refresh(ref?: LocationRef) {
            const result = await sdk.api.model.list({ location: locationQuery(ref ?? defaultLocation()) })
            const key = locationKey(result.location)
            setStore("location", key, { ...store.location[key], model: result.data })
          },
        },
        provider: {
          list(location?: LocationRef) {
            return store.location[locationKey(location ?? defaultLocation())]?.provider
          },
          async refresh(ref?: LocationRef) {
            const result = await sdk.api.provider.list({ location: locationQuery(ref ?? defaultLocation()) })
            const key = locationKey(result.location)
            setStore("location", key, { ...store.location[key], provider: result.data })
          },
        },
        reference: {
          list(location?: LocationRef) {
            return store.location[locationKey(location ?? defaultLocation())]?.reference
          },
          async refresh(ref?: LocationRef) {
            const result = await sdk.api.reference.list({ location: locationQuery(ref ?? defaultLocation()) })
            const key = locationKey(result.location)
            setStore("location", key, { ...store.location[key], reference: result.data })
          },
        },
        skill: {
          list(location?: LocationRef) {
            return store.location[locationKey(location ?? defaultLocation())]?.skill
          },
          async refresh(ref?: LocationRef) {
            const result = await sdk.api.skill.list({ location: locationQuery(ref ?? defaultLocation()) })
            const key = locationKey(result.location)
            setStore("location", key, { ...store.location[key], skill: result.data })
          },
        },
      },
    }

    async function bootstrap() {
      if (bootstrapping) return bootstrapping
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
                for (const session of response.data) draft[session.id] = session
              }),
            )
            for (const session of response.data) registerSession(session.id)
          }),
        sdk.api.permission.request.list({ location: locationQuery(defaultLocation()) }).then((response) => {
          const permissions = response.data.reduce<Record<string, PermissionV2Request[]>>(
            (result, request) => ({
              ...result,
              [request.sessionID]: [...(result[request.sessionID] ?? []), request],
            }),
            {},
          )
          setStore("session", "permission", reconcile(permissions))
        }),
        sdk.api.form.request.list({ location: locationQuery(defaultLocation()) }).then((response) => {
          const location = {
            directory: response.location.directory,
            workspaceID: response.location.workspaceID,
          }
          const forms = response.data.reduce<Record<string, FormWithLocation[]>>(
            (result, form) => ({
              ...result,
              [form.sessionID]: [
                ...(result[form.sessionID] ?? []),
                form.sessionID === "global" ? { ...form, location } : form,
              ],
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
        .then(async (settled) => {
          for (const failure of settled.filter((item) => item.status === "rejected"))
            console.error("Failed to refresh default location data", failure.reason)
          const key = locationKey(defaultLocation())
          const locations = new Map(
            Object.values(store.session.info).map(
              (session) => [locationKey(session.location), session.location] as const,
            ),
          )
          const refreshed = await Promise.allSettled(
            Array.from(locations)
              .filter(([location]) => location !== key)
              .map(([, location]) => result.session.form.refresh("global", location)),
          )
          for (const failure of refreshed.filter((item) => item.status === "rejected"))
            console.error("Failed to refresh global forms", failure.reason)
        })
        .finally(() => {
          bootstrapping = undefined
        })
      return bootstrapping
    }

    function refreshActive() {
      void sdk.api.session
        .active()
        .then((active) => {
          setStore(
            "session",
            "status",
            reconcile(Object.fromEntries(Object.keys(active).map((sessionID) => [sessionID, "running" as const]))),
          )
        })
        .catch(() => undefined)
    }

    onCleanup(
      sdk.event.listen(({ details }) => {
        if (details.type === "server.connected") {
          const messages = connected ? Object.keys(store.session.message) : []
          const compactions = connected ? Object.keys(store.session.compaction) : []
          connected = true
          refreshActive()
          void Promise.allSettled([
            bootstrap(),
            ...messages.map(result.session.message.refresh),
            ...compactions.map(result.session.compaction.refresh),
          ])
          return
        }
        handleEvent(details)
      }),
    )

    return result
  },
})
