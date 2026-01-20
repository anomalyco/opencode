import { action } from "@solidjs/router"
import { getRequestEvent } from "solid-js/web"
import { useAuthSession } from "~/context/auth"
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
}, "auth.logout")

export function UserMenu(props: { email: string | null | undefined }) {
  return (
    <div data-component="user-menu">
      <Dropdown trigger={props.email ?? ""} align="right">
        <a href="/auth/logout" data-slot="item">
          Logout
        </a>
      </Dropdown>
    </div>
  )
}
