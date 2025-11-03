import { action, redirect } from "@solidjs/router"
import { getRequestEvent } from "solid-js/web"
import { useAuthSession } from "~/context/auth.session"
import { Dropdown } from "~/component/dropdown"
import "./user-menu.css"

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

export function UserMenu(props: { email: string | null | undefined }) {
  return (
    <div data-component="user-menu">
      <Dropdown trigger={props.email ?? ""} align="right">
        <form action={logout} method="post">
          <button type="submit" formaction={logout} data-slot="item">
            Logout
          </button>
        </form>
      </Dropdown>
    </div>
  )
}
