import "./workspace.css"
import { useAuthSession } from "~/context/auth.session"
import { IconLogo } from "../component/icon"
import { withActor } from "~/context/auth.withActor"
import "./workspace.css"
import { query, action, redirect, createAsync, RouteSectionProps } from "@solidjs/router"
import { User } from "@opencode/cloud-core/user.js"
import { Actor } from "@opencode/cloud-core/actor.js"

const getUserInfo = query(async () => {
  "use server"
  return withActor(async () => {
    const actor = Actor.assert("user")
    const user = await User.fromID(actor.properties.userID)
    return { user }
  })
}, "userInfo")

const logout = action(async () => {
  "use server"
  const auth = await useAuthSession()
  const current = auth.data.current
  if (current)
    await auth.update((val) => {
      delete val.account[current]
      const first = Object.keys(val.account)[0]
      val.current = first
      return val
    })
})

export default function WorkspaceLayout(props: RouteSectionProps) {
  const userInfo = createAsync(() => getUserInfo(), {
    deferStream: true,
  })
  return (
    <main data-page="workspace">
      <header data-component="workspace-header">
        <div data-slot="header-brand">
          <a href="/" data-component="site-title">
            <IconLogo />
          </a>
        </div>
        <div data-slot="header-actions">
          <span>{userInfo()?.user.email}</span>
          <form onSubmit={() => location.href = "/"} action={logout} method="post">
            <button type="submit" formaction={logout}>Logout</button>
          </form>
        </div>
      </header>
      <div data-slot="content">{props.children}</div>
    </main>
  )
}
