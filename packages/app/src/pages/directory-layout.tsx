import { createMemo, Show, type ParentProps } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { SDKProvider, useSDK } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { LocalProvider } from "@/context/local"

import { base64Decode } from "@opencode-ai/util/encode"
import { DataProvider } from "@opencode-ai/ui/context"
import { iife } from "@opencode-ai/util/iife"
import type { QuestionAnswer } from "@opencode-ai/sdk/v2"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Logo } from "@opencode-ai/ui/logo"

function SyncGate(props: ParentProps) {
  const sync = useSync()
  return (
    <Show
      when={sync.ready}
      fallback={
        <div class="h-screen w-screen flex flex-col items-center justify-center bg-background-base gap-6">
          <Logo class="w-58.5 opacity-12" />
          <div class="flex items-center gap-2 text-text-weak">
            <Spinner class="size-4" />
            <span>Loading...</span>
          </div>
        </div>
      }
    >
      {props.children}
    </Show>
  )
}

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
          <SyncGate>
            {iife(() => {
              const sync = useSync()
              const sdk = useSDK()
              const respond = (input: {
                sessionID: string
                permissionID: string
                response: "once" | "always" | "reject"
              }) => sdk.client.permission.respond(input)

              const respondToQuestion = (input: { requestID: string; answers: QuestionAnswer[] }) =>
                sdk.client.question.reply(input)

              const rejectQuestion = (input: { requestID: string }) => sdk.client.question.reject(input)

              const navigateToSession = (sessionID: string) => {
                navigate(`/${params.dir}/session/${sessionID}`)
              }

              return (
                <DataProvider
                  data={sync.data}
                  directory={directory()}
                  onPermissionRespond={respond}
                  onQuestionRespond={respondToQuestion}
                  onQuestionReject={rejectQuestion}
                  onNavigateToSession={navigateToSession}
                >
                  <LocalProvider>{props.children}</LocalProvider>
                </DataProvider>
              )
            })}
          </SyncGate>
        </SyncProvider>
      </SDKProvider>
    </Show>
  )
}
