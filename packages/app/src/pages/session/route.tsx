import { CommentsProvider } from "@/context/comments"
import { FileProvider } from "@/context/file"
import { PromptProvider } from "@/context/prompt"
import { TerminalProvider } from "@/context/terminal"
import { type JSX, lazy, type ParentProps, Suspense } from "solid-js"

const loadSession = () => import("@/pages/session")
const Session = lazy(loadSession)
const Loading = () => <div class="size-full" />

if (typeof location === "object" && /\/session(?:\/|$)/.test(location.pathname)) {
  void loadSession()
}

function SessionProviders(props: ParentProps) {
  return (
    <TerminalProvider>
      <FileProvider>
        <PromptProvider>
          <CommentsProvider>{props.children}</CommentsProvider>
        </PromptProvider>
      </FileProvider>
    </TerminalProvider>
  )
}

export function SessionRoute(props: { sessionChildren?: JSX.Element }) {
  return (
    <SessionProviders>
      {props.sessionChildren}
      <Suspense fallback={<Loading />}>
        <Session />
      </Suspense>
    </SessionProviders>
  )
}
