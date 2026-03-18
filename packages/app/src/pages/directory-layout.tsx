import { batch, createEffect, createMemo, Show, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { SDKProvider } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { LocalProvider } from "@/context/local"
import { useGlobalSDK } from "@/context/global-sdk"

import { DataProvider } from "@opencode-ai/ui/context"
import { base64Encode } from "@opencode-ai/util/encode"
import { decode64 } from "@/utils/base64"
import { showToast } from "@opencode-ai/ui/toast"
import { useLanguage } from "@/context/language"
function DirectoryDataProvider(props: ParentProps<{ directory: string }>) {
  const navigate = useNavigate()
  const sync = useSync()
  const slug = createMemo(() => base64Encode(props.directory))

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

export default function Layout(props: ParentProps) {
  const params = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const directory = createMemo(() => decode64(params.dir) ?? "")
  const [state, setState] = createStore({ invalid: "", resolved: "" })

  createEffect(() => {
    if (!params.dir) return
    const raw = directory()
    if (!raw) {
      if (state.invalid === params.dir) return
      setState("invalid", params.dir)
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: language.t("directory.error.invalidUrl"),
      })
      navigate("/", { replace: true })
      return
    }

    const current = params.dir
    globalSDK
      .createClient({
        directory: raw,
        throwOnError: true,
      })
      .path.get()
      .then((x) => {
        if (params.dir !== current) return
        const next = x.data?.directory ?? raw
        batch(() => {
          setState("invalid", "")
          setState("resolved", next)
        })
        if (next === raw) return
        const path = location.pathname.slice(current.length + 1)
        navigate(`/${base64Encode(next)}${path}${location.search}${location.hash}`, { replace: true })
      })
      .catch(() => {
        if (params.dir !== current) return
        batch(() => {
          setState("invalid", "")
          setState("resolved", raw)
        })
      })
  })

  return (
    <Show when={state.resolved} keyed>
      {(resolved) => (
        <SDKProvider directory={() => resolved}>
          <SyncProvider>
            <DirectoryDataProvider directory={resolved}>{props.children}</DirectoryDataProvider>
          </SyncProvider>
        </SDKProvider>
      )}
    </Show>
  )
}
