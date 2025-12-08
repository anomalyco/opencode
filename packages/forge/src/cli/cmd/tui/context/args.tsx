import { createSimpleContext } from "./helper"
import type { AgentFlag } from "@/cli/cmd/session-init"

export interface Args {
  agents?: AgentFlag[]
  prompt?: string
  continue?: boolean
  sessionID?: string
}

export const { use: useArgs, provider: ArgsProvider } = createSimpleContext({
  name: "Args",
  init: (props: Args) => props,
})
