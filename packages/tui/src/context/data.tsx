import { useEvent } from "./event"
import type {
  AgentV2Info,
  CommandV2Info,
  IntegrationInfo,
  Event,
  LocationRef,
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
  SkillV2Info,
} from "@opencode-ai/sdk/v2"
import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { useSDK } from "./sdk"
import { createSignal, onMount } from "solid-js"

type LocationData = {
  agent?: AgentV2Info[]
  command?: CommandV2Info[]
  integration?: IntegrationInfo[]
  model?: ModelV2Info[]
  provider?: ProviderV2Info[]
  reference?: ReferenceInfo[]
  skill?: SkillV2Info[]
}

type Data = {
  session: {
    info: Record<string, SessionV2Info>
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

export const { use: useData, provider: DataProvider } = createSimpleContext({
  name: "Data",
  init: () => {
    const [store, setStore] = createStore<Data>({
      session: {
        info: {},
        message: {},
        permission: {},
        question: {},
      },
      project: {
        permission: {},
      },
      location: {},
    })

    const event = useEvent()
    const sdk = useSDK()
    const [defaultLocation, setDefaultLocation] = createSignal<LocationRef>({
      directory: sdk.directory ?? process.cwd(),
    })

    const message = {
      update(sessionID: string, fn: (messages: SessionMessage[]) => void) {
        setStore(
          "session",
          "message",
          produce((draft) => {
            fn((draft[sessionID] ??= []))
          }),
        )
      },
      prepend(messages: SessionMessage[], item: SessionMessage) {
        if (messages.some((existing) => existing.id === item.id)) return
        messages.unshift(item)
      },
      activeAssistant(messages: SessionMessage[]) {
        const item = messages.find((item) => item.type === "assistant" && !item.time.completed)
        return item?.type === "assistant" ? item : undefined
      },
      assistant(messages: SessionMessage[], messageID: string) {
        const item = messages.find((item) => item.type === "assistant" && item.id === messageID)
        return item?.type === "assistant" ? item : undefined
      },
      activeShell(messages: SessionMessage[], callID: string) {
        const item = messages.find((item) => item.type === "shell" && item.callID === callID)
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

    event.subscribe((event, metadata) => {
      switch (event.type) {
        case "catalog.updated":
          void Promise.all([
            result.location.model.refresh({ directory: metadata.directory, workspaceID: metadata.workspace }),
            result.location.provider.refresh({ directory: metadata.directory, workspaceID: metadata.workspace }),
          ])
          break
        case "session.next.agent.switched":
          message.update(event.properties.sessionID, (draft) => {
            message.prepend(draft, {
              id: event.properties.messageID,
              type: "agent-switched",
              agent: event.properties.agent,
              time: { created: event.properties.timestamp },
            })
          })
          break
        case "session.next.model.switched":
          message.update(event.properties.sessionID, (draft) => {
            message.prepend(draft, {
              id: event.properties.messageID,
              type: "model-switched",
              model: event.properties.model,
              time: { created: event.properties.timestamp },
            })
          })
          break
        case "session.next.prompted": {
          message.update(event.properties.sessionID, (draft) => {
            message.prepend(draft, {
              id: event.properties.messageID,
              type: "user",
              text: event.properties.prompt.text,
              files: event.properties.prompt.files,
              agents: event.properties.prompt.agents,
              time: { created: event.properties.timestamp },
            })
          })
          break
        }
        case "session.next.prompt.admitted":
          break
        case "session.next.prompt.promoted":
          message.update(event.properties.sessionID, (draft) => {
            message.prepend(draft, {
              id: event.properties.messageID,
              type: "user",
              text: event.properties.prompt.text,
              files: event.properties.prompt.files,
              agents: event.properties.prompt.agents,
              time: { created: event.properties.timeCreated },
            })
          })
          break
        case "session.next.context.updated":
          message.update(event.properties.sessionID, (draft) => {
            message.prepend(draft, {
              id: event.properties.messageID,
              type: "system",
              text: event.properties.text,
              time: { created: event.properties.timestamp },
            })
          })
          break
        case "session.next.synthetic":
          message.update(event.properties.sessionID, (draft) => {
            message.prepend(draft, {
              id: event.properties.messageID,
              type: "synthetic",
              sessionID: event.properties.sessionID,
              text: event.properties.text,
              time: { created: event.properties.timestamp },
            })
          })
          break
        case "session.next.shell.started":
          message.update(event.properties.sessionID, (draft) => {
            message.prepend(draft, {
              id: event.properties.messageID,
              type: "shell",
              callID: event.properties.callID,
              command: event.properties.command,
              output: "",
              time: { created: event.properties.timestamp },
            })
          })
          break
        case "session.next.shell.ended":
          message.update(event.properties.sessionID, (draft) => {
            const match = message.activeShell(draft, event.properties.callID)
            if (!match) return
            match.output = event.properties.output
            match.time.completed = event.properties.timestamp
          })
          break
        case "session.next.step.started":
          message.update(event.properties.sessionID, (draft) => {
            if (draft.some((message) => message.id === event.properties.assistantMessageID)) return
            const currentAssistant = message.activeAssistant(draft)
            if (currentAssistant) currentAssistant.time.completed = event.properties.timestamp
            message.prepend(draft, {
              id: event.properties.assistantMessageID,
              type: "assistant",
              agent: event.properties.agent,
              model: event.properties.model,
              content: [],
              snapshot: event.properties.snapshot ? { start: event.properties.snapshot } : undefined,
              time: { created: event.properties.timestamp },
            })
          })
          break
        case "session.next.step.ended":
          message.update(event.properties.sessionID, (draft) => {
            const currentAssistant = message.assistant(draft, event.properties.assistantMessageID)
            if (!currentAssistant) return
            currentAssistant.time.completed = event.properties.timestamp
            currentAssistant.finish = event.properties.finish
            currentAssistant.cost = event.properties.cost
            currentAssistant.tokens = event.properties.tokens
            if (event.properties.snapshot)
              currentAssistant.snapshot = { ...currentAssistant.snapshot, end: event.properties.snapshot }
          })
          break
        case "session.next.step.failed":
          message.update(event.properties.sessionID, (draft) => {
            const currentAssistant = message.assistant(draft, event.properties.assistantMessageID)
            if (!currentAssistant) return
            currentAssistant.time.completed = event.properties.timestamp
            currentAssistant.finish = "error"
            currentAssistant.error = event.properties.error
          })
          break
        case "session.next.text.started":
          message.update(event.properties.sessionID, (draft) => {
            message.assistant(draft, event.properties.assistantMessageID)?.content.push({
              type: "text",
              id: event.properties.textID,
              text: "",
            })
          })
          break
        case "session.next.text.delta":
          message.update(event.properties.sessionID, (draft) => {
            const match = message.latestText(
              message.assistant(draft, event.properties.assistantMessageID),
              event.properties.textID,
            )
            if (match) match.text += event.properties.delta
          })
          break
        case "session.next.text.ended":
          message.update(event.properties.sessionID, (draft) => {
            const match = message.latestText(
              message.assistant(draft, event.properties.assistantMessageID),
              event.properties.textID,
            )
            if (match) match.text = event.properties.text
          })
          break
        case "session.next.tool.input.started":
          message.update(event.properties.sessionID, (draft) => {
            message.assistant(draft, event.properties.assistantMessageID)?.content.push({
              type: "tool",
              id: event.properties.callID,
              name: event.properties.name,
              time: { created: event.properties.timestamp },
              state: { status: "pending", input: "" },
            })
          })
          break
        case "session.next.tool.input.delta":
          message.update(event.properties.sessionID, (draft) => {
            const match = message.latestTool(
              message.assistant(draft, event.properties.assistantMessageID),
              event.properties.callID,
            )
            if (match?.state.status === "pending") match.state.input += event.properties.delta
          })
          break
        case "session.next.tool.input.ended":
          message.update(event.properties.sessionID, (draft) => {
            const match = message.latestTool(
              message.assistant(draft, event.properties.assistantMessageID),
              event.properties.callID,
            )
            if (match?.state.status === "pending") match.state.input = event.properties.text
          })
          break
        case "session.next.tool.called":
          message.update(event.properties.sessionID, (draft) => {
            const match = message.latestTool(
              message.assistant(draft, event.properties.assistantMessageID),
              event.properties.callID,
            )
            if (!match) return
            match.time.ran = event.properties.timestamp
            match.provider = event.properties.provider
            match.state = { status: "running", input: event.properties.input, structured: {}, content: [] }
          })
          break
        case "session.next.tool.progress":
          message.update(event.properties.sessionID, (draft) => {
            const match = message.latestTool(
              message.assistant(draft, event.properties.assistantMessageID),
              event.properties.callID,
            )
            if (match?.state.status !== "running") return
            match.state.structured = event.properties.structured
            match.state.content = [...event.properties.content]
          })
          break
        case "session.next.tool.success":
          message.update(event.properties.sessionID, (draft) => {
            const match = message.latestTool(
              message.assistant(draft, event.properties.assistantMessageID),
              event.properties.callID,
            )
            if (match?.state.status !== "running") return
            match.state = {
              status: "completed",
              input: match.state.input,
              structured: event.properties.structured,
              content: [...event.properties.content],
              result: event.properties.result,
            }
            match.provider = {
              executed: event.properties.provider.executed || match.provider?.executed === true,
              metadata: match.provider?.metadata,
              resultMetadata: event.properties.provider.metadata,
            }
            match.time.completed = event.properties.timestamp
          })
          break
        case "session.next.tool.failed":
          message.update(event.properties.sessionID, (draft) => {
            const match = message.latestTool(
              message.assistant(draft, event.properties.assistantMessageID),
              event.properties.callID,
            )
            if (!match || (match.state.status !== "pending" && match.state.status !== "running")) return
            match.state = {
              status: "error",
              error: event.properties.error,
              input: typeof match.state.input === "string" ? {} : match.state.input,
              structured: match.state.status === "running" ? match.state.structured : {},
              content: match.state.status === "running" ? match.state.content : [],
              result: event.properties.result,
            }
            match.provider = {
              executed: event.properties.provider.executed || match.provider?.executed === true,
              metadata: match.provider?.metadata,
              resultMetadata: event.properties.provider.metadata,
            }
            match.time.completed = event.properties.timestamp
          })
          break
        case "session.next.reasoning.started":
          message.update(event.properties.sessionID, (draft) => {
            message.assistant(draft, event.properties.assistantMessageID)?.content.push({
              type: "reasoning",
              id: event.properties.reasoningID,
              text: "",
              providerMetadata: event.properties.providerMetadata,
            })
          })
          break
        case "session.next.reasoning.delta":
          message.update(event.properties.sessionID, (draft) => {
            const match = message.latestReasoning(
              message.assistant(draft, event.properties.assistantMessageID),
              event.properties.reasoningID,
            )
            if (match) match.text += event.properties.delta
          })
          break
        case "session.next.reasoning.ended":
          message.update(event.properties.sessionID, (draft) => {
            const match = message.latestReasoning(
              message.assistant(draft, event.properties.assistantMessageID),
              event.properties.reasoningID,
            )
            if (match) {
              match.text = event.properties.text
              if (event.properties.providerMetadata !== undefined)
                match.providerMetadata = event.properties.providerMetadata
            }
          })
          break
        case "session.next.retried":
        case "session.next.compaction.started":
        case "session.next.compaction.delta":
          break
        case "session.next.compaction.ended":
          message.update(event.properties.sessionID, (draft) => {
            message.prepend(draft, {
              id: event.properties.messageID,
              type: "compaction",
              reason: event.properties.reason,
              summary: event.properties.text,
              recent: event.properties.recent,
              time: { created: event.properties.timestamp },
            })
          })
          break
        case "reference.updated":
          void result.location.reference.refresh()
          break
        case "integration.updated":
          void Promise.all([
            result.location.integration.refresh({ directory: metadata.directory, workspaceID: metadata.workspace }),
            result.location.model.refresh({ directory: metadata.directory, workspaceID: metadata.workspace }),
            result.location.provider.refresh({ directory: metadata.directory, workspaceID: metadata.workspace }),
          ])
          break
      }
    })

    const result = {
      session: {
        get(sessionID: string) {
          return store.session.info[sessionID]
        },
        async refresh(sessionID: string) {
          const result = await sdk.client.v2.session.get({ sessionID }, { throwOnError: true })
          setStore("session", "info", sessionID, result.data.data)
        },
        message: {
          list(sessionID: string) {
            return store.session.message[sessionID]
          },
          async refresh(sessionID: string) {
            const result = await sdk.client.v2.session.messages({ sessionID }, { throwOnError: true })
            setStore("session", "message", sessionID, result.data.data)
          },
        },
        permission: {
          list(sessionID: string) {
            return store.session.permission[sessionID]
          },
          async refresh(sessionID: string) {
            const result = await sdk.client.v2.session.permission.list({ sessionID }, { throwOnError: true })
            setStore("session", "permission", sessionID, result.data.data)
          },
        },
        question: {
          list(sessionID: string) {
            return store.session.question[sessionID]
          },
          async refresh(sessionID: string) {
            const result = await sdk.client.v2.session.question.list({ sessionID }, { throwOnError: true })
            setStore("session", "question", sessionID, result.data.data)
          },
        },
      },
      project: {
        permission: {
          list(projectID: string) {
            return store.project.permission[projectID]
          },
          async refresh(projectID: string) {
            const result = await sdk.client.v2.permission.saved.list({ projectID }, { throwOnError: true })
            setStore("project", "permission", projectID, result.data.data)
          },
        },
      },
      location: {
        default() {
          return defaultLocation()
        },
        async refresh(ref?: LocationRef) {
          const response = await sdk.client.v2.location.get({ location: locationQuery(ref) }, { throwOnError: true })
          const location = response.data
          const key = locationKey(location)
          if (!store.location[key]) setStore("location", key, {})
          if (!ref) setDefaultLocation({ directory: location.directory, workspaceID: location.workspaceID })
        },
        agent: {
          list(location?: LocationRef) {
            return store.location[locationKey(location ?? defaultLocation())]?.agent
          },
          async refresh(ref?: LocationRef) {
            const result = await sdk.client.v2.agent.list({ location: locationQuery(ref) }, { throwOnError: true })
            const key = locationKey(result.data.location)
            setStore("location", key, "agent", result.data.data)
          },
        },
        command: {
          list(location?: LocationRef) {
            return store.location[locationKey(location ?? defaultLocation())]?.command
          },
          async refresh(ref?: LocationRef) {
            const result = await sdk.client.v2.command.list({ location: locationQuery(ref) }, { throwOnError: true })
            const key = locationKey(result.data.location)
            setStore("location", key, "command", result.data.data)
          },
        },
        integration: {
          list(location?: LocationRef) {
            return store.location[locationKey(location ?? defaultLocation())]?.integration
          },
          async refresh(ref?: LocationRef) {
            const result = await sdk.client.v2.integration.list(
              { location: locationQuery(ref) },
              { throwOnError: true },
            )
            const key = locationKey(result.data.location)
            setStore("location", key, "integration", result.data.data)
          },
        },
        model: {
          list(location?: LocationRef) {
            return store.location[locationKey(location ?? defaultLocation())]?.model
          },
          async refresh(ref?: LocationRef) {
            const result = await sdk.client.v2.model.list({ location: locationQuery(ref) }, { throwOnError: true })
            const key = locationKey(result.data.location)
            setStore("location", key, "model", result.data.data)
          },
        },
        provider: {
          list(location?: LocationRef) {
            return store.location[locationKey(location ?? defaultLocation())]?.provider
          },
          async refresh(ref?: LocationRef) {
            const result = await sdk.client.v2.provider.list({ location: locationQuery(ref) }, { throwOnError: true })
            const key = locationKey(result.data.location)
            setStore("location", key, "provider", result.data.data)
          },
        },
        reference: {
          list(location?: LocationRef) {
            return store.location[locationKey(location ?? defaultLocation())]?.reference
          },
          async refresh(ref?: LocationRef) {
            const result = await sdk.client.v2.reference.list({ location: locationQuery(ref) }, { throwOnError: true })
            const key = locationKey(result.data.location)
            setStore("location", key, "reference", result.data.data)
          },
        },
        skill: {
          list(location?: LocationRef) {
            return store.location[locationKey(location ?? defaultLocation())]?.skill
          },
          async refresh(ref?: LocationRef) {
            const result = await sdk.client.v2.skill.list({ location: locationQuery(ref) }, { throwOnError: true })
            const key = locationKey(result.data.location)
            setStore("location", key, "skill", result.data.data)
          },
        },
      },
    }

    onMount(() => {
      void Promise.allSettled([
        result.location.refresh(),
        result.location.agent.refresh(),
        result.location.integration.refresh(),
        result.location.model.refresh(),
        result.location.provider.refresh(),
        result.location.reference.refresh(),
        result.location.command.refresh(),
        result.location.skill.refresh(),
      ]).then((settled) => {
        for (const failure of settled.filter((item) => item.status === "rejected"))
          console.error("Failed to refresh default location data", failure.reason)
      })
    })

    return result
  },
})
