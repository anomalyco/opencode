import { createMemo, type ParentProps } from "solid-js"
import { useParams } from "@solidjs/router"
import { SDKProvider } from "@/context/sdk"
import { SyncProvider } from "@/context/sync"
import { LocalProvider } from "@/context/local"
import { useGlobalSync } from "@/context/global-sync"
import { base64Decode } from "@/utils"

export default function Layout(props: ParentProps) {
  const params = useParams()
  const sync = useGlobalSync()
  const directory = createMemo(() => {
    const decoded = base64Decode(params.dir)
    return sync.data.projects.find((x) => x.worktree === decoded)?.worktree ?? "/"
  })
  return (
    <SDKProvider directory={directory()}>
      <SyncProvider>
        <LocalProvider>{props.children}</LocalProvider>
      </SyncProvider>
    </SDKProvider>
  )
}
