import { onCleanup, onMount } from "solid-js"
import { OPEN_FILE_PATH_EVENT } from "@/utils/open-file-path"

export const useSessionOpenFile = (open: (path: string, line?: number) => void) => {
  onMount(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ path?: string; line?: number }>).detail
      if (!detail?.path) return
      open(detail.path, detail.line)
    }

    window.addEventListener(OPEN_FILE_PATH_EVENT, onOpen)
    onCleanup(() => window.removeEventListener(OPEN_FILE_PATH_EVENT, onOpen))
  })
}
