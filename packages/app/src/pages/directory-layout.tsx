import { createMemo, Show, type ParentProps } from "solid-js"
import { useParams } from "@solidjs/router"
import { SDKProvider, useSDK } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { LocalProvider } from "@/context/local"
import { useWorktree } from "@/context/worktree"

import { base64Decode } from "@opencode-ai/util/encode"
import { DataProvider } from "@opencode-ai/ui/context"
import { iife } from "@opencode-ai/util/iife"

export default function Layout(props: ParentProps) {
  const params = useParams()
  const worktree = useWorktree()

  const baseDirectory = createMemo(() => {
    return base64Decode(params.dir!)
  })

  const directory = createMemo(() => {
    const base = baseDirectory()
    const sessionID = params.id
    if (!sessionID) return base
    return worktree.directory(sessionID) ?? base
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

            return (
              <DataProvider data={sync.data} directory={directory()} onPermissionRespond={respond}>
                <LocalProvider>{props.children}</LocalProvider>
              </DataProvider>
            )
          })}
        </SyncProvider>
      </SDKProvider>
    </Show>
  )
}
