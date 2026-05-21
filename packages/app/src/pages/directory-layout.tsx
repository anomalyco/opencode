import { DataProvider } from "@opencode-ai/ui/context"
import { showToast } from "@opencode-ai/ui/toast"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { createEffect, createMemo, createResource, type ParentProps, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { LocalProvider } from "@/context/local"
import { SDKProvider } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { decode64 } from "@/utils/base64"
// FORK: stale session fallback — startup 恢复 session 时,sidecar 401/404 时降级到主界面
// 不让 ErrorBoundary 兜底渲染"出了点问题" [feat: frontend-stale-session-fallback] 2026-05-21
import { isStaleSessionError } from "@/utils/stale-session-error"

function DirectoryDataProvider(props: ParentProps<{ directory: string }>) {
  const location = useLocation()
  const navigate = useNavigate()
  const params = useParams()
  const sync = useSync()
  const slug = createMemo(() => base64Encode(props.directory))

  createEffect(() => {
    const next = sync.data.path.directory
    if (!next || next === props.directory) return
    const path = location.pathname.slice(slug().length + 1)
    navigate(`/${base64Encode(next)}${path}${location.search}${location.hash}`, { replace: true })
  })

  // FORK-BEGIN: stale session fallback [feat: frontend-stale-session-fallback] 2026-05-21
  // 起源:5.21.1-dev ship 翻车真因之一 — 用户曾经装过 dev 留下 ~/Library/Application Support/<bundle>/
  // 里的 workspace state 引用 stale session id,启动恢复时 Tauri webview 自动恢复 URL
  // `/<directory>/session/<old_id>`,该 createResource 触发 sync.session.sync(old_id) →
  // 内部调 client.session.messages → sidecar 不认 → 401 + empty body → throw → ErrorBoundary。
  //
  // [feat: sdk-falsy-empty-body-fix] 让错误信息 surface(不再是 "Unknown error / {}",而是
  // "Server returned 401 with empty body: <url>"),本笔接力,在启动恢复路径加 catch:
  // 识别 stale session error → navigate 去掉 session id 降级到 directory 根(显示"未选择项目"
  // + 最近项目列表),其他 error 仍 throw 让 ErrorBoundary 兜底。
  //
  // 不在 sync.session.sync 内部 swallow 因为:其他 caller(message-timeline.tsx 用户点击老
  // session 时主动 sync)也可能拿到 stale error,但他们期望 surface 出来不是静默,各自决定 UX。
  createResource(
    () => params.id,
    async (id) => {
      try {
        return await sync.session.sync(id)
      } catch (e) {
        if (isStaleSessionError(e)) {
          console.warn("[stale-session-fallback] navigate away from stale session", {
            sessionId: id,
            error: e instanceof Error ? e.message : e,
          })
          navigate(`/${slug()}`, { replace: true })
          return
        }
        throw e
      }
    },
  )
  // FORK-END

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
            <DirectoryDataProvider directory={resolved}>{props.children}</DirectoryDataProvider>
          </SyncProvider>
        </SDKProvider>
      )}
    </Show>
  )
}
