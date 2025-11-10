import { Show, type ParentProps } from "solid-js"
import { SessionProvider } from "@/context/session"
import { useParams } from "@solidjs/router"

export default function Layout(props: ParentProps) {
  const params = useParams()
  return (
    <Show when={params.id || true} keyed>
      <SessionProvider sessionId={params.id}>{props.children}</SessionProvider>
    </Show>
  )
}
