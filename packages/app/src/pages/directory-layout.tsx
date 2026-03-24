import { createEffect, createMemo, Match, Show, Switch, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { useNavigate, useParams } from "@solidjs/router"
import { SDKProvider } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { LocalProvider } from "@/context/local"
import { useServer } from "@/context/server"

import { DataProvider } from "@opencode-ai/ui/context"
import { decode64 } from "@/utils/base64"
import { showToast } from "@opencode-ai/ui/toast"
import { useLanguage } from "@/context/language"

function DirectoryDataProvider(props: ParentProps<{ directory: string }>) {
  const params = useParams()
  const navigate = useNavigate()
  const sync = useSync()

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

function DirectoryProviders(props: ParentProps<{ directory: string }>) {
  return (
    <SDKProvider directory={() => props.directory}>
      <SyncProvider>
        <DirectoryDataProvider directory={props.directory}>{props.children}</DirectoryDataProvider>
      </SyncProvider>
    </SDKProvider>
  )
}

export default function Layout(props: ParentProps) {
  const params = useParams()
  const navigate = useNavigate()
  const language = useLanguage()
  const server = useServer()
  const [state, setState] = createStore({ invalid: "" })
  const directory = createMemo(() => decode64(params.dir) ?? "")
  const openclaw = createMemo(() => directory() === "/openclaw")

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
    <Show when={directory()}>
      {(dir) => (
        <Switch>
          <Match when={openclaw()}>
            <Show when={server.key} keyed>
              {(_) => (
                // OpenClaw is a synthetic workspace entry. Keep its data scope isolated so
                // switching between assistant/global state and normal projects cannot reuse
                // a stale per-directory provider instance.
                <DirectoryProviders directory={dir()}>{props.children}</DirectoryProviders>
              )}
            </Show>
          </Match>
          <Match when={true}>
            <DirectoryProviders directory={dir()}>{props.children}</DirectoryProviders>
          </Match>
        </Switch>
      )}
    </Show>
  )
}
