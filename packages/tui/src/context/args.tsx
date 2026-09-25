import { createSimpleContext } from "./helper"

export interface Args {
  model?: string
  agent?: string
  prompt?: string
  continue?: boolean
  sessionID?: string
  createSessionID?: string
  fork?: boolean
  auto?: boolean
}

// A --session-id launch id is consumed by the prompt's first fresh-session
// submit and then cleared, so later new sessions mint their own ids. Context
// props are read-only getters, so the pending id lives in module scope.
let pendingCreateSessionID: string | undefined

export function seedCreateSessionID(id: string | undefined) {
  pendingCreateSessionID = id
}

export function takeCreateSessionID() {
  const id = pendingCreateSessionID
  pendingCreateSessionID = undefined
  return id
}

export const { use: useArgs, provider: ArgsProvider } = createSimpleContext({
  name: "Args",
  init: (props: Args) => props,
})
