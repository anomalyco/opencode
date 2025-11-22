import type { Message, Session, Part, FileDiff, SessionStatus } from "@opencode-ai/sdk"
import { createSimpleContext } from "./helper"

type Data = {
  session: Session[]
  session_status: {
    [sessionID: string]: SessionStatus
  }
  session_diff: {
    [sessionID: string]: FileDiff[]
  }
  message: {
    [sessionID: string]: Message[]
  }
  part: {
    [messageID: string]: Part[]
  }
}

export const { use: useData, provider: DataProvider } = createSimpleContext({
  name: "Data",
  init: (props: { data: Data }) => {
    return props.data
  },
})
