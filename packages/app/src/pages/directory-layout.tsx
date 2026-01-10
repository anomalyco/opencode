import { createMemo, Show, type ParentProps } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { SDKProvider, useSDK } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { LocalProvider, useLocal } from "@/context/local"

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
          <LocalProvider>
            {iife(() => {
              const sync = useSync()
              const sdk = useSDK()
              const local = useLocal()
              const respond = (input: {
                sessionID: string
                permissionID: string
                response: "once" | "always" | "reject"
              }) => sdk.client.permission.respond(input)

              const respondToModeSwitch = (input: {
                sessionID: string
                requestID: string
                response: "approve" | "reject"
                targetMode?: string
              }) => {
                sdk.client.modeswitch.reply({ requestID: input.requestID, reply: input.response })
                if (input.response === "approve" && input.targetMode) {
                  local.agent.set(input.targetMode)
                }
              }

              const navigateToSession = (sessionID: string) => {
                navigate(`/${params.dir}/session/${sessionID}`)
              }

              return (
                <DataProvider
                  data={sync.data}
                  directory={directory()}
                  onPermissionRespond={respond}
                  onModeSwitchRespond={respondToModeSwitch}
                  onNavigateToSession={navigateToSession}
                >
                  {props.children}
                </DataProvider>
              )
            })}
          </LocalProvider>
        </SyncProvider>
      </SDKProvider>
    </Show>
  )
}
