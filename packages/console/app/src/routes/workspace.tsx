import "./workspace.css"
import { useAuthSession } from "~/context/auth.session"
import { IconLogo } from "../component/icon"
import { withActor } from "~/context/auth.withActor"
import { query, action, redirect, createAsync, RouteSectionProps, useParams, A } from "@solidjs/router"
import { User } from "@opencode/console-core/user.js"
import { Actor } from "@opencode/console-core/actor.js"
import { getRequestEvent } from "solid-js/web"

const getUserInfo = query(async (workspaceID: string) => {
  "use server"
  return withActor(async () => {
    const actor = Actor.assert("user")
    const email = await User.getAccountEmail(actor.properties.userID)
    return { email }
  }, workspaceID)
}, "userInfo")

const logout = action(async () => {
  "use server"
  const auth = await useAuthSession()
  const event = getRequestEvent()
  const current = auth.data.current
  if (current)
    await auth.update((val) => {
      delete val.account?.[current]
      const first = Object.keys(val.account ?? {})[0]
      val.current = first
      event!.locals.actor = undefined
      return val
    })
  throw redirect("/zen")
})

export default function WorkspaceLayout(props: RouteSectionProps) {
  const params = useParams()
  const userInfo = createAsync(() => getUserInfo(params.id))
  return (
    <main data-page="workspace">
      <header data-component="workspace-header">
        <div data-slot="header-brand">
          <A href="/" data-component="site-title">
            <IconLogo />
          </A>
        </div>
        <div data-slot="header-actions">
          <span data-slot="user">{userInfo()?.email}</span>
          <form action={logout} method="post">
            <button type="submit" formaction={logout}>
              Logout
            </button>
          </form>
        </div>
      </header>
      <div>{props.children}</div>
    </main>
  )
}
