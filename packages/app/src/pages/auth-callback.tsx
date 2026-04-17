import { Navigate } from "@solidjs/router"
import { useSearchParams } from "@solidjs/router"
import { Show } from "solid-js"

export default function AuthCallback() {
  const [params] = useSearchParams()

  // If success, redirect to home
  // If error, could show an error page, but for now just redirect to home
  return (
    <Show when={params.success} fallback={<Navigate href="/" />}>
      <Navigate href="/" />
    </Show>
  )
}
