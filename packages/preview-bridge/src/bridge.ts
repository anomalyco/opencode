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

// ── 부모(앱) penpal 연결 + 자동 재연결 ──────────────────────────────────────
//
// penpal 자식 connect() 는 한 번만 완료되고, 부모가 connection.destroy() 하면(네트워크 suspend·리로드·
// 부모 teardown) 자식 연결도 끊긴다. 그 뒤 부모 메서드 호출은 "destroyed connection" 으로 reject 되는데,
// 이를 안 잡으면 unhandledrejection → onError 재호출 → 또 reject 로 무한 스톰이 된다. 따라서:
//  1) 부모 호출은 전부 emit() 으로 감싸 reject 를 삼키고(루프 차단),
//  2) 끊김을 감지하면 remoteParent 를 비우고 재연결 타이머가 새 핸드셰이크를 맺는다.
// 핸드셰이크 timeout 을 줘야 실패 시 reject 되어 재시도가 돈다(미지정 시 영원히 대기).

const HANDSHAKE_TIMEOUT_MS = 5000
const RECONNECT_INTERVAL_MS = 3000

let remoteParent: ParentMethods | undefined
let connection: { destroy: () => void } | undefined
let connected = false
let connecting = false

const childMethods: ChildMethods = {
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

function setupConnection() {
  if (connecting) return
  connecting = true
  connection?.destroy()
  const parentOrigin = resolveParentOrigin()
  const messenger = new WindowMessenger({
    remoteWindow: window.parent,
    // 부모 오리진을 알면 좁히고, 모르면 전체 허용으로 폴백(부모쪽이 자식 오리진을 엄격 검증한다).
    allowedOrigins: parentOrigin ? [parentOrigin] : ["*"],
  })
  const conn = connect<ParentMethods>({ messenger, methods: childMethods, timeout: HANDSHAKE_TIMEOUT_MS })
  connection = conn
  conn.promise
    .then((parent) => {
      remoteParent = parent
      connected = true
      connecting = false
    })
    .catch(() => {
      // 핸드셰이크 실패/타임아웃 — 재연결 타이머가 다시 시도한다.
      connected = false
      connecting = false
      remoteParent = undefined
    })
}

function boot() {
  // console/error 후킹은 1회만 설치하고, 내부에서 항상 최신 remoteParent 를 참조한다.
  installConsoleForwarding()
  installErrorForwarding()
  setupConnection()
  // 끊긴 동안 주기적으로 재연결 시도(부모도 재시도하므로 결국 다시 핸드셰이크된다).
  setInterval(() => {
    if (!connected && !connecting) setupConnection()
  }, RECONNECT_INTERVAL_MS)
}

/**
 * 부모 메서드 호출 래퍼 — fire-and-forget + reject 삼킴.
 * 끊긴 연결에서의 호출이 uncaught rejection → unhandledrejection → 재호출로 이어지는 스톰/피드백 루프를 막는다.
 * 한 번 실패하면 remoteParent 를 비워 이후 호출을 즉시 단락(추가 postMessage 시도 자체를 멈춤) → 재연결 타이머가 복구.
 */
function emit(call: () => unknown) {
  if (!remoteParent) return
  try {
    const r = call() as { catch?: (cb: () => void) => void } | undefined
    r?.catch?.(() => {
      connected = false
      remoteParent = undefined
    })
  } catch {
    connected = false
    remoteParent = undefined
  }
}

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
      emit(() => remoteParent?.onConsole({ level, args: args.map(safeStringify), timestamp: Date.now() }))
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
    emit(() => remoteParent?.onError(entry))
  })
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason
    emit(() =>
      remoteParent?.onError({
        message: reason?.message ?? safeStringify(reason),
        stack: reason?.stack,
        timestamp: Date.now(),
      }),
    )
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
  emit(() => remoteParent?.onElementPicked(describeElement(target)))
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

// 모든 선언(특히 childMethods 등 const)이 초기화된 뒤 부팅한다 — 최상단에서 호출하면 TDZ 로 throw 된다.
// 중복 주입(브릿지 파일이 두 번 로드) 방어.
if (!(window as any).__previewBridgeLoaded__) {
  ;(window as any).__previewBridgeLoaded__ = true
  boot()
}
