import { action } from "@solidjs/router"
import { getRequestEvent } from "solid-js/web"
import { useAuthSession } from "~/context/auth"
import { Dropdown } from "~/component/dropdown"
import { useI18n } from "~/context/i18n"
import { useLanguage } from "~/context/language"
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
  const i18n = useI18n()
  const language = useLanguage()
  return (
    <div data-component="user-menu">
      <Dropdown trigger={props.email ?? ""} align="right">
        <a href={language.route("/auth/logout")} data-slot="item">
          {i18n.t("user.logout")}
        </a>
      </Dropdown>
    </div>
  )
}
