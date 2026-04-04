import type { UserMessage } from "@f5xc-salesdemos/sdk/v2"

type Local = {
  session: {
    reset(): void
    restore(msg: UserMessage): void
  }
}

export const resetSessionModel = (local: Local) => {
  local.session.reset()
}

export const syncSessionModel = (local: Local, msg: UserMessage) => {
  local.session.restore(msg)
}
