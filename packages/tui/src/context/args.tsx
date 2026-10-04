import type { Session } from "@opencode/schema/session"
import { mergeProps } from "solid-js"
import { createSimpleContext } from "./helper"

export interface Args {
  model?: string
  agent?: string
  prompt?: string
  continue?: boolean
  sessionID?: Session.ID
  newSessionID?: Session.ID
  fork?: boolean
  auto?: boolean
}

export const { use: useArgs, provider: ArgsProvider } = createSimpleContext({
  name: "Args",
  init: (props: Args) => {
    // The first new session created from home takes this ID; later ones mint their own.
    let pending = props.newSessionID
    return mergeProps(props, {
      takeNewSessionID() {
        const id = pending
        pending = undefined
        return id
      },
      restoreNewSessionID(id: Session.ID) {
        pending ??= id
      },
    })
  },
})
