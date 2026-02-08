import { createEffect, createMemo, Show, type JSX, type ParentComponent, type ParentProps } from "solid-js"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { SDKProvider, useSDK } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { LocalProvider } from "@/context/local"
import { useServer } from "@/context/server"
import { TerminalProvider } from "@/context/terminal"
import { FileProvider } from "@/context/file"
import { PromptProvider } from "@/context/prompt"
import { CommentsProvider } from "@/context/comments"

import { DataProvider } from "@opencode-ai/ui/context"
import { iife } from "@opencode-ai/util/iife"
import type { QuestionAnswer } from "@opencode-ai/sdk/v2"
import { decode64 } from "@/utils/base64"
import { showToast } from "@opencode-ai/ui/toast"
import { useLanguage } from "@/context/language"
import { getExtensions } from "@opencode-ai/app-shared"

// Helper: wrap children with a list of providers
function wrapProviders(providers: ParentComponent[] | undefined, children: JSX.Element): JSX.Element {
  return (providers ?? []).reduceRight<JSX.Element>((acc, Provider) => <Provider>{acc}</Provider>, children)
}

export default function Layout(props: ParentProps) {
  const params = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const server = useServer()
  const language = useLanguage()
  const directory = createMemo(() => {
    return decode64(params.dir) ?? ""
  })

  // Error handling for invalid directory
  createEffect(() => {
    if (!params.dir) return
    if (directory()) return
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: language.t("directory.error.invalidUrl"),
    })
    navigate("/")
  })

  // Restore remembered server URL for this workspace
  createEffect(() => {
    const remembered = server.forWorkspace(directory())
    if (remembered && remembered !== server.url) {
      // Only auto-switch when we're still pointed at localhost
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(server.url)) {
        server.add(remembered)
      }
    }
  })

  // Use extension to resolve cloud session URLs
  createEffect(() => {
    const ext = getExtensions()
    if (!ext.server.resolveSessionUrl) return

    const current = server.url
    if (!current) return

    // Only auto-switch when pointed at localhost
    if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(current)) return

    const pathname = location.pathname
    const match = pathname.match(/\/session\/([^/]+)$/)
    const sessionId = match?.[1]
    if (!sessionId || sessionId === "new") return

    let cancelled = false
    void ext.server.resolveSessionUrl(sessionId).then((gatewayUrl) => {
      if (cancelled) return
      if (!gatewayUrl) return
      if (gatewayUrl === server.url) return
      server.add(gatewayUrl)
    })

    return () => {
      cancelled = true
    }
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

            const ext = getExtensions()

            return (
              <DataProvider
                data={sync.data}
                directory={directory()}
                onPermissionRespond={respond}
                onQuestionReply={replyToQuestion}
                onQuestionReject={rejectQuestion}
                onNavigateToSession={navigateToSession}
              >
                <TerminalProvider>
                  <FileProvider>
                    <PromptProvider>
                      <CommentsProvider>
                        <LocalProvider>
                          {wrapProviders(ext.app.directoryProviders, props.children)}
                        </LocalProvider>
                      </CommentsProvider>
                    </PromptProvider>
                  </FileProvider>
                </TerminalProvider>
              </DataProvider>
            )
          })}
        </SyncProvider>
      </SDKProvider>
    </Show>
  )
}
