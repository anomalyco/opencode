import { createMemo } from "solid-js"
import { useServerSync } from "./server-sync"
import { useSDK } from "./sdk"

export const useSync = () => {
  const serverSync = useServerSync()
  const sdk = useSDK()

  return createMemo(() => serverSync.ensureDirSyncContext(sdk().directory))
}

export type DirectorySync = ReturnType<ReturnType<typeof useSync>>
