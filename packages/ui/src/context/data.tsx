import type { Message, Session, Part, FileDiff, SessionStatus } from "@opencode-ai/sdk"
import { createSimpleContext } from "./helper"
import { PreloadMultiFileDiffResult } from "@pierre/precision-diffs/ssr"

type Data = {
  session: Session[]
  session_status: {
    [sessionID: string]: SessionStatus
  }
  session_diff: {
    [sessionID: string]: FileDiff[]
  }
  session_diff_preload?: {
    [sessionID: string]: PreloadMultiFileDiffResult<any>[]
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
  init: (props: { data: Data; directory: string }) => {
    return { store: props.data, directory: props.directory }
  },
})
