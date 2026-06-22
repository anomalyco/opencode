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
import { formatBaseHost, formatEditablePath, resolveNavigatePath } from "./session-preview-address"

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

  // 자식 라우팅 미러 — 뒤로/앞으로 버튼 활성 판단용 논리 history 스택.
  // 자식 history 가 진실원이고(back/forward 는 자식이 실행), 이 스택은 거울일 뿐이다.
  // location() 만 반응형으로 읽고 스택/커서는 일반 변수로 둬 자기참조 재실행을 피한다.
  let stack: string[] = []
  let cursor = -1
  const [canGoBack, setCanGoBack] = createSignal(false)
  const [canGoForward, setCanGoForward] = createSignal(false)

  createEffect(() => {
    const loc = bridge.location()
    if (!loc) return
    const href = loc.href
    if (loc.type === "replace") {
      if (cursor < 0) {
        stack = [href]
        cursor = 0
      } else stack[cursor] = href
    } else if (loc.type === "pop") {
      const found = stack.indexOf(href)
      if (found >= 0) cursor = found
      else {
        stack = stack.slice(0, cursor + 1)
        stack.push(href)
        cursor = stack.length - 1
      }
    } else {
      // init | push — 현재 항목과 동일하면 무시(재연결 init 중복).
      if (!(cursor >= 0 && stack[cursor] === href)) {
        stack = stack.slice(0, cursor + 1)
        stack.push(href)
        cursor = stack.length - 1
      }
    }
    setCanGoBack(cursor > 0)
    setCanGoForward(cursor < stack.length - 1)
  })

  // 주소창 표시용 베이스(host/) + path suffix(편집). 자식 location 이 오면 그것을, 없으면 previewUrl 기준.
  const host = createMemo(() => {
    const loc = bridge.location()
    const src = loc?.href ?? previewUrl()
    if (!src) return undefined
    return formatBaseHost(src)
  })
  const path = createMemo(() => {
    const loc = bridge.location()
    if (!loc) return ""
    return formatEditablePath(loc)
  })
  const currentUrl = createMemo(() => bridge.location()?.href ?? previewUrl())

  const goBack = () => void bridge.child()?.back()
  const goForward = () => void bridge.child()?.forward()
  // 홈 — 리로드 없이 "/" 로 소프트 라우팅. 미연결이면 src 재로드(루트)로 폴백.
  const goHome = () => {
    const child = bridge.child()
    if (child) void child.routeTo("/")
    else reload()
  }
  // 새로고침 — iframe 컨텐츠에 진짜 리로드 명령. 미연결이면 src 재탐색으로 폴백.
  const hardReload = () => {
    const child = bridge.child()
    if (child) void child.reload()
    else reload()
  }
  // 베이스 호스트는 고정 — 입력된 경로를 previewUrl 기준으로 해석해 자식을 이동시킨다.
  const navigatePath = (p: string) => {
    const base = previewUrl()
    if (!base) return
    try {
      void bridge.child()?.navigate(resolveNavigatePath(base, p))
    } catch {
      /* 잘못된 경로 입력 무시 */
    }
  }

  return {
    previewUrl,
    previewReady,
    previewSrc,
    reload,
    goHome,
    hardReload,
    bridge,
    host,
    path,
    currentUrl,
    canGoBack,
    canGoForward,
    goBack,
    goForward,
    navigatePath,
  }
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
  /** 고정 베이스 호스트(미리보기). 파일 탭 모드에서는 비움. */
  host?: string
  /** 표시·편집 대상 경로(미리보기) 또는 파일 경로(파일 탭 모드). */
  path?: string
  /** true 면 경로 입력 가능(미리보기). false 면 읽기 전용 표시. */
  editablePath?: boolean
  onNavigatePath?: (path: string) => void
  canGoBack?: boolean
  canGoForward?: boolean
  onBack?: () => void
  onForward?: () => void
  url?: string
  onReload: () => void
  onHome?: () => void
  onCapture?: () => void
  capturing?: boolean
  previewReady?: boolean
}) {
  const layout = useLayout()
  const language = useLanguage()
  const command = useCommand()
  const [copied, setCopied] = createSignal(false)
  let copyTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => copyTimer && clearTimeout(copyTimer))

  const previewBlocked = () => props.previewReady === false

  // 주소 입력 — 편집 중에는 draft 를, 아니면 항상 props.path 를 표시(자식 라우팅 따라 갱신).
  let inputEl: HTMLInputElement | undefined
  const [editing, setEditing] = createSignal(false)
  const [draft, setDraft] = createSignal("")
  const displayValue = () => (editing() ? draft() : (props.path ?? ""))
  const commit = () => {
    if (!editing() || previewBlocked()) return
    setEditing(false)
    props.onNavigatePath?.(draft().trim())
  }

  // 편집 불가 상태로 바뀌면(파일 탭 활성으로 editablePath=false, 또는 미리보기 차단) editing 을 강제로 내린다.
  // 안 그러면 input 이 포커스를 유지한 채 editing 만 남아 displayValue 가 draft 에 고정 → 외부 경로 갱신이
  // 안 보이고 타이핑·삭제가 먹지 않는 것처럼 보인다.
  createEffect(() => {
    if ((!props.editablePath || previewBlocked()) && editing()) setEditing(false)
  })

  const openInNewTab = () => {
    if (previewBlocked() || !props.url) return
    window.open(props.url, "_blank", "noopener")
  }
  const copyAddress = () => {
    if (previewBlocked() || !props.url) return
    void navigator.clipboard?.writeText(props.url)
    setCopied(true)
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => setCopied(false), 1500)
  }

  const ghostBtn =
    "inline-flex items-center justify-center size-6 shrink-0 rounded-md text-icon-base hover:bg-surface-raised-base-hover active:bg-surface-base-active transition-colors disabled:opacity-40 disabled:cursor-default"

  // 호스트(span)와 경로(input)가 폰트·크기·줄높이·색이 완전히 같도록 인라인으로 고정한다.
  // input 은 폼 요소 UA 스타일·레이어 순서 때문에 클래스만으로는 span 과 색/폰트가 달라지므로(인라인이 이긴다).
  const addressTextStyle = {
    "font-family": "var(--font-family-sans)",
    "font-size": "var(--font-size-small)",
    "font-weight": "var(--font-weight-regular)",
    "line-height": "var(--line-height-large)",
    "letter-spacing": "var(--letter-spacing-normal)",
    color: "var(--color-text-base)",
  }

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
          {/* 뒤로/앞으로 — 자식 history 미러로 활성 판단, 클릭 시 자식 history 이동 */}
          <button
            type="button"
            class={ghostBtn}
            aria-label={language.t("common.back")}
            disabled={previewBlocked() || !props.canGoBack}
            onClick={() => props.onBack?.()}
          >
            <Icon name="chevron-left" size="small" />
          </button>
          <button
            type="button"
            class={ghostBtn}
            aria-label={language.t("common.forward")}
            disabled={previewBlocked() || !props.canGoForward}
            onClick={() => props.onForward?.()}
          >
            <Icon name="chevron-right" size="small" />
          </button>
        </div>
      </div>

      {/* 중앙 — 주소 pill (홈 · 주소 · 새로고침), 360px 고정·좁은 크롬에서는 max-w-full 로 축소 */}
      <div class="flex flex-1 min-w-0 items-center justify-center">
        <div class="flex h-6 w-[360px] max-w-full min-w-0 items-center gap-1 px-1 rounded-md border border-border-weak-base bg-background-base">
          <button
            type="button"
            class={ghostBtn + " !size-5"}
            aria-label={language.t("session.tab.preview")}
            disabled={previewBlocked()}
            onClick={() => props.onHome?.()}
          >
            <Icon name="home" size="small" />
          </button>
          {/* 베이스(host/) + path suffix — 한 덩어리로 pill 가운데 정렬 */}
          <div
            class="flex flex-1 min-w-0 items-center justify-center overflow-hidden"
            classList={{ "cursor-text": !!props.editablePath && !previewBlocked() }}
            onMouseDown={(e) => {
              if (!props.editablePath || previewBlocked()) return
              if (e.target === inputEl) return
              e.preventDefault()
              inputEl?.focus()
            }}
          >
            <div class="flex min-w-0 max-w-full items-center overflow-hidden">
              <Show when={props.host}>
                <span class="shrink-0 truncate" style={addressTextStyle}>
                  {props.host}
                </span>
              </Show>
              <input
                ref={(el) => {
                  inputEl = el
                  el.style.setProperty("field-sizing", "content")
                }}
                type="text"
                spellcheck={false}
                class="min-w-0 max-w-full p-0 bg-transparent outline-none"
                classList={{ "cursor-text": !!props.editablePath && !previewBlocked() }}
                style={{
                  ...addressTextStyle,
                  flex: "0 0 auto",
                  "min-width": "1ch",
                }}
                value={displayValue()}
                readOnly={!props.editablePath || previewBlocked()}
                aria-label={language.t("common.address")}
                onFocus={(e) => {
                  if (!props.editablePath || previewBlocked()) return
                  setDraft(props.path ?? "")
                  setEditing(true)
                  e.currentTarget.select()
                }}
                onInput={(e) => setDraft(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    commit()
                    inputEl?.blur()
                  } else if (e.key === "Escape") {
                    e.preventDefault()
                    setEditing(false)
                    inputEl?.blur()
                  }
                }}
                onBlur={() => setEditing(false)}
              />
            </div>
          </div>
          <button
            type="button"
            class={ghostBtn + " !size-5"}
            aria-label={language.t("common.refresh")}
            disabled={previewBlocked()}
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
            disabled={previewBlocked() || props.capturing}
            onClick={() => props.onCapture!()}
            aria-label={language.t("prompt.action.captureTab")}
          >
            <Show when={props.capturing} fallback={<Icon name="pencil-line" size="small" />}>
              <Spinner class="size-4" />
            </Show>
          </button>
        </Show>
        <button
          type="button"
          class={ghostBtn}
          disabled={previewBlocked()}
          aria-label={language.t("common.openInNewTab")}
          onClick={openInNewTab}
        >
          <Icon name="external-link" size="small" />
        </button>
        <button
          type="button"
          class={ghostBtn}
          classList={{ "text-icon-success-base": copied() }}
          disabled={previewBlocked()}
          aria-label={language.t("common.copy")}
          onClick={copyAddress}
        >
          <Icon name={copied() ? "check-small" : "copy"} size="small" />
        </button>
      </div>
    </div>
  )
}
