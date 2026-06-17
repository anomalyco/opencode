// 미리보기 결과물(iframe) 안에서 실행되는 자식측 통신 브릿지.
//
// 학생이 만든 결과물 HTML 에 `<script src="/__preview-bridge.js">` 로 주입되어 부모 앱과 penpal 로 연결된다.
// 부모가 호출할 메서드(navigate/reload/scrollTo/setPickMode/queryDom/capture)를 노출하고,
// console/error/요소선택 이벤트는 부모 메서드(onConsole/onError/onElementPicked)를 호출해 중계한다.
//
// 빌드: 이 패키지에서 `bun run build:preview-bridge` → docker/preview-bridge.js (penpal 포함 단일 IIFE 번들).
// 타입은 packages/app 의 프로토콜 파일과 공유한다(빌드 시 bun 이 번들).

import { WindowMessenger, connect } from "penpal"
import * as htmlToImage from "html-to-image"
import {
  PARENT_ORIGIN_GLOBAL,
  type CaptureOptions,
  type ChildMethods,
  type ConsoleEntry,
  type DomQuery,
  type DomSnapshot,
  type ErrorEntry,
  type ParentMethods,
  type PickedElement,
  type ScrollTarget,
} from "../../app/src/lib/preview-bridge-protocol"

// 중복 주입(브릿지 파일이 두 번 로드) 방어.
if ((window as any).__previewBridgeLoaded__) {
  // 이미 로드됨 — 아무것도 하지 않는다.
} else {
  ;(window as any).__previewBridgeLoaded__ = true
  boot()
}

function boot() {
  const parentOrigin = resolveParentOrigin()

  const messenger = new WindowMessenger({
    remoteWindow: window.parent,
    // 부모 오리진을 알면 좁히고, 모르면 전체 허용으로 폴백(부모쪽이 자식 오리진을 엄격 검증한다).
    allowedOrigins: parentOrigin ? [parentOrigin] : ["*"],
  })

  const methods: ChildMethods = {
    ping: () => "pong",
    navigate: (url: string) => {
      window.location.assign(url)
    },
    reload: () => {
      window.location.reload()
    },
    scrollTo: (target: ScrollTarget) => {
      const behavior = target.behavior ?? "auto"
      if (target.selector) {
        const el = document.querySelector(target.selector)
        if (el) el.scrollIntoView({ behavior, block: "center", inline: "nearest" })
        return
      }
      window.scrollTo({ left: target.x ?? 0, top: target.y ?? 0, behavior })
    },
    setPickMode: (on: boolean) => setPickMode(on),
    queryDom: (query?: DomQuery) => snapshotDom(query),
    capture: (options?: CaptureOptions) => capture(options),
  }

  const connection = connect<ParentMethods>({ messenger, methods })

  connection.promise
    .then((parent) => {
      remoteParent = parent
      installConsoleForwarding()
      installErrorForwarding()
    })
    .catch((err) => {
      // 부모 연결 실패는 결과물 동작에 영향 주지 않도록 조용히 무시.
      console.debug?.("[preview-bridge] connect failed", err)
    })
}

// ── 부모 핸들 + 이벤트 중계 ─────────────────────────────────────────────────

let remoteParent: ParentMethods | undefined

function resolveParentOrigin(): string | undefined {
  const injected = (window as any)[PARENT_ORIGIN_GLOBAL]
  if (typeof injected === "string" && injected) return injected
  // ancestorOrigins(크로미움) → document.referrer 순으로 부모 오리진 추정.
  const ancestor = (location as any).ancestorOrigins?.[0]
  if (typeof ancestor === "string" && ancestor) return ancestor
  if (document.referrer) {
    try {
      return new URL(document.referrer).origin
    } catch {
      /* noop */
    }
  }
  return undefined
}

function installConsoleForwarding() {
  const levels: ConsoleEntry["level"][] = ["log", "info", "warn", "error", "debug"]
  for (const level of levels) {
    const original = console[level]?.bind(console)
    console[level] = (...args: unknown[]) => {
      original?.(...args)
      remoteParent?.onConsole({ level, args: args.map(safeStringify), timestamp: Date.now() })
    }
  }
}

function installErrorForwarding() {
  window.addEventListener("error", (e) => {
    const entry: ErrorEntry = {
      message: e.message,
      stack: e.error?.stack,
      source: e.filename,
      line: e.lineno,
      column: e.colno,
      timestamp: Date.now(),
    }
    remoteParent?.onError(entry)
  })
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason
    remoteParent?.onError({
      message: reason?.message ?? safeStringify(reason),
      stack: reason?.stack,
      timestamp: Date.now(),
    })
  })
}

function safeStringify(value: unknown): string {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

// ── DOM 스냅샷 ──────────────────────────────────────────────────────────────

function snapshotDom(query?: DomQuery): DomSnapshot {
  const root = query?.selector ? document.querySelector(query.selector) : document.documentElement
  const el = (root ?? document.documentElement) as HTMLElement

  const forms: Record<string, string> = {}
  for (const field of Array.from(el.querySelectorAll("input, textarea, select"))) {
    const key = (field as HTMLInputElement).name || field.id
    if (key) forms[key] = (field as HTMLInputElement).value ?? ""
  }

  const ls: Record<string, string> = {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key) ls[key] = localStorage.getItem(key) ?? ""
    }
  } catch {
    /* localStorage 접근 불가(파티션) 시 빈 객체 */
  }

  return {
    url: location.href,
    title: document.title,
    html: el.outerHTML,
    text: el.innerText ?? el.textContent ?? "",
    forms,
    localStorage: ls,
  }
}

// ── 화면 캡처 (cross-origin canvas taint 회피: iframe 내부에서 수행) ──────────

async function capture(options?: CaptureOptions): Promise<string> {
  const type = options?.type ?? "image/png"
  const node = document.documentElement
  if (type === "image/jpeg") {
    return htmlToImage.toJpeg(node, { quality: options?.quality ?? 0.92 })
  }
  return htmlToImage.toPng(node)
}

// ── 요소 선택(인스펙트) 모드 ────────────────────────────────────────────────

let pickActive = false
let overlay: HTMLDivElement | undefined

function ensureOverlay(): HTMLDivElement {
  if (overlay) return overlay
  const el = document.createElement("div")
  el.style.cssText =
    "position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #4c8bf5;background:rgba(76,139,245,0.15);border-radius:2px;transition:all 60ms ease;display:none"
  document.body.appendChild(el)
  overlay = el
  return el
}

function onPickMove(e: MouseEvent) {
  const target = e.target as HTMLElement | null
  if (!target || target === overlay) return
  const r = target.getBoundingClientRect()
  const el = ensureOverlay()
  el.style.display = "block"
  el.style.left = `${r.left}px`
  el.style.top = `${r.top}px`
  el.style.width = `${r.width}px`
  el.style.height = `${r.height}px`
}

function onPickClick(e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  const target = e.target as HTMLElement | null
  if (!target) return
  remoteParent?.onElementPicked(describeElement(target))
  setPickMode(false)
}

function setPickMode(on: boolean) {
  if (on === pickActive) return
  pickActive = on
  if (on) {
    document.addEventListener("mousemove", onPickMove, true)
    document.addEventListener("click", onPickClick, true)
  } else {
    document.removeEventListener("mousemove", onPickMove, true)
    document.removeEventListener("click", onPickClick, true)
    if (overlay) overlay.style.display = "none"
  }
}

function describeElement(el: HTMLElement): PickedElement {
  const r = el.getBoundingClientRect()
  const attributes: Record<string, string> = {}
  for (const attr of Array.from(el.attributes)) attributes[attr.name] = attr.value
  return {
    selector: cssPath(el),
    tagName: el.tagName.toLowerCase(),
    text: (el.innerText ?? el.textContent ?? "").trim().slice(0, 200),
    rect: { x: r.left, y: r.top, width: r.width, height: r.height },
    attributes,
  }
}

// 요소까지의 안정적인 CSS 경로(id 우선, 없으면 nth-of-type 체인).
function cssPath(el: HTMLElement): string {
  if (el.id) return `#${CSS.escape(el.id)}`
  const parts: string[] = []
  let node: HTMLElement | null = el
  while (node && node.nodeType === 1 && node !== document.documentElement) {
    let part = node.tagName.toLowerCase()
    const parent: HTMLElement | null = node.parentElement
    if (parent) {
      const sameTag = Array.from(parent.children).filter((c) => c.tagName === node!.tagName)
      if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(node) + 1})`
    }
    parts.unshift(part)
    node = parent
  }
  return parts.join(" > ")
}
