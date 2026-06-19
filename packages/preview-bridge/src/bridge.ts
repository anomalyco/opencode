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
  type LocationInfo,
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
// routeTo 가 라우터를 깨우려고 직접 쏘는 popstate 1회는 위치 보고에서 제외한다(이미 pushState 가 "push" 로
// 보고했고, 합성 popstate 까지 "pop" 으로 보고하면 동일 href 가 스택에 중복돼 부모 커서가 어긋난다).
let suppressPopReport = false

const childMethods: ChildMethods = {
  ping: () => "pong",
  navigate: (url: string) => {
    window.location.assign(url)
  },
  reload: () => {
    window.location.reload()
  },
  routeTo: (path: string) => {
    // 소프트 라우팅 — 리로드 없이 history 만 바꾸고 popstate 를 쏴 SPA 라우터가 path 로 전환하게 한다.
    // pushState 래퍼가 onLocationChange("push") 로 부모 미러를 갱신하고, 라우터를 깨우는 합성 popstate 의
    // 중복 "pop" 보고는 suppressPopReport 로 1회 건너뛴다.
    window.history.pushState(null, "", path)
    suppressPopReport = true
    window.dispatchEvent(new PopStateEvent("popstate"))
  },
  back: () => {
    window.history.back()
  },
  forward: () => {
    window.history.forward()
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
      // 연결 직후 현재 위치 1회 보고. 전체 페이지 이동(MPA·location.assign·뒤로/앞으로)은 문서가 새로 로드돼
      // popstate 가 아닌 재연결로만 감지되므로, 이 로드가 어떤 종류였는지 Navigation Timing 으로 판별해
      // 부모 미러가 push/replace/pop 을 구분하게 한다(재연결마다 와도 부모가 href 로 멱등 처리).
      emit(() => remoteParent?.onLocationChange(readLocation(navigationType())))
    })
    .catch(() => {
      // 핸드셰이크 실패/타임아웃 — 재연결 타이머가 다시 시도한다.
      connected = false
      connecting = false
      remoteParent = undefined
    })
}

function boot() {
  // console/error/location 후킹은 1회만 설치하고, 내부에서 항상 최신 remoteParent 를 참조한다.
  installConsoleForwarding()
  installErrorForwarding()
  installLocationForwarding()
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

// ── 라우팅(위치) 변화 중계 ──────────────────────────────────────────────────
//
// 자식의 URL 변화를 부모로 보고해 주소창·뒤로/앞으로를 동기화한다. SPA 는 보통 history.pushState/
// replaceState 로 이동하므로 두 메서드를 래핑하고, 사용자 뒤로/앞으로는 popstate, 해시 이동은
// hashchange 로 잡는다. 단 해시 뒤로/앞으로는 popstate + hashchange 가 함께 발생하므로(중복),
// popstate 직후의 hashchange 1회는 억제한다.

// 직전 문서 로드의 성격을 history 미러 타입으로 매핑.
//  - back_forward(뒤로/앞으로) → pop : 부모가 스택에서 href 를 찾아 커서 이동
//  - reload(새로고침)         → replace : 현재 항목 유지
//  - navigate/그 외           → push : 새 항목
function navigationType(): LocationInfo["type"] {
  try {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined
    if (nav?.type === "back_forward") return "pop"
    if (nav?.type === "reload") return "replace"
  } catch {
    /* Navigation Timing 미지원 — push 로 폴백 */
  }
  return "push"
}

function readLocation(type: LocationInfo["type"]): LocationInfo {
  return {
    href: location.href,
    origin: location.origin,
    pathname: location.pathname,
    search: location.search,
    hash: location.hash,
    title: document.title,
    type,
  }
}

function installLocationForwarding() {
  let justPopped = false
  const report = (type: LocationInfo["type"]) => emit(() => remoteParent?.onLocationChange(readLocation(type)))

  const wrap = (key: "pushState" | "replaceState", type: "push" | "replace") => {
    const original = history[key].bind(history)
    history[key] = (...args: Parameters<History["pushState"]>) => {
      original(...args)
      report(type)
    }
  }
  wrap("pushState", "push")
  wrap("replaceState", "replace")

  window.addEventListener("popstate", () => {
    // routeTo 가 라우터를 깨우려 쏜 합성 popstate 는 보고 생략(pushState 가 이미 보고함).
    if (suppressPopReport) {
      suppressPopReport = false
      return
    }
    justPopped = true
    report("pop")
  })
  window.addEventListener("hashchange", () => {
    // popstate 와 함께 온 hashchange 는 같은 이동의 중복 — 1회 억제.
    if (justPopped) {
      justPopped = false
      return
    }
    report("push")
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

  // html-to-image 는 노드를 클론해 항상 스크롤 최상단부터 렌더한다. 그래서 전체 페이지를 한 번 그린 뒤
  // 현재 스크롤 위치(window.scrollX/Y)의 뷰포트 영역만 잘라내야 "지금 보이는 화면"이 캡처된다.
  // 크롭하지 않으면 어디로 스크롤했든 무조건 맨 위가 찍힌다.
  const fullW = node.scrollWidth
  const fullH = node.scrollHeight
  try {
    // 명시적 전체 스크롤 크기 지정 → 캔버스 배율이 결정적(canvas.width / fullW = pixelRatio).
    const canvas = await htmlToImage.toCanvas(node, { width: fullW, height: fullH, cacheBust: true })
    const rx = canvas.width / fullW
    const ry = canvas.height / fullH
    const out = document.createElement("canvas")
    out.width = Math.max(1, Math.round(window.innerWidth * rx))
    out.height = Math.max(1, Math.round(window.innerHeight * ry))
    const ctx = out.getContext("2d")
    if (!ctx) throw new Error("no 2d context")
    ctx.drawImage(
      canvas,
      window.scrollX * rx,
      window.scrollY * ry,
      window.innerWidth * rx,
      window.innerHeight * ry,
      0,
      0,
      out.width,
      out.height,
    )
    return type === "image/jpeg" ? out.toDataURL("image/jpeg", options?.quality ?? 0.92) : out.toDataURL("image/png")
  } catch {
    // 크롭 경로 실패 시 전체 페이지라도 반환(기존 동작 폴백).
    if (type === "image/jpeg") return htmlToImage.toJpeg(node, { quality: options?.quality ?? 0.92 })
    return htmlToImage.toPng(node)
  }
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
