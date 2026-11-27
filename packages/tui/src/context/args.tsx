import { mergeProps } from "solid-js"
import { createSimpleContext } from "./helper"

export interface Args {
  model?: string
  agent?: string
  prompt?: string
  continue?: boolean
  sessionID?: string
  newSessionID?: string
  fork?: boolean
  auto?: boolean
}

export const { use: useArgs, provider: ArgsProvider } = createSimpleContext({
  name: "Args",
  init: (props: Args) => {
    // The first new session created from home takes this ID; later ones mint their own.
    let pending = props.newSessionID
    // The startup prompt fills one composer: the session that --session or --continue opens, or else the first home view.
    let prompt = props.prompt
    return mergeProps(props, {
      takePrompt() {
        const text = prompt
        prompt = undefined
        return text
      },
      takeNewSessionID() {
        const id = pending
        pending = undefined
        return id
      },
      restoreNewSessionID(id: string) {
        pending ??= id
      },
    })
  },
})
