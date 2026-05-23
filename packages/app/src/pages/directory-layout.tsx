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
import { decode64 } from "@/utils/base64"
import { StatusPopover } from "@/components/status-popover"

function DirectoryDataProvider(props: ParentProps<{ directory: string }>) {
  const location = useLocation()
  const navigate = useNavigate()
  const sync = useSync()
  const slug = createMemo(() => base64Encode(props.directory))

  createEffect(() => {
    const next = sync.data.path.directory
    if (!next || next === props.directory) return
    const path = location.pathname.slice(slug().length + 1)
    navigate(`/${base64Encode(next)}${path}${location.search}${location.hash}`, { replace: true })
  })

  return (
    <DataProvider
      data={sync.data}
      directory={props.directory}
      onNavigateToSession={(sessionID: string) => navigate(`/${slug()}/session/${sessionID}`)}
      onSessionHref={(sessionID: string) => `/${slug()}/session/${sessionID}`}
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
  const language = useLanguage()
  const navigate = useNavigate()
  let invalid = ""

  const resolved = createMemo(() => {
    if (!params.dir) return ""
    return decode64(params.dir) ?? ""
  })

  createEffect(() => {
    const dir = params.dir
    if (!dir) return
    if (resolved()) {
      invalid = ""
      return
    }
    if (invalid === dir) return
    invalid = dir
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
