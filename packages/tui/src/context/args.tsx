import { createSignal } from "solid-js"
import { createSimpleContext } from "./helper"

export interface Args {
  model?: string
  agent?: string
  prompt?: string
  continue?: boolean
  sessionID?: string
  fork?: boolean
  auto?: boolean
}

export const { use: useArgs, provider: ArgsProvider } = createSimpleContext({
  name: "Args",
  init: (props: Args) => {
    const [prompt, setPrompt] = createSignal(props.prompt)

    return {
      get model() {
        return props.model
      },
      get agent() {
        return props.agent
      },
      get prompt() {
        return prompt()
      },
      get continue() {
        return props.continue
      },
      get sessionID() {
        return props.sessionID
      },
      get fork() {
        return props.fork
      },
      consumePrompt() {
        const value = prompt()
        if (!value) return
        setPrompt(undefined)
        return value
      },
    }
  },
})
