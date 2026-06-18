import { createSignal, onCleanup } from "solid-js"
import { WindowMessenger, connect, type Connection, type RemoteProxy } from "penpal"
import type {
  ChildMethods,
  ConsoleEntry,
  ErrorEntry,
  ParentMethods,
  PickedElement,
} from "@/lib/preview-bridge-protocol"

const MAX_LOG = 200

/**
 * 부모(앱)측 미리보기 브릿지 — iframe 안의 결과물(자식 브릿지)과 penpal 로 연결한다.
 *
 * - `attach(iframe)` 를 iframe ref 에 연결하면 매 `load` 마다 (재)연결한다(리로드/네비게이션 대응).
 * - penpal 이 핸드셰이크·오리진 검증(allowedOrigins)·요청/응답 상관을 처리하므로
 *   부모는 `child()` 핸들로 `child().reload()` 처럼 자식 메서드를 promise 로 호출하면 된다.
 * - 자식이 보내는 console/error/요소선택 이벤트는 시그널로 노출한다.
 */
export function createPreviewBridge(opts: { origin: () => string | undefined }) {
  const [connected, setConnected] = createSignal(false)
  // penpal 의 RemoteProxy — 각 메서드는 Promise 를 반환한다(예: await child()!.reload()).
  const [child, setChild] = createSignal<RemoteProxy<ChildMethods> | undefined>()
  const [consoles, setConsoles] = createSignal<ConsoleEntry[]>([])
  const [errors, setErrors] = createSignal<ErrorEntry[]>([])
  const [picked, setPicked] = createSignal<PickedElement | undefined>()

  // penpal 핸드셰이크 timeout(미지정 시 실패해도 reject 안 됨) + 끊긴 동안 재연결 간격.
  const HANDSHAKE_TIMEOUT_MS = 5000
  const RECONNECT_INTERVAL_MS = 3000

  let connection: Connection<ChildMethods> | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let currentIframe: HTMLIFrameElement | undefined

  // 부모가 자식에 노출하는 메서드 — 자식이 이벤트 발생 시 호출.
  const methods: ParentMethods = {
    onConsole: (entry) => setConsoles((prev) => [...prev, entry].slice(-MAX_LOG)),
    onError: (entry) => setErrors((prev) => [...prev, entry].slice(-MAX_LOG)),
    onElementPicked: (element) => setPicked(element),
  }

  const clearRetry = () => {
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = undefined
  }

  const teardown = () => {
    clearRetry()
    connection?.destroy()
    connection = undefined
    setConnected(false)
    setChild(undefined)
  }

  // 끊긴(또는 아직 안 붙은) 동안 주기적으로 재연결 — 네트워크 suspend·자식 리로드 후 자동 복구.
  const scheduleRetry = () => {
    clearRetry()
    retryTimer = setTimeout(() => {
      if (!connected() && currentIframe) linkConnection(currentIframe)
    }, RECONNECT_INTERVAL_MS)
  }

  const linkConnection = (iframe: HTMLIFrameElement) => {
    currentIframe = iframe
    clearRetry()
    connection?.destroy()
    connection = undefined
    setConnected(false)
    setChild(undefined)
    const remoteWindow = iframe.contentWindow
    const origin = opts.origin()
    if (!remoteWindow || !origin) return scheduleRetry()

    const conn = connect<ChildMethods>({ messenger: new WindowMessenger({ remoteWindow, allowedOrigins: [origin] }), methods, timeout: HANDSHAKE_TIMEOUT_MS })
    connection = conn
    conn.promise
      .then((remote) => {
        setChild(() => remote)
        setConnected(true)
      })
      .catch(() => {
        // 자식에 브릿지가 없거나(주입 전) 핸드셰이크 실패/끊김 — 재시도.
        setConnected(false)
        setChild(undefined)
        scheduleRetry()
      })
  }

  /** iframe ref 콜백. el 이 null 이면 정리. */
  const attach = (iframe: HTMLIFrameElement | null) => {
    if (!iframe) {
      currentIframe = undefined
      return teardown()
    }
    const onLoad = () => linkConnection(iframe)
    iframe.addEventListener("load", onLoad)
    // 이미 로드된 경우(캐시) 즉시 시도.
    if (iframe.contentWindow) linkConnection(iframe)
    onCleanup(() => {
      iframe.removeEventListener("load", onLoad)
      teardown()
    })
  }

  onCleanup(teardown)

  const clearLogs = () => {
    setConsoles([])
    setErrors([])
  }

  return { attach, connected, child, consoles, errors, picked, clearLogs }
}

export type PreviewBridge = ReturnType<typeof createPreviewBridge>
