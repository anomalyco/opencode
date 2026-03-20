import { DataProvider } from "@opencode-ai/ui/context"
import { showToast } from "@opencode-ai/ui/toast"
import { base64Encode } from "@opencode-ai/util/encode"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { createMemo, createResource, type ParentProps, Show } from "solid-js"
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
  const navigate = useNavigate()
  let invalid = ""

  const [resolved] = createResource(
    () => {
      if (params.dir) return [location.pathname, params.dir] as const
    },
    async ([pathname, b64Dir]) => {
      const directory = decode64(b64Dir)

      if (!directory) {
        if (invalid === params.dir) return
        invalid = b64Dir
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: language.t("directory.error.invalidUrl"),
        })
        navigate("/", { replace: true })
        return
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
          if (next === directory) return next
          const path = pathname.slice(b64Dir.length + 1)
          navigate(`/${base64Encode(next)}${path}${location.search}${location.hash}`, { replace: true })
        })
        .catch(() => {
          invalid = ""
          return directory
        })
    },
  )

  return (
    <Show when={resolved()} keyed>
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
