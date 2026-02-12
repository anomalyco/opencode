import { createEffect, createMemo, Show, type ParentProps } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { SDKProvider, useSDK } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { LocalProvider } from "@/context/local"

import { DataProvider } from "@opencode-ai/ui/context"
import { iife } from "@opencode-ai/util/iife"
import type { QuestionAnswer } from "@opencode-ai/sdk/v2"
import { decode64 } from "@/utils/base64"
import { showToast } from "@opencode-ai/ui/toast"
import { useLanguage } from "@/context/language"

import { base64Encode } from "@opencode-ai/util/encode"

export default function Layout(props: ParentProps) {
  const params = useParams()
  const navigate = useNavigate()
  const language = useLanguage()
  let invalid = ""
  const directory = createMemo(() => {
    return decode64(params.dir) ?? ""
  })

  createEffect(() => {
    if (!params.dir) return
    if (directory()) return
    if (invalid === params.dir) return
    invalid = params.dir
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: language.t("directory.error.invalidUrl"),
    })
    navigate("/", { replace: true })
  })
  return (
    <Show when={directory()}>
      <SDKProvider directory={directory}>
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

            const sessionHref = (sessionID: string) => {
              if (params.dir) return `/${params.dir}/session/${sessionID}`
              return `/session/${sessionID}`
            }

            const syncSession = (sessionID: string) => sync.session.sync(sessionID)

            const undoMessage = async (sessionID: string, messageID: string) => {
              const status = sync.data.session_status[sessionID]
              if (status?.type !== "idle") {
                await sdk.client.session.abort({ sessionID }).catch(() => {})
              }
              await sdk.client.session.revert({ sessionID, messageID })
            }

            const forkMessage = async (sessionID: string, messageID: string) => {
              const msgs = sync.data.message[sessionID]
              let cutoffID: string | undefined
              if (msgs) {
                const idx = msgs.findIndex((m) => m.id === messageID)
                if (idx !== -1 && idx + 1 < msgs.length) cutoffID = msgs[idx + 1]!.id
              }
              const result = await sdk.client.session.fork({ sessionID, messageID: cutoffID })
              if (!result.data) return
              navigate(`/${base64Encode(sdk.directory)}/session/${result.data.id}`)
            }

            return (
              <DataProvider
                data={sync.data}
                directory={directory()}
                onPermissionRespond={respond}
                onQuestionReply={replyToQuestion}
                onQuestionReject={rejectQuestion}
                onNavigateToSession={navigateToSession}
                onSessionHref={sessionHref}
                onSyncSession={syncSession}
                onUndoMessage={undoMessage}
                onForkMessage={forkMessage}
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
