import "./workspace.css"
import { useAuthSession } from "~/context/auth.session"
import { IconLogo } from "../component/icon"
import { withActor } from "~/context/auth.withActor"
import { query, action, redirect, createAsync, RouteSectionProps, Navigate, useNavigate, useParams, A } from "@solidjs/router"
import { User } from "@opencode/cloud-core/user.js"
import { Actor } from "@opencode/cloud-core/actor.js"
import { getRequestEvent } from "solid-js/web"

const getUserInfo = query(async (workspaceID: string) => {
  "use server"
  return withActor(async () => {
    const actor = Actor.assert("user")
    const user = await User.fromID(actor.properties.userID)
    return { user }
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
  throw redirect("/")
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
          <span>{userInfo()?.user.email}</span>
          <form action={logout} method="post">
            <button type="submit" formaction={logout}>
              Logout
            </button>
          </form>
        </div>
      </header>
      <div data-slot="content">{props.children}</div>
    </main>
  )
}
