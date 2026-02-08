/**
 * DirectoryScope
 *
 * Provides the full directory-level provider chain (SDK, Sync, Terminal, File, etc.)
 * accepting `directory` as a prop instead of reading from the URL via useParams().
 *
 * This enables multiple directory scopes to be mounted simultaneously in split mode,
 * each rendering their own session content with their own provider stack.
 *
 * The provider chain mirrors directory-layout.tsx but is decoupled from routing.
 */

import { type ParentProps, type ParentComponent, type JSX } from "solid-js"
import { SDKProvider, useSDK } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { LocalProvider } from "@/context/local"
import { TerminalProvider } from "@/context/terminal"
import { FileProvider } from "@/context/file"
import { PromptProvider } from "@/context/prompt"
import { CommentsProvider } from "@/context/comments"
import { DataProvider } from "@opencode-ai/ui/context"
import { iife } from "@opencode-ai/util/iife"
import type { QuestionAnswer } from "@opencode-ai/sdk/v2"
import { getExtensions } from "@opencode-ai/app-shared"
import { base64Encode } from "@opencode-ai/util/encode"

// Helper: wrap children with a list of providers
function wrapProviders(providers: ParentComponent[] | undefined, children: JSX.Element): JSX.Element {
  return (providers ?? []).reduceRight<JSX.Element>((acc, Provider) => <Provider>{acc}</Provider>, children)
}

export function DirectoryScope(props: ParentProps<{
  directory: string
  onNavigateToSession?: (sessionID: string) => void
}>) {
  return (
    <SDKProvider directory={() => props.directory}>
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
            if (props.onNavigateToSession) {
              props.onNavigateToSession(sessionID)
            }
          }

          const ext = getExtensions()

          return (
            <DataProvider
              data={sync.data}
              directory={props.directory}
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
  )
}
