import type { UserMessage } from "@opencode-ai/sdk/v2"
import { batch } from "solid-js"

type Local = {
  agent: {
    set(name: string | undefined): void
  }
  model: {
    set(model: UserMessage["model"] | undefined): void
    current():
      | {
          id: string
          provider: { id: string }
        }
      | undefined
    variant: {
      set(value: string | undefined): void
    }
  }
}

export const syncSessionModel = (local: Local, msg: UserMessage) => {
  batch(() => {
    local.agent.set(msg.agent)
    local.model.set(msg.model)
  })

  const model = local.model.current()
  if (!model) return
  if (model.provider.id !== msg.model.providerID) return
  if (model.id !== msg.model.modelID) return
  local.model.variant.set(msg.variant)
}
