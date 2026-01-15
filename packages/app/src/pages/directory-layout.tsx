import { createMemo, createSignal, onCleanup, Show, type ParentProps } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { SDKProvider, useSDK } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { LocalProvider } from "@/context/local"
import { FileActivityProvider } from "@/context/file-activity"
import { useLayout } from "@/context/layout"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { WorkspaceSidebar } from "@/components/workspace-sidebar"

import { base64Decode } from "@opencode-ai/util/encode"
import { DataProvider } from "@opencode-ai/ui/context"
import { iife } from "@opencode-ai/util/iife"

export default function Layout(props: ParentProps) {
  const params = useParams()
  const navigate = useNavigate()
  const directory = createMemo(() => {
    return base64Decode(params.dir!)
  })
  return (
    <Show when={params.dir} keyed>
      <SDKProvider directory={directory()}>
        <SyncProvider>
          {iife(() => {
            const sync = useSync()
            const sdk = useSDK()
            const respond = (input: {
              sessionID: string
              permissionID: string
              response: "once" | "always" | "reject"
            }) => sdk.client.permission.respond(input)

            const navigateToSession = (sessionID: string) => {
              navigate(`/${params.dir}/session/${sessionID}`)
            }

            const layout = useLayout()

            // Handler for file chip clicks - opens file preview panel
            const handleFileClick = (path: string) => {
              console.log("[directory-layout] File chip clicked with path:", path)
              layout.filePreview.open(path)
            }
            const xlQuery = window.matchMedia("(min-width: 1280px)")
            const [isLargeViewport, setIsLargeViewport] = createSignal(xlQuery.matches)
            const handleViewportChange = (e: MediaQueryListEvent) => setIsLargeViewport(e.matches)
            xlQuery.addEventListener("change", handleViewportChange)
            onCleanup(() => xlQuery.removeEventListener("change", handleViewportChange))

            return (
              <DataProvider
                data={sync.data}
                directory={directory()}
                onPermissionRespond={respond}
                onNavigateToSession={navigateToSession}
                onFileClick={handleFileClick}
              >
                <LocalProvider>
                  <FileActivityProvider>
                  <div class="flex size-full">
                    <div class="flex-1 min-w-0">{props.children}</div>
                    {/* Workspace Files Sidebar - Right Side */}
                    <Show when={layout.workspaceSidebar.opened() && isLargeViewport()}>
                      <div
                        class="relative shrink-0"
                        style={{ width: `${layout.workspaceSidebar.width()}px` }}
                      >
                        <WorkspaceSidebar
                          workspacePath={directory()}
                          class="size-full"
                        />
                        <ResizeHandle
                          direction="horizontal"
                          invert={true}
                          size={layout.workspaceSidebar.width()}
                          min={200}
                          max={600}
                          collapseThreshold={150}
                          onResize={layout.workspaceSidebar.resize}
                          onCollapse={layout.workspaceSidebar.close}
                        />
                      </div>
                    </Show>
                  </div>
                  </FileActivityProvider>
                </LocalProvider>
              </DataProvider>
            )
          })}
        </SyncProvider>
      </SDKProvider>
    </Show>
  )
}
