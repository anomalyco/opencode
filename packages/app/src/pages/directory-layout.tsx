import { DataProvider } from "@opencode-ai/ui/context"
import { showToast } from "@opencode-ai/ui/toast"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { createEffect, createMemo, type ParentProps, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useLanguage } from "@/context/language"
import { LocalProvider } from "@/context/local"
import { SDKProvider } from "@/context/sdk"
import { SkillsProvider } from "@/context/skills"
import { SyncProvider, useSync } from "@/context/sync"
import { LocalProvider } from "@/context/local"

import { DataProvider } from "@opencode-ai/ui/context"
import { decode64 } from "@/utils/base64"
import { StatusPopover } from "@/components/status-popover"

function DirectoryDataProvider(props: ParentProps<{ directory: string }>) {
  const params = useParams()
  const navigate = useNavigate()
  const params = useParams()
  const sync = useSync()

  createEffect(() => {
    const next = sync.data.path.directory
    if (!next || next === props.directory) return
    const path = location.pathname.slice(slug().length + 1)
    navigate(`/${base64Encode(next)}${path}${location.search}${location.hash}`, { replace: true })
  })

  createResource(
    () => params.id,
    (id) => sync.session.sync(id),
  )

  return (
    <DataProvider
      data={sync.data}
      directory={props.directory}
      onNavigateToSession={(sessionID: string) => navigate(`/${params.dir}/session/${sessionID}`)}
      onSessionHref={(sessionID: string) => `/${params.dir}/session/${sessionID}`}
    >
      <LocalProvider>{props.children}</LocalProvider>
    </DataProvider>
  )
}

function ProjectStatusPortal() {
  const language = useLanguage()
  const mount = createMemo(() => document.getElementById("opencode-titlebar-center-project"))

  return (
    <Show when={mount()}>
      {(node) => (
        <Portal mount={node()}>
          <Tooltip placement="bottom" value={language.t("status.popover.trigger")}>
            <StatusPopover />
          </Tooltip>
        </Portal>
      )}
    </Show>
  )
}

export default function Layout(props: ParentProps) {
  const params = useParams()
  const navigate = useNavigate()
  const language = useLanguage()
  const [state, setState] = createStore({ invalid: "" })
  const directory = createMemo(() => decode64(params.dir) ?? "")

  createEffect(() => {
    if (!params.dir) return
    if (directory()) return
    if (state.invalid === params.dir) return
    setState("invalid", params.dir)
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: language.t("directory.error.invalidUrl"),
    })
    navigate("/", { replace: true })
  })

  return (
    <Show when={resolved()} keyed>
      {(resolved) => (
        <SDKProvider directory={() => resolved}>
          <SyncProvider>
            <SkillsProvider>
              <ProjectStatusPortal />
              <DirectoryDataProvider directory={resolved}>{props.children}</DirectoryDataProvider>
            </SkillsProvider>
          </SyncProvider>
        </SDKProvider>
      )}
    </Show>
  )
}
