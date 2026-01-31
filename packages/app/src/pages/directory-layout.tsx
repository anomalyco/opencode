import { createEffect, createMemo, Show, type ParentProps } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { SDKProvider, useSDK } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { LocalProvider } from "@/context/local"
import { useLayout } from "@/context/layout"

import { DataProvider } from "@opencode-ai/ui/context"
import { iife } from "@opencode-ai/util/iife"
import type { QuestionAnswer } from "@opencode-ai/sdk/v2"
import { decode64 } from "@/utils/base64"
import { showToast } from "@opencode-ai/ui/toast"
import { useLanguage } from "@/context/language"

export default function Layout(props: ParentProps) {
  const params = useParams()
  const navigate = useNavigate()
  const layout = useLayout()
  const language = useLanguage()
  const directory = createMemo(() => {
    return decode64(params.dir) ?? ""
  })

  createEffect(() => {
    if (!params.dir) return
    if (directory()) return
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: "Invalid directory in URL.",
    })
    navigate("/")
  })
  return (
    <Show when={directory()}>
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

            const replyToQuestion = (input: { requestID: string; answers: QuestionAnswer[] }) =>
              sdk.client.question.reply(input)

            const rejectQuestion = (input: { requestID: string }) => sdk.client.question.reject(input)

            const navigateToSession = (sessionID: string) => {
              navigate(`/${params.dir}/session/${sessionID}`)
            }

            const openFile = (path: string) => {
              // Only works when we're in a session context
              const sessionId = params.id
              if (!sessionId) return

              const sessionKey = `${params.dir}${sessionId ? "/" + sessionId : ""}`
              const tabs = layout.tabs(sessionKey)

              // Normalize path the same way file.tab() does
              let normalized = path
              if (normalized.startsWith("file://")) {
                normalized = normalized.slice(7)
              }
              const root = directory()
              if (root && normalized.startsWith(root)) {
                normalized = normalized.slice(root.length)
              }
              if (normalized.startsWith("./")) {
                normalized = normalized.slice(2)
              }
              if (normalized.startsWith("/")) {
                normalized = normalized.slice(1)
              }

              const tabValue = `file://${normalized}`
              tabs.open(tabValue)
            }

            return (
              <DataProvider
                data={sync.data}
                directory={directory()}
                onPermissionRespond={respond}
                onQuestionReply={replyToQuestion}
                onQuestionReject={rejectQuestion}
                onNavigateToSession={navigateToSession}
                onOpenFile={openFile}
              >
                <LocalProvider>{props.children}</LocalProvider>
              </DataProvider>
            )
          })}
        </SyncProvider>
      </SDKProvider>
    </Show>
  )
}
