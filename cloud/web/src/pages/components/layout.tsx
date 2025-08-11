import style from "./layout.module.css"
import { useAccount } from "../../components/context-account"
import { Button } from "../../ui/button"
import { IconLogomark } from "../../ui/svg"
import { IconBars3BottomLeft } from "../../ui/svg/icons"
import { ParentProps, createMemo, createSignal } from "solid-js"
import { A, useLocation } from "@solidjs/router"
import { useOpenAuth } from "../../components/context-openauth"

export default function Layout(props: ParentProps) {
  const auth = useOpenAuth()
  const account = useAccount()
  const [sidebarOpen, setSidebarOpen] = createSignal(false)
  const location = useLocation()

  const workspaceId = createMemo(() => account.current?.workspaces[0].id)
  const pageTitle = createMemo(() => {
    const path = location.pathname
    if (path.endsWith("/billing")) return "Billing"
    if (path.endsWith("/keys")) return "API Keys"
    return null
  })

  function handleLogout() {
    auth.logout(auth.subject?.id!)
  }

  return (
    <div class={style.root}>
      {/* Mobile top bar */}
      <div data-component="mobile-top-bar">
        <button data-slot="toggle" onClick={() => setSidebarOpen(!sidebarOpen())}>
          <IconBars3BottomLeft />
        </button>

        <div data-slot="logo">
          {pageTitle() ? (
            <div>{pageTitle()}</div>
          ) : (
            <A href="/">
              <IconLogomark />
            </A>
          )}
        </div>
      </div>

      {/* Backdrop for mobile sidebar - closes sidebar when clicked */}
      {sidebarOpen() && <div data-component="backdrop" onClick={() => setSidebarOpen(false)}></div>}

      <div data-component="sidebar" data-opened={sidebarOpen() ? "true" : "false"}>
        <div data-slot="logo">
          <A href="/">
            <IconLogomark />
          </A>
        </div>

        <nav data-slot="nav">
          <ul>
            <li>
              <A end activeClass={style.navActiveLink} href={`/${workspaceId()}`} onClick={() => setSidebarOpen(false)}>
                Chat
              </A>
            </li>
            <li>
              <A
                activeClass={style.navActiveLink}
                href={`/${workspaceId()}/billing`}
                onClick={() => setSidebarOpen(false)}
              >
                Billing
              </A>
            </li>
            <li>
              <A
                activeClass={style.navActiveLink}
                href={`/${workspaceId()}/keys`}
                onClick={() => setSidebarOpen(false)}
              >
                API Keys
              </A>
            </li>
          </ul>
        </nav>

        <div data-slot="user">
          <Button color="ghost" onClick={handleLogout} title={account.current?.email || ""}>
            Logout
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div data-slot="main-content">{props.children}</div>
    </div>
  )
}
