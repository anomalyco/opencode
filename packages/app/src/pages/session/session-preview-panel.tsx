import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Spinner } from "@opencode-ai/ui/spinner"
import { TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useLayout } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { useCommand } from "@/context/command"
import { SessionPreviewFallback } from "./session-preview-fallback"
import { createPreviewBridge, type PreviewBridge } from "./preview-bridge"

export function createSessionPreview() {
  const sdk = useSDK()
  const sync = useSync()

  // 미리보기 URL 임시 오버라이드 — .env 의 VITE_PREVIEW_URL 로 지정(개발/레이아웃 확인용).
  // 비어 있으면 평소처럼 sync.data.env(serveDomain·jupyterhubUser) 기반 URL을 쓴다.
  // 주의: google.com 등은 X-Frame-Options/CSP로 iframe 삽입을 막으니 example.com처럼 프레임 허용 사이트를 쓸 것.
  const previewOverride = (() => {
    const raw = import.meta.env.VITE_PREVIEW_URL
    return typeof raw === "string" && raw.trim() ? raw.trim() : undefined
  })()

  const previewUrl = createMemo(() => {
    if (previewOverride) return previewOverride
    const env = sync.data.env
    const domain = env?.serveDomain
    const user = env?.jupyterhubUser
    if (!domain || !user) return undefined
    return `https://${user}.${domain}`
  })

  const [previewReady, setPreviewReady] = createSignal(false)
  const [dirty, setDirty] = createSignal(false)
  const [reloadCount, setReloadCount] = createSignal(0)

  createEffect(() => {
    const url = previewUrl()
    if (!url) return setPreviewReady(false)

    const ctrl = new AbortController()
    const check = () =>
      fetch(url, { cache: "no-store", mode: "cors", signal: ctrl.signal })
        // Hide only on 503 (service unavailable); show preview for any other status.
        .then((res) => setPreviewReady(res.status !== 503))
        .catch(() => setPreviewReady(true))

    void check()
    const unsubIdle = sdk.event.on("session.idle", () => {
      void check()
      if (dirty()) {
        setReloadCount((n) => n + 1)
        setDirty(false)
      }
    })
    const unsubFile = sdk.event.on("file.watcher.updated", (event) => {
      const file = event.properties.file
      if (file.startsWith(".git/") || file.includes("/.git/")) return
      setDirty(true)
    })

    onCleanup(() => {
      ctrl.abort()
      unsubIdle()
      unsubFile()
    })
  })

  const previewSrc = createMemo(() => {
    if (!previewReady()) return undefined
    const url = previewUrl()
    if (!url) return undefined
    const count = reloadCount()
    if (count === 0) return url
    // Use URL to safely merge reloadCount even if `url` already carries a query.
    // Bumping the param on session.idle changes src so the browser re-navigates
    // the existing iframe — no DOM remount.
    const composed = new URL(url)
    composed.searchParams.set("reloadCount", String(count))
    return composed.toString()
  })

  // 새로고침 버튼 — reloadCount 를 올려 iframe src 를 바꿔 재탐색(DOM remount 없음).
  const reload = () => setReloadCount((n) => n + 1)

  // 미리보기 결과물(iframe)과 penpal 로 연결되는 부모측 브릿지. previewUrl 을 오리진으로 사용.
  const bridge = createPreviewBridge({ origin: previewUrl })

  return { previewUrl, previewSrc, reload, bridge }
}

export function SessionPreviewPanel(props: { src?: string; bridge?: PreviewBridge }) {
  return (
    <div data-component="codle-preview-panel" class="size-full min-w-0 overflow-hidden rounded-none">
      <Show when={props.src} fallback={<SessionPreviewFallback />}>
        {(src) => (
          <iframe
            ref={(el) => props.bridge?.attach(el)}
            src={src()}
            class="w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        )}
      </Show>
    </div>
  )
}

// 미리보기 브라우저 chrome 바 — 시안(SafariChrome) 참고. 좌: 트래픽 라이트 + 파일 탐색기 토글 + 뒤로/앞으로,
// 중앙: 주소 pill(홈·주소·새로고침), 우: 새 탭에서 열기 + 주소 복사. 앱 디자인 토큰으로 테마 대응.
export function SessionBrowserChrome(props: {
  address?: string
  url?: string
  onReload: () => void
  onHome?: () => void
  onCapture?: () => void
  capturing?: boolean
}) {
  const layout = useLayout()
  const language = useLanguage()
  const command = useCommand()
  const [copied, setCopied] = createSignal(false)
  let copyTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => copyTimer && clearTimeout(copyTimer))

  const openInNewTab = () => {
    if (props.url) window.open(props.url, "_blank", "noopener")
  }
  const copyAddress = () => {
    if (!props.url) return
    void navigator.clipboard?.writeText(props.url)
    setCopied(true)
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => setCopied(false), 1500)
  }

  const ghostBtn =
    "inline-flex items-center justify-center size-6 shrink-0 rounded-md text-icon-base hover:bg-surface-raised-base-hover active:bg-surface-base-active transition-colors disabled:opacity-40 disabled:cursor-default"

  return (
    <div
      data-component="codle-browser-chrome"
      class="flex items-center gap-2.5 px-3 h-9 shrink-0 border-b border-border-weaker-base bg-background-stronger"
    >
      {/* 좌 그룹 — 트래픽 라이트 + 파일 탐색기 토글 + 뒤로/앞으로 */}
      <div class="flex shrink-0 items-center gap-2.5">
        <div class="flex items-center gap-1.5 shrink-0">
          <span class="size-2.5 rounded-full" style={{ background: "#ff5f57" }} />
          <span class="size-2.5 rounded-full" style={{ background: "#febc2e" }} />
          <span class="size-2.5 rounded-full" style={{ background: "#28c840" }} />
        </div>
        <TooltipKeybind
          title={language.t("session.header.open.fileExplorer")}
          keybind={command.keybind("fileTree.toggle")}
        >
          <IconButton
            icon={layout.fileTree.opened() ? "sidebar-active" : "sidebar"}
            variant="ghost"
            size="small"
            onClick={() => layout.fileTree.toggle()}
            aria-label={language.t("session.header.open.fileExplorer")}
            aria-expanded={layout.fileTree.opened()}
            aria-controls="file-tree-panel"
          />
        </TooltipKeybind>
        <div class="flex items-center shrink-0">
          {/* 뒤로/앞으로 — 미리보기 히스토리가 없어 장식(시안과 동일) */}
          <button type="button" class={ghostBtn} aria-label={language.t("common.back")} disabled>
            <Icon name="chevron-left" size="small" />
          </button>
          <button type="button" class={ghostBtn} aria-label={language.t("common.forward")} disabled>
            <Icon name="chevron-right" size="small" />
          </button>
        </div>
      </div>

      {/* 중앙 — 주소 pill (홈 · 주소 · 새로고침) */}
      <div class="flex flex-1 min-w-0">
        <div class="flex w-full h-6 items-center gap-1 px-1 rounded-md border border-border-weak-base bg-background-base">
          <button
            type="button"
            class={ghostBtn + " !size-5"}
            aria-label={language.t("session.tab.preview")}
            onClick={() => props.onHome?.()}
          >
            <Icon name="home" size="small" />
          </button>
          <span class="flex-1 min-w-0 text-center truncate text-12-regular font-mono text-text-base">
            {props.address ?? ""}
          </span>
          <button
            type="button"
            class={ghostBtn + " !size-5"}
            aria-label={language.t("common.refresh")}
            onClick={() => props.onReload()}
          >
            <Icon name="refresh" size="small" />
          </button>
        </div>
      </div>

      {/* 우 그룹 — 스크린샷 + 새 탭에서 열기 + 주소 복사 */}
      <div class="flex shrink-0 items-center justify-end gap-1">
        <Show when={props.onCapture}>
          <button
            type="button"
            class={ghostBtn}
            onClick={() => props.onCapture!()}
            aria-disabled={props.capturing}
            aria-label={language.t("prompt.action.captureTab")}
          >
            <Show when={props.capturing} fallback={<Icon name="photo" size="small" />}>
              <Spinner class="size-4" />
            </Show>
          </button>
        </Show>
        <button type="button" class={ghostBtn} aria-label={language.t("common.openInNewTab")} onClick={openInNewTab}>
          <Icon name="external-link" size="small" />
        </button>
        <button
          type="button"
          class={ghostBtn}
          classList={{ "text-icon-success-base": copied() }}
          aria-label={language.t("common.copy")}
          onClick={copyAddress}
        >
          <Icon name={copied() ? "check-small" : "copy"} size="small" />
        </button>
      </div>
    </div>
  )
}
