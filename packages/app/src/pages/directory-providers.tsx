import { DataProvider } from "@opencode-ai/ui/context"
import { base64Encode } from "@opencode-ai/util/encode"
import { useLocation, useNavigate } from "@solidjs/router"
import { createEffect, createMemo, type ParentProps } from "solid-js"
import { LocalProvider } from "@/context/local"
import { OpenFilePathProvider, useOpenFilePath } from "@/context/open-file-path"
import { SDKProvider } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"

function DirectoryData(props: ParentProps<{ directory: string }>) {
  const location = useLocation()
  const navigate = useNavigate()
  const sync = useSync()
  const slug = createMemo(() => base64Encode(props.directory))
  const open = useOpenFilePath()

  createEffect(() => {
    const next = sync.data.path.directory
    if (!next || next === props.directory) return
    const path = location.pathname.slice(slug().length + 1)
    navigate(`/${base64Encode(next)}${path}${location.search}${location.hash}`, { replace: true })
  })

  return (
    <DataProvider
      data={sync.data}
      directory={props.directory}
      onNavigateToSession={(sessionID: string) => navigate(`/${slug()}/session/${sessionID}`)}
      onSessionHref={(sessionID: string) => `/${slug()}/session/${sessionID}`}
      onOpenFilePath={open.open}
    >
      <LocalProvider>{props.children}</LocalProvider>
    </DataProvider>
  )
}

export function DirectoryProviders(props: ParentProps<{ directory: string }>) {
  return (
    <SDKProvider directory={() => props.directory}>
      <SyncProvider>
        <OpenFilePathProvider directory={props.directory}>
          <DirectoryData directory={props.directory}>{props.children}</DirectoryData>
        </OpenFilePathProvider>
      </SyncProvider>
    </SDKProvider>
  )
}
