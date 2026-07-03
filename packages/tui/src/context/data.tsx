import type {
  AgentV2Info,
  CommandV2Info,
  IntegrationInfo,
  LocationRef,
  McpServer,
  ModelV2Info,
  PermissionSavedInfo,
  PermissionV2Request,
  ProviderV2Info,
  QuestionV2Request,
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
import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { useSDK } from "./sdk"
import { createSignal, onCleanup } from "solid-js"

export type DataSessionStatus = "idle" | "running"

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
    message: Record<string, SessionMessage[]>
    permission: Record<string, PermissionV2Request[]>
    question: Record<string, QuestionV2Request[]>
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
        message: {},
        permission: {},
        question: {},
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
      activeShell(messages: SessionMessage[], callID: string) {
        const item = messages.findLast((item) => item.type === "shell" && item.callID === callID)
        return item?.type === "shell" ? item : undefined
      },
      latestTool(assistant: SessionMessageAssistant | undefined, callID?: string) {
        return assistant?.content.findLast(
          (item): item is SessionMessageAssistantTool =>
            item.type === "tool" && (callID === undefined || item.id === callID),
        )
      },
      latestText(assistant: SessionMessageAssistant | undefined, textID: string) {
        return assistant?.content.findLast(
          (item): item is SessionMessageAssistantText => item.type === "text" && item.id === textID,
        )
      },
      latestReasoning(assistant: SessionMessageAssistant | undefined, reasoningID: string) {
        return assistant?.content.findLast(
          (item): item is SessionMessageAssistantReasoning => item.type === "reasoning" && item.id === reasoningID,
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
      setStore("session", "family", produce((draft) => {
        if (sessionID !== rootID && draft[sessionID]) {
          const members = draft[rootID] ??= []
          for (const id of draft[sessionID]) {
            if (!members.includes(id)) members.push(id)
          }
          delete draft[sessionID]
        }
        const family = draft[rootID] ??= []
        if (!family.includes(sessionID)) family.push(sessionID)
      }))
    }

    function handleEvent(event: V2Event) {
      switch (event.type) {
        case "session.created":
          void result.session.refresh(event.data.sessionID)
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
        case "session.next.agent.switched":
          if (store.session.info[event.data.sessionID])
            setStore("session", "info", event.data.sessionID, "agent", event.data.agent)
          message.update(event.data.sessionID, (draft, index) => {
            message.append(draft, index, {
              id: event.data.messageID,
              type: "agent-switched",
              agent: event.data.agent,
              time: { created: event.data.timestamp },
            })
          })
          break
        case "session.next.model.switched":
          if (store.session.info[event.data.sessionID])
            setStore("session", "info", event.data.sessionID, "model", event.data.model)
          message.update(event.data.sessionID, (draft, index) => {
            message.append(draft, index, {
              id: event.data.messageID,
              type: "model-switched",
              model: event.data.model,
              time: { created: event.data.timestamp },
            })
          })
          break
        case "session.next.renamed":
          if (store.session.info[event.data.sessionID])
            setStore("session", "info", event.data.sessionID, "title", event.data.title)
          break
        case "session.next.prompted": {
          setStore("session", "status", event.data.sessionID, "running")
          message.update(event.data.sessionID, (draft, index) => {
            const position = index.get(event.data.messageID)
            const existing = position === undefined ? undefined : draft[position]
            if (existing?.type === "user") {
              existing.text = event.data.prompt.text
              existing.files = event.data.prompt.files
              existing.agents = event.data.prompt.agents
              existing.time.created = event.data.timestamp
              if (existing.metadata?.queued === true) {
                delete existing.metadata.queued
                if (Object.keys(existing.metadata).length === 0) existing.metadata = undefined
              }
              return
            }
            message.append(draft, index, {
              id: event.data.messageID,
              type: "user",
              text: event.data.prompt.text,
              files: event.data.prompt.files,
              agents: event.data.prompt.agents,
              time: { created: event.data.timestamp },
            })
          })
          break
        }
        case "session.next.prompt.admitted":
          message.update(event.data.sessionID, (draft, index) => {
            message.append(draft, index, {
              id: event.data.messageID,
              type: "user",
              text: event.data.prompt.text,
              files: event.data.prompt.files,
              agents: event.data.prompt.agents,
              metadata: { queued: true },
              time: { created: event.data.timestamp },
            })
          })
          break
        case "session.next.context.updated":
          message.update(event.data.sessionID, (draft, index) => {
            message.append(draft, index, {
              id: event.data.messageID,
              type: "system",
              text: event.data.text,
              time: { created: event.data.timestamp },
            })
          })
          break
        case "session.next.synthetic":
          message.update(event.data.sessionID, (draft, index) => {
            message.append(draft, index, {
              id: event.data.messageID,
              type: "synthetic",
              sessionID: event.data.sessionID,
              text: event.data.text,
              description: event.data.description,
              time: { created: event.data.timestamp },
            })
          })
          break
        case "session.next.shell.started":
          setStore("session", "status", event.data.sessionID, "running")
          message.update(event.data.sessionID, (draft, index) => {
            message.append(draft, index, {
              id: event.data.messageID,
              type: "shell",
              callID: event.data.callID,
              command: event.data.command,
              output: "",
              time: { created: event.data.timestamp },
            })
          })
          break
        case "session.next.shell.ended":
          setStore("session", "status", event.data.sessionID, "idle")
          message.update(event.data.sessionID, (draft, index) => {
            const match = message.activeShell(draft, event.data.callID)
            if (!match) return
            match.output = event.data.output
            match.time.completed = event.data.timestamp
          })
          break
        case "session.next.step.started":
          setStore("session", "status", event.data.sessionID, "running")
          message.update(event.data.sessionID, (draft, index) => {
            if (index.has(event.data.assistantMessageID)) return
            const currentAssistant = message.activeAssistant(draft)
            if (currentAssistant) currentAssistant.time.completed = event.data.timestamp
            message.append(draft, index, {
              id: event.data.assistantMessageID,
              type: "assistant",
              agent: event.data.agent,
              model: event.data.model,
              content: [],
              snapshot: event.data.snapshot ? { start: event.data.snapshot } : undefined,
              time: { created: event.data.timestamp },
            })
          })
          break
        case "session.next.step.ended":
          setStore("session", "status", event.data.sessionID, "running")
          message.update(event.data.sessionID, (draft, index) => {
            const currentAssistant = message.assistant(draft, index, event.data.assistantMessageID)
            if (!currentAssistant) return
            currentAssistant.time.completed = event.data.timestamp
            currentAssistant.finish = event.data.finish
            currentAssistant.cost = event.data.cost
            currentAssistant.tokens = event.data.tokens
            if (event.data.snapshot)
              currentAssistant.snapshot = { ...currentAssistant.snapshot, end: event.data.snapshot }
          })
          break
        case "session.next.step.failed":
          message.update(event.data.sessionID, (draft, index) => {
            const currentAssistant = message.assistant(draft, index, event.data.assistantMessageID)
            if (!currentAssistant) return
            currentAssistant.time.completed = event.data.timestamp
            currentAssistant.finish = "error"
            currentAssistant.error = event.data.error
          })
          break
        case "session.next.text.started":
          message.update(event.data.sessionID, (draft, index) => {
            message.assistant(draft, index, event.data.assistantMessageID)?.content.push({
              type: "text",
              id: event.data.textID,
              text: "",
            })
          })
          break
        case "session.next.text.delta":
          message.update(event.data.sessionID, (draft, index) => {
            const match = message.latestText(
              message.assistant(draft, index, event.data.assistantMessageID),
              event.data.textID,
            )
            if (match) match.text += event.data.delta
          })
          break
        case "session.next.text.ended":
          message.update(event.data.sessionID, (draft, index) => {
            const match = message.latestText(
              message.assistant(draft, index, event.data.assistantMessageID),
              event.data.textID,
            )
            if (match) match.text = event.data.text
          })
          break
        case "session.next.tool.input.started":
          message.update(event.data.sessionID, (draft, index) => {
            message.assistant(draft, index, event.data.assistantMessageID)?.content.push({
              type: "tool",
              id: event.data.callID,
              name: event.data.name,
              time: { created: event.data.timestamp },
              state: { status: "pending", input: "" },
            })
          })
          break
        case "session.next.tool.input.delta":
          message.update(event.data.sessionID, (draft, index) => {
            const match = message.latestTool(
              message.assistant(draft, index, event.data.assistantMessageID),
              event.data.callID,
            )
            if (match?.state.status === "pending") match.state.input += event.data.delta
          })
          break
        case "session.next.tool.input.ended":
          message.update(event.data.sessionID, (draft, index) => {
            const match = message.latestTool(
              message.assistant(draft, index, event.data.assistantMessageID),
              event.data.callID,
            )
            if (match?.state.status === "pending") match.state.input = event.data.text
          })
          break
        case "session.next.tool.called":
          message.update(event.data.sessionID, (draft, index) => {
            const match = message.latestTool(
              message.assistant(draft, index, event.data.assistantMessageID),
              event.data.callID,
            )
            if (!match) return
            match.time.ran = event.data.timestamp
            match.provider = event.data.provider
            match.state = { status: "running", input: event.data.input, structured: {}, content: [] }
          })
          break
        case "session.next.tool.progress":
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
        case "session.next.tool.success":
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
            match.provider = {
              executed: event.data.provider.executed || match.provider?.executed === true,
              metadata: match.provider?.metadata,
              resultMetadata: event.data.provider.metadata,
            }
            match.time.completed = event.data.timestamp
          })
          break
        case "session.next.tool.failed":
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
            match.provider = {
              executed: event.data.provider.executed || match.provider?.executed === true,
              metadata: match.provider?.metadata,
              resultMetadata: event.data.provider.metadata,
            }
            match.time.completed = event.data.timestamp
          })
          break
        case "session.next.reasoning.started":
          message.update(event.data.sessionID, (draft, index) => {
            message.assistant(draft, index, event.data.assistantMessageID)?.content.push({
              type: "reasoning",
              id: event.data.reasoningID,
              text: "",
              providerMetadata: event.data.providerMetadata,
              time: { created: event.data.timestamp },
            })
          })
          break
        case "session.next.reasoning.delta":
          message.update(event.data.sessionID, (draft, index) => {
            const match = message.latestReasoning(
              message.assistant(draft, index, event.data.assistantMessageID),
              event.data.reasoningID,
            )
            if (match) match.text += event.data.delta
          })
          break
        case "session.next.reasoning.ended":
          message.update(event.data.sessionID, (draft, index) => {
            const match = message.latestReasoning(
              message.assistant(draft, index, event.data.assistantMessageID),
              event.data.reasoningID,
            )
            if (match) {
              match.text = event.data.text
              match.time = { created: match.time?.created ?? event.data.timestamp, completed: event.data.timestamp }
              if (event.data.providerMetadata !== undefined) match.providerMetadata = event.data.providerMetadata
            }
          })
          break
        case "session.next.retried":
        case "session.next.compaction.started":
          setStore("session", "status", event.data.sessionID, "running")
          break
        case "session.next.execution.settled":
          setStore("session", "status", event.data.sessionID, "idle")
          break
        case "session.next.revert.staged":
          if (store.session.info[event.data.sessionID])
            setStore("session", "info", event.data.sessionID, "revert", event.data.revert)
          break
        case "session.next.revert.cleared":
        case "session.next.revert.committed":
          if (store.session.info[event.data.sessionID])
            setStore("session", "info", event.data.sessionID, "revert", undefined)
          break
        case "session.next.compaction.delta":
          break
        case "session.next.compaction.ended":
          message.update(event.data.sessionID, (draft, index) => {
            message.append(draft, index, {
              id: event.data.messageID,
              type: "compaction",
              reason: event.data.reason,
              summary: event.data.text,
              recent: event.data.recent,
              time: { created: event.data.timestamp },
            })
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
        case "question.v2.asked":
          if (store.session.question[event.data.sessionID]?.some((request) => request.id === event.data.id)) break
          setStore("session", "question", event.data.sessionID, [
            ...(store.session.question[event.data.sessionID] ?? []),
            event.data,
          ])
          break
        case "question.v2.replied":
        case "question.v2.rejected":
          setStore(
            "session",
            "question",
            event.data.sessionID,
            (store.session.question[event.data.sessionID] ?? []).filter(
              (request) => request.id !== event.data.requestID,
            ),
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
        async refresh(sessionID: string) {
          setStore("session", "info", sessionID, mutable(await sdk.api.session.get({ sessionID })))
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
            ]
              .toSorted((a, b) => a.time.created - b.time.created)
            messageIndex.set(sessionID, new Map(messages.map((message, index) => [message.id, index])))
            setStore("session", "message", sessionID, messages)
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
        question: {
          list(sessionID: string) {
            return store.session.question[sessionID]
          },
          async refresh(sessionID: string) {
            setStore("session", "question", sessionID, mutable(await sdk.api.question.list({ sessionID })))
          },
        },
      },
      project: {
        permission: {
          list(projectID: string) {
            return store.project.permission[projectID]
          },
          async refresh(projectID: string) {
            setStore("project", "permission", projectID, mutable(await sdk.api.permission.listSaved({ projectID })))
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
        async remove(id: string) {
          await sdk.api.shell.remove({ id })
          setStore(
            "location",
            produce((draft) => {
              for (const data of Object.values(draft)) delete data.shell?.[id]
            }),
          )
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
                for (const session of response.data) draft[session.id] = mutable(session)
              }),
            )
            for (const session of response.data) registerSession(session.id)
          }),
        sdk.api.session
          .active()
          .then((active) =>
            setStore(
              "session",
              "status",
              Object.fromEntries(Object.keys(active.data).map((sessionID) => [sessionID, "running" as const])),
            ),
          ),
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

    onCleanup(
      sdk.event.listen(({ details }) => {
        if (details.type === "server.connected") {
          void bootstrap()
          return
        }
        handleEvent(details)
      }),
    )

    return result
  },
})
