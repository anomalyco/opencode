import { createSimpleContext } from "./helper"

export interface Args {
  model?: string
  agent?: string
  prompt?: string
  remote?: boolean
  continue?: boolean
  sessionID?: string
  fork?: boolean
  remoteSessions?: {
    id: string
    title?: string
  }[]
}

export const { use: useArgs, provider: ArgsProvider } = createSimpleContext({
  name: "Args",
  init: (props: Args) => props,
})
