import type {
  AgentV2Info,
  CommandV2Info,
  IntegrationInfo,
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
  V2Event,
} from "@bolt-ai/sdk/v2"
import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { useClient } from "./client"

export { locationKey } from "@opencode/client/solid"
export type { FormWithLocation } from "@opencode/client/solid"

export const { use: useData, provider: DataProvider } = createSimpleContext({
  name: "Data",
  init: (props: { directory: string }) => {
    const client = useClient()
    const data = createData({
      api: () => client.api,
      event: client.event,
      connection: client.connection,
      directory: props.directory,
    })
    data satisfies Plugin.Context["data"]
    const [generatingTitles, setGeneratingTitles] = createStore<Record<string, boolean | undefined>>({})
    return {
      ...data,
      location: {
        ...data.location,
        async sync(ref?: LocationRef) {
          await data.location.syncInfo(ref)
          await Promise.all([data.location.sync(ref), data.location.config.sync(ref)])
        },
      },
      session: {
        ...data.session,
        title: {
          pending: (sessionID: string) => generatingTitles[sessionID] === true,
          async generate(sessionID: string) {
            if (generatingTitles[sessionID]) return
            setGeneratingTitles(sessionID, true)
            await client.api.session
              .update({ sessionID, title: "" })
              .then(() => {
                // The HTTP response can beat the renamed event. Keep pending until the new title is projected locally.
                data.session.invalidate(sessionID)
                return data.session.sync(sessionID)
              })
              .finally(() => setGeneratingTitles(sessionID, undefined))
          },
        },
      },
    }
  },
})
