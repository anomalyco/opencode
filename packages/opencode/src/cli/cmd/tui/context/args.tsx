import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"

export interface Args {
  model?: string
  agent?: string
  prompt?: string
  continue?: boolean
  sessionID?: string
  fork?: boolean
}

export const { use: useArgs, provider: ArgsProvider } = createSimpleContext({
  name: "Args",
  init: (props: Args) => {
    const [data, setData] = createStore<Args>({
      model: props.model,
      agent: props.agent,
      prompt: props.prompt,
      continue: props.continue,
      sessionID: props.sessionID,
      fork: props.fork,
    })

    return {
      get data() {
        return data
      },
      consumePrompt() {
        const value = data.prompt
        if (!value) return
        setData("prompt", undefined) // clear the prompt from the args once used
        return value
      },
    }
  },
})
