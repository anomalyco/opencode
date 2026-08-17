import { DataProvider } from "@opencode-ai/session-ui/context"
import { showToast } from "@/utils/toast"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { createEffect, createMemo, type ParentProps, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { LocalProvider } from "@/context/local"
import { SDKProvider } from "@/context/sdk"
import { decode64 } from "@/utils/base64"
import { Schema } from "effect"
import type { ServerConnection } from "@/context/servers"
import { sessionHref } from "@/utils/session-route"
import { useData } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"

export function DirectoryDataProvider(
  props: ParentProps<{
    directory: string
    draftID?: string
    server?: ServerConnection.Key
  }>,
) {
  const location = useLocation()
  const navigate = useNavigate()
  const params = useParams()
  const data = useData()
  const serverSDK = useServerSDK()
  const language = useLanguage()
  const directory = () => props.directory
  const slug = createMemo(() => base64Encode(directory()))
  const href = (sessionID: string) => {
    if (props.server) return sessionHref(props.server, sessionID)
    return `/${slug()}/session/${sessionID}`
  }
  const navigateToSession = async (sessionID: string) => {
    await data.session.lineage.resolve(sessionID).catch(() => undefined)
    navigate(href(sessionID))
  }

  createEffect(() => {
    // A draft lives at /new-session?draftId=… and has no directory segment to normalize.
    if (props.draftID || props.server) return
    const next = data.location.info({ directory: directory() })?.directory
    if (!next || next === directory()) return
    const path = location.pathname.slice(slug().length + 1)
    navigate(`/${base64Encode(next)}${path}${location.search}${location.hash}`, { replace: true })
  })

  createEffect(() => {
    if (serverSDK.connection.status() !== "connected") return
    const ref = { directory: directory() }
    void data.location.sync(ref).catch(() => undefined)
    void data.project.sync().catch(() => undefined)
    const sessionID = params.id
    if (!sessionID) return
    void Promise.allSettled([
      data.session.sync(sessionID, { children: true }),
      data.session.pending.sync(sessionID),
      data.session.message.sync(sessionID),
      data.session.permission.sync(sessionID),
      data.session.form.sync(sessionID),
    ])
  })

  return (
    <Show when={directory()} keyed>
      {(directory) => (
        <DataProvider
          // TODO: Remove this legacy session-ui bridge once message parts use the current Data projections.
          data={{ session: [], session_status: {}, session_diff: {}, message: {}, part: {} }}
          directory={directory}
          sessionID={params.id}
          onNavigateToSession={navigateToSession}
          onSessionHref={href}
        >
          <LocalProvider>{props.children}</LocalProvider>
        </DataProvider>
      )}
    </Show>
  )
}

export const ProjectDirString = Schema.String.pipe(Schema.brand("ProjectDirString"))
export type ProjectDirString = Schema.Schema.Type<typeof ProjectDirString>

export function decodeDirectory(dir: string): ProjectDirString | undefined {
  const decoded = decode64(dir)
  if (!decoded) return
  return ProjectDirString.make(decoded)
}

export default function Layout(props: ParentProps) {
  const params = useParams()
  const language = useLanguage()
  const navigate = useNavigate()
  let invalid = ""

  const resolved = createMemo(() => {
    if (!params.dir) return ""
    return decodeDirectory(params.dir) ?? ""
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
        <SDKProvider directory={resolved}>
          <DirectoryDataProvider directory={resolved}>{props.children}</DirectoryDataProvider>
        </SDKProvider>
      )}
    </Show>
  )
}
