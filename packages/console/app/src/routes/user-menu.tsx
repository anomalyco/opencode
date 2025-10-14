import { Show, onCleanup, createEffect } from "solid-js"
import { createStore } from "solid-js/store"
import { action, redirect } from "@solidjs/router"
import { getRequestEvent } from "solid-js/web"
import { useAuthSession } from "~/context/auth.session"
import { IconChevron } from "~/component/icon"
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
  const [store, setStore] = createStore({
    showDropdown: false,
  })
  let dropdownRef: HTMLDivElement | undefined

  createEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef && !dropdownRef.contains(event.target as Node)) {
        setStore("showDropdown", false)
      }
    }

    document.addEventListener("click", handleClickOutside)

    onCleanup(() => document.removeEventListener("click", handleClickOutside))
  })

  return (
    <div data-component="user-menu">
      <div ref={dropdownRef}>
        <button data-slot="trigger" type="button" onClick={() => setStore("showDropdown", !store.showDropdown)}>
          <span>{props.email}</span>
          <IconChevron data-slot="chevron" />
        </button>

        <Show when={store.showDropdown}>
          <div data-slot="dropdown">
            <form action={logout} method="post">
              <button type="submit" formaction={logout} data-slot="item">
                Logout
              </button>
            </form>
          </div>
        </Show>
      </div>
    </div>
  )
}
