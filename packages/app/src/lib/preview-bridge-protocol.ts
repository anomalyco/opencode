// 미리보기 iframe ↔ 부모 앱 통신 프로토콜 (penpal 메서드 인터페이스).
//
// 이 파일은 "부모(packages/app)"와 "자식(docker/preview-bridge)" 양쪽이 공유하는 단일 진실원이다.
// penpal 의 connect({ methods }) 에 넘기는 메서드 집합을 타입으로 고정해, 양측이 같은 시그니처로
// 서로를 호출하도록 한다. 런타임 코드는 두지 않는다(타입 + 상수만).

/** 결과물 dev 서버 루트에서 브릿지가 서빙될 경로. 플러그인/주입·부모 양쪽이 참조. */
export const BRIDGE_SCRIPT_PATH = "/__preview-bridge.js"

/** HTML 주입 멱등성 마커. 이 문자열이 있으면 이미 주입된 것으로 보고 다시 넣지 않는다. */
export const BRIDGE_MARKER = "preview-bridge"

/** 자식이 부모 오리진을 읽어올 때 우선 참조하는 전역 키(주입 시 옵션으로 세팅 가능). */
export const PARENT_ORIGIN_GLOBAL = "__PREVIEW_PARENT_ORIGIN__"

// ── 페이로드 타입 ───────────────────────────────────────────────────────────

export interface ScrollTarget {
  /** 픽셀 좌표로 스크롤. selector 와 동시 지정 시 selector 우선. */
  x?: number
  y?: number
  /** 해당 요소가 보이도록 scrollIntoView. */
  selector?: string
  behavior?: ScrollBehavior
}

/** setPickMode 로 선택된 요소 정보(자식 → 부모 onElementPicked 로 전달). */
export interface PickedElement {
  selector: string
  tagName: string
  text: string
  rect: { x: number; y: number; width: number; height: number }
  attributes: Record<string, string>
}

export interface DomQuery {
  /** 미지정 시 document.documentElement 기준. */
  selector?: string
}

export interface DomSnapshot {
  url: string
  title: string
  /** selector(또는 문서) 의 outerHTML. */
  html: string
  text: string
  /** name/id → value (input·textarea·select). */
  forms: Record<string, string>
  localStorage: Record<string, string>
}

export interface CaptureOptions {
  /** 기본 image/png. */
  type?: "image/png" | "image/jpeg"
  quality?: number
}

export interface ConsoleEntry {
  level: "log" | "info" | "warn" | "error" | "debug"
  args: string[]
  timestamp: number
}

export interface ErrorEntry {
  message: string
  stack?: string
  source?: string
  line?: number
  column?: number
  timestamp: number
}

/**
 * 자식 결과물의 현재 위치(라우팅) 정보. 자식 → 부모 onLocationChange 로 전달.
 * `type` 은 부모가 논리적 history 미러 스택을 갱신하는 방식을 구분한다.
 *  - push    : pushState / 새 해시 진입 / 새 전체페이지 이동 등 새 항목 추가
 *  - replace : replaceState / 새로고침
 *  - pop     : 뒤로/앞으로(SPA popstate 또는 전체페이지 back_forward 로드) — 부모는 스택에서 href 를 찾아 커서 이동
 *
 * SPA(pushState/popstate)는 연결을 유지한 채 정확한 타입을 보내고, 전체페이지 이동은 문서가 새로 로드되므로
 * 자식이 재연결 직후 Navigation Timing 으로 로드 성격을 판별해 위 타입으로 매핑한다.
 * (init 은 더 이상 보내지 않지만 하위호환을 위해 타입에 남겨둔다 — 부모는 push 와 동일 처리.)
 */
export interface LocationInfo {
  href: string
  origin: string
  pathname: string
  search: string
  hash: string
  title: string
  type: "init" | "push" | "replace" | "pop"
}

// ── 메서드 인터페이스 ───────────────────────────────────────────────────────

// penpal 의 Methods 제약({ [index: string]: ... })을 만족시키려면 interface 가 아닌
// type 별칭이어야 한다(type 만 암묵적 인덱스 시그니처를 갖는다).

/** 자식(iframe 결과물)이 노출 → 부모가 `await child.xxx()` 로 호출. */
export type ChildMethods = {
  navigate(url: string): void
  reload(): void
  /** 소프트 라우팅 — 리로드 없이 pushState + popstate 로 SPA 라우터를 path 로 전환(홈 버튼용). */
  routeTo(path: string): void
  /** 자식 자신의 window.history 를 뒤로 이동(popstate → onLocationChange "pop"). */
  back(): void
  /** 자식 자신의 window.history 를 앞으로 이동. */
  forward(): void
  scrollTo(target: ScrollTarget): void
  /** 요소 선택(인스펙트) 모드 토글. 선택 시 부모 onElementPicked 호출. */
  setPickMode(on: boolean): void
  queryDom(query?: DomQuery): DomSnapshot
  /** iframe 내부에서 화면을 캡처해 dataURL 반환(cross-origin canvas taint 회피). */
  capture(options?: CaptureOptions): Promise<string>
  /** 브릿지 핸드셰이크 확인용. */
  ping(): "pong"
}

/** 부모(packages/app)가 노출 → 자식이 이벤트 발생 시 호출. */
export type ParentMethods = {
  onConsole(entry: ConsoleEntry): void
  onError(entry: ErrorEntry): void
  onElementPicked(element: PickedElement): void
  /** 자식의 라우팅(URL) 변화 보고 → 부모 주소창·history 미러 갱신. */
  onLocationChange(location: LocationInfo): void
}
