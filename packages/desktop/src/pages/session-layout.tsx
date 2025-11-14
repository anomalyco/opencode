import { Show, type ParentProps } from "solid-js"
import { SessionProvider, useSession } from "@/context/session"
import { useParams } from "@solidjs/router"
import { SDKProvider, useSDK } from "@/context/sdk"
import { LocalProvider } from "@/context/local"

export default function Layout(props: ParentProps) {
  const params = useParams()
  const root = useSDK()
  return (
    <Show when={params.id || true} keyed>
      <SessionProvider sessionId={params.id}>
        {(() => {
          const session = useSession()
          return (
            <SDKProvider url={root.url} directory={session.info()?.directory}>
              <LocalProvider>{props.children}</LocalProvider>
            </SDKProvider>
          )
        })()}
      </SessionProvider>
    </Show>
  )
}
