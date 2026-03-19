import { DataProvider } from "@opencode-ai/ui/context"
import { showToast } from "@opencode-ai/ui/toast"
import { base64Encode } from "@opencode-ai/util/encode"
import { Navigate, useLocation, useNavigate, useParams } from "@solidjs/router"
import {
  batch,
  createEffect,
  createMemo,
  createResource,
  Match,
  type ParentProps,
  Show,
  Switch,
  startTransition,
} from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { LocalProvider } from "@/context/local"
import { SDKProvider } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { decode64 } from "@/utils/base64"

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
  const location = useLocation()
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  let invalid = ""

  const [resolved] = createResource(
    () => params.dir,
    async (b64Dir) => {
      const directory = decode64(b64Dir)

      if (!directory) {
        if (invalid === params.dir) return
        invalid = b64Dir
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: language.t("directory.error.invalidUrl"),
        })
        return { type: "redirect" as const, href: "/" }
      }

      return await globalSDK
        .createClient({
          directory,
          throwOnError: true,
        })
        .path.get()
        .then((x) => {
          const next = x.data?.directory ?? directory
          invalid = ""
          if (next === directory) return { type: "resolved" as const, resolved: next }
          const path = location.pathname.slice(b64Dir.length + 1)
          return { type: "redirect" as const, href: `/${base64Encode(next)}${path}${location.search}${location.hash}` }
        })
        .catch(() => {
          invalid = ""
          return { type: "resolved" as const, resolved: directory }
        })
    },
  )

  return (
    <Switch>
      <Match
        when={(() => {
          const r = resolved()
          if (r?.type === "redirect") return r.href
        })()}
      >
        {(href) => <Navigate href={href()} />}
      </Match>
      <Match
        when={(() => {
          const r = resolved()
          if (r?.type === "resolved") return r.resolved
        })()}
        keyed
      >
        {(resolved) => (
          <SDKProvider directory={() => resolved}>
            <SyncProvider>
              <DirectoryDataProvider directory={resolved}>{props.children}</DirectoryDataProvider>
            </SyncProvider>
          </SDKProvider>
        )}
      </Match>
    </Switch>
  )
}
