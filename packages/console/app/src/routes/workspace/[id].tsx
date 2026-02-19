import { Show } from "solid-js"
import { createAsync, RouteSectionProps, useParams, A } from "@solidjs/router"
import { querySessionInfo } from "./common"
import "./[id].css"
import { useI18n } from "~/context/i18n"
import { Legal } from "~/component/legal"

export default function WorkspaceLayout(props: RouteSectionProps) {
  const params = useParams()
  const i18n = useI18n()
  const userInfo = createAsync(() => querySessionInfo(params.id!))

  return (
    <main data-page="workspace">
      <div data-component="workspace-container">
        <nav data-component="workspace-nav">
          <nav data-component="nav-desktop">
            <div data-component="workspace-nav-items">
              <A href={`/workspace/${params.id}`} end activeClass="active" data-nav-button>
                {i18n.t("workspace.nav.zen")}
              </A>
              <A href={`/workspace/${params.id}/keys`} activeClass="active" data-nav-button>
                {i18n.t("workspace.nav.apiKeys")}
              </A>
              <A href={`/workspace/${params.id}/members`} activeClass="active" data-nav-button>
                {i18n.t("workspace.nav.members")}
              </A>
              <Show when={userInfo()?.isAdmin}>
                <A href={`/workspace/${params.id}/billing`} activeClass="active" data-nav-button>
                  {i18n.t("workspace.nav.billing")}
                </A>
                <A href={`/workspace/${params.id}/settings`} activeClass="active" data-nav-button>
                  {i18n.t("workspace.nav.settings")}
                </A>
              </Show>
            </div>
          </nav>

          <nav data-component="nav-mobile">
            <div data-component="workspace-nav-items">
              <A href={`/workspace/${params.id}`} end activeClass="active" data-nav-button>
                {i18n.t("workspace.nav.zen")}
              </A>
              <A href={`/workspace/${params.id}/keys`} activeClass="active" data-nav-button>
                {i18n.t("workspace.nav.apiKeys")}
              </A>
              <A href={`/workspace/${params.id}/members`} activeClass="active" data-nav-button>
                {i18n.t("workspace.nav.members")}
              </A>
              <Show when={userInfo()?.isAdmin}>
                <A href={`/workspace/${params.id}/billing`} activeClass="active" data-nav-button>
                  {i18n.t("workspace.nav.billing")}
                </A>
                <A href={`/workspace/${params.id}/settings`} activeClass="active" data-nav-button>
                  {i18n.t("workspace.nav.settings")}
                </A>
              </Show>
            </div>
          </nav>
        </nav>
        <div data-component="workspace-content">
          <div data-component="workspace-main">{props.children}</div>
          <Legal />
        </div>
      </div>
    </main>
  )
}
