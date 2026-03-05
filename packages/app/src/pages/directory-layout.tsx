import { createEffect, createMemo, Show, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { useNavigate, useParams } from "@solidjs/router"
import { SDKProvider } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { LocalProvider } from "@/context/local"

import { DataProvider } from "@opencode-ai/ui/context"
import { decode64 } from "@/utils/base64"
import { showToast } from "@opencode-ai/ui/toast"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"

function DirectoryDataProvider(props: ParentProps<{ directory: string }>) {
  const params = useParams()
  const navigate = useNavigate()
  const sync = useSync()
  const platform = usePlatform()

  return (
    <DataProvider
      data={sync.data}
      directory={props.directory}
      onNavigateToSession={(sessionID: string) => navigate(`/${params.dir}/session/${sessionID}`)}
      onSessionHref={(sessionID: string) => `/${params.dir}/session/${sessionID}`}
      onOpenFilePath={async (input) => {
        const file = input.path.replace(/^[\\/]+/, "")
        const separator = props.directory.includes("\\") ? "\\" : "/"
        const path = props.directory.endsWith(separator) ? props.directory + file : props.directory + separator + file

        if (platform.platform === "desktop" && platform.openPath) {
          await platform.openPath(path).catch((error) => {
            const description = error instanceof Error ? error.message : String(error)
            showToast({
              variant: "error",
              title: "Open failed",
              description,
            })
            window.dispatchEvent(
              new CustomEvent("opencode:open-file-path", {
                detail: input,
              }),
            )
          })
          return
        }

        window.dispatchEvent(
          new CustomEvent("opencode:open-file-path", {
            detail: input,
          }),
        )
      }}
    >
      <LocalProvider>{props.children}</LocalProvider>
    </DataProvider>
  )
}

export default function Layout(props: ParentProps) {
  const params = useParams()
  const navigate = useNavigate()
  const language = useLanguage()
  const [store, setStore] = createStore({ invalid: "" })
  const directory = createMemo(() => {
    return decode64(params.dir) ?? ""
  })

  createEffect(() => {
    if (!params.dir) return
    if (directory()) return
    if (store.invalid === params.dir) return
    setStore("invalid", params.dir)
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: language.t("directory.error.invalidUrl"),
    })
    navigate("/", { replace: true })
  })
  return (
    <Show when={directory()}>
      <SDKProvider directory={directory}>
        <SyncProvider>
          <DirectoryDataProvider directory={directory()}>{props.children}</DirectoryDataProvider>
        </SyncProvider>
      </SDKProvider>
    </Show>
  )
}
