import { createSignal } from "solid-js"
import { createSimpleContext } from "./helper"

export type IdeContextFile = {
  path: string
  selection?: { startLine: number; endLine: number }
  active: boolean
}

export const { use: useIdeContext, provider: IdeContextProvider } = createSimpleContext({
  name: "IdeContext",
  init: () => {
    const [files, setFiles] = createSignal<IdeContextFile[]>([])

    return {
      files,
      setFiles,
      clear: () => setFiles([]),
    }
  },
})
