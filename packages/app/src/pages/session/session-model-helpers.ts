import type { UserMessage } from "@opencode-ai/sdk/v2"
import { batch } from "solid-js"

type Local = {
  agent: {
    current():
      | {
          model?: UserMessage["model"]
          variant?: string
        }
      | undefined
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

export const resetSessionModel = (local: Local) => {
  const agent = local.agent.current()
  if (!agent) return
  batch(() => {
    local.model.set(agent.model)
    local.model.variant.set(agent.variant)
  })
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
