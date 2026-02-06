import { Show, type ParentProps } from "solid-js"

const Loading = () => <div class="size-full" />

type AuthGateSession = {
  ready: () => boolean
  authRequired: () => boolean
}

type AuthGateServer = {
  url: string | undefined
}

/**
 * Auth gate that waits for session check and redirects to login if needed.
 */
export function AuthGate(props: ParentProps & { session: AuthGateSession; server: AuthGateServer }) {
  const session = props.session
  const server = props.server

  // Wait for initial session check
  // If auth is required but not authenticated, redirect to login
  return (
    <Show when={session.ready()} fallback={<Loading />}>
      <Show when={!session.authRequired()} fallback={<AuthRedirect url={server.url} />}>
        {props.children}
      </Show>
    </Show>
  )
}

/**
 * Component that redirects to the login page.
 * Passes current URL as returnUrl so user is redirected back after login.
 */
export function AuthRedirect(props: { url: string | undefined }) {
  if (props.url) {
    const returnUrl = encodeURIComponent(window.location.href)
    window.location.href = `${props.url}/auth/login?returnUrl=${returnUrl}`
  }
  return <Loading />
}
