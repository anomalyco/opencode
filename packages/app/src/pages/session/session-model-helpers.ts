import type { UserMessage } from "@opencode-ai/sdk/v2"

type Local = {
  session: {
    reset(): void
    restore(msg: UserMessage): void
    sync?(msg: UserMessage): void
  }
}

export const resetSessionModel = (local: Local) => {
  local.session.reset()
}

export const syncSessionModel = (local: Local, msg: UserMessage) => {
  if (local.session.sync) {
    local.session.sync(msg)
    return
  }
  local.session.restore(msg)
}
