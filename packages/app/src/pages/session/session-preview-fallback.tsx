import { useLanguage } from "@/context/language"
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { SessionPreviewMascot } from "./session-preview-mascot"

const round = Math.round

// ── 곡괭이 포인터 기하 ──
// 마스코트 곡괭이 SVG(viewBox 84x200, 머리 위·자루 아래)를 grip(손잡이) 기준으로 기울여,
// 머리의 뾰족한 끝(TIP)이 마우스 지점에 오도록 배치한다. 스윙은 grip을 축으로 회전.
const PICK_SCALE = 0.23
const GRIP = { x: 42, y: 120 } // 자루 손잡이 지점(회전축)
const TIP = { x: 8, y: 24 } // 곡괭이 머리 왼쪽 뾰족한 끝(바닥을 찍는 점)
const TILT = 330 // 그리기 기울기(도) — grip 기준 회전으로 머리를 아래로(150 + 180)

function rotPt(p: { x: number; y: number }, c: { x: number; y: number }, deg: number) {
  const th = (deg * Math.PI) / 180
  const dx = p.x - c.x
  const dy = p.y - c.y
  return { x: c.x + dx * Math.cos(th) - dy * Math.sin(th), y: c.y + dx * Math.sin(th) + dy * Math.cos(th) }
}

const TIP_A = rotPt(TIP, GRIP, TILT)
const TIP_PX = { x: TIP_A.x * PICK_SCALE, y: TIP_A.y * PICK_SCALE }
const GRIP_PX = { x: GRIP.x * PICK_SCALE, y: GRIP.y * PICK_SCALE }
const SVG_W = 84 * PICK_SCALE
const SVG_H = 200 * PICK_SCALE
// 스윙 회전축(grip) — TIP 을 (0,0)에 고정했을 때의 grip 상대 위치
const ORIGIN_X = GRIP_PX.x - TIP_PX.x
const ORIGIN_Y = GRIP_PX.y - TIP_PX.y
// TIP 을 컨테이너 (0,0)에 두기 위한 svg 평행이동
const SVG_TX = -TIP_PX.x
const SVG_TY = -TIP_PX.y
// 곡괭이 전체를 크기 절반만큼 아래로 — 실제 마우스 포인트 위치에 맞춤
const POINTER_DROP = round(SVG_H / 2)
// 곡괭이 그림만 크기의 1/3 위로(이펙트 위치는 유지)
const PICK_LIFT = round(SVG_H / 3)
// 파임 자국 너비 — 흙 파임 이펙트만 자국 크기의 1/3 왼쪽으로
const MARK_W = 26
const DIG_SHIFT_X = round(MARK_W / 3)

function PickaxeCursor(props: { striking: boolean }) {
  return (
    <span
      class={props.striking ? "jt-pickaxe-strike" : undefined}
      style={{ position: "absolute", left: "0", top: "0", "transform-origin": `${ORIGIN_X}px ${ORIGIN_Y}px` }}
    >
      <svg
        width={SVG_W}
        height={SVG_H}
        viewBox="0 0 84 200"
        style={{ display: "block", overflow: "visible", transform: `translate(${SVG_TX}px, ${SVG_TY}px)` }}
      >
        <g transform={`rotate(${TILT} ${GRIP.x} ${GRIP.y})`}>
          <rect x="37.5" y="22" width="9" height="118" rx="4.5" fill="#9c6b3f" />
          <rect x="38" y="22" width="3" height="118" rx="1.5" fill="#bd8753" />
          <path d="M8 24 Q42 4 76 24" fill="none" stroke="#3f3934" stroke-width="12" stroke-linecap="round" />
          <path d="M14 21 Q42 7 70 21" fill="none" stroke="#6f675f" stroke-width="3.5" stroke-linecap="round" />
        </g>
      </svg>
    </span>
  )
}

type DigEffect = { id: number; x: number; y: number }

const RESET_MS = 600
const STRIKE_MS = 360
const EFFECT_MS = 500
// 흙 파티클 배치 — 기존 마스코트 흙(jt-dig-dirt) 룩 재사용.
const DIRT = [
  { a: -54, d: 18, r: 4 },
  { a: -8, d: 22, r: 5 },
  { a: 36, d: 19, r: 3.5 },
]

function DigBurst(props: { x: number; y: number }) {
  return (
    <span style={{ position: "absolute", left: `${props.x}px`, top: `${props.y}px`, "z-index": "1" }}>
      <span
        class="jt-dig-mark"
        style={{
          position: "absolute",
          left: "0",
          top: "0",
          width: "26px",
          height: "11px",
          "border-radius": "50%",
          background: "#403b37",
        }}
      />
      <For each={DIRT}>
        {(c) => (
          <span style={{ position: "absolute", left: "0", top: "0", transform: `rotate(${c.a}deg)` }}>
            <span
              class="jt-dirt-burst"
              style={{
                display: "block",
                width: `${round(c.r * 2)}px`,
                height: `${round(c.r * 2)}px`,
                "margin-left": `${-round(c.r)}px`,
                "margin-top": `${-round(c.r)}px`,
                "border-radius": "50%",
                background: "#8f8a84",
                opacity: "0",
                "--pop": `${c.d}px`,
              }}
            />
          </span>
        )}
      </For>
    </span>
  )
}

export function SessionPreviewFallback() {
  const language = useLanguage()
  const title = () => language.t("session.preview.generating.title")
  const hint = () => language.t("session.preview.generating.hint")

  const [pickaxeMode, setPickaxeMode] = createSignal(false)
  const [pointer, setPointer] = createSignal({ x: -200, y: -200 })
  const [striking, setStriking] = createSignal(false)
  const [effects, setEffects] = createSignal<DigEffect[]>([])

  let clickCount = 0
  let resetTimer: ReturnType<typeof setTimeout> | undefined
  let strikeTimer: ReturnType<typeof setTimeout> | undefined
  let effectId = 0
  const effectTimers = new Set<ReturnType<typeof setTimeout>>()

  // 마스코트 연속 3클릭으로 곡괭이 모드 토글
  const onMascotClick = () => {
    clickCount += 1
    clearTimeout(resetTimer)
    resetTimer = setTimeout(() => {
      clickCount = 0
    }, RESET_MS)
    if (clickCount >= 3) {
      clickCount = 0
      clearTimeout(resetTimer)
      setPickaxeMode((on) => !on)
    }
  }

  const onGlobalMove = (e: MouseEvent) => {
    setPointer({ x: e.clientX, y: e.clientY })
  }

  // 클릭 = 곡괭이질(스윙 재시작) + 클릭 지점(TIP) 파임/흙 이펙트
  const onGlobalClick = (e: MouseEvent) => {
    const x = e.clientX
    const y = e.clientY
    setPointer({ x, y })

    setStriking(false)
    requestAnimationFrame(() => setStriking(true))
    clearTimeout(strikeTimer)
    strikeTimer = setTimeout(() => setStriking(false), STRIKE_MS)

    const id = ++effectId
    setEffects((list) => [...list, { id, x: x - DIG_SHIFT_X + 3, y: y + POINTER_DROP + 3 }])
    const timer = setTimeout(() => {
      setEffects((list) => list.filter((fx) => fx.id !== id))
      effectTimers.delete(timer)
    }, EFFECT_MS)
    effectTimers.add(timer)
  }

  const detach = () => {
    document.documentElement.classList.remove("jt-pickaxe-global")
    window.removeEventListener("mousemove", onGlobalMove)
    window.removeEventListener("click", onGlobalClick)
  }

  // 모드 on/off 에 맞춰 전역 커서 숨김 + 전역 마우스 추적/클릭 부착
  createEffect(() => {
    if (pickaxeMode()) {
      document.documentElement.classList.add("jt-pickaxe-global")
      window.addEventListener("mousemove", onGlobalMove)
      window.addEventListener("click", onGlobalClick)
    } else {
      detach()
    }
  })

  onCleanup(() => {
    detach()
    clearTimeout(resetTimer)
    clearTimeout(strikeTimer)
    effectTimers.forEach((t) => clearTimeout(t))
  })

  return (
    <div
      data-slot="preview-fallback"
      class="size-full min-h-0 flex items-center justify-center px-6 py-8 text-center"
    >
      <div role="status" class="flex w-full max-w-160 flex-col items-center gap-[14px]" aria-label={title()}>
        {/* 마스코트 — 연속 3클릭 트리거 */}
        <span onClick={onMascotClick} style={{ display: "inline-flex", cursor: "pointer" }}>
          <SessionPreviewMascot size={84} />
        </span>
        <div class="flex flex-col items-center gap-[5px] min-w-0 break-words">
          <span style={{ "font-size": "13.5px", "font-weight": "600", color: "var(--app-ink)" }}>{title()}</span>
          <span style={{ "font-size": "11.5px", color: "var(--app-muted)" }}>{hint()}</span>
        </div>
      </div>

      {/* 전체 화면 오버레이 — 곡괭이 포인터 + 클릭 지점 땅 파임 이펙트 */}
      <Show when={pickaxeMode()}>
        <Portal>
          <div style={{ position: "fixed", inset: "0", "pointer-events": "none", "z-index": "2147483600" }}>
            <For each={effects()}>{(fx) => <DigBurst x={fx.x} y={fx.y} />}</For>
            <span
              style={{
                position: "fixed",
                left: "0",
                top: "0",
                transform: `translate(${pointer().x}px, ${pointer().y + POINTER_DROP - PICK_LIFT}px)`,
                "will-change": "transform",
              }}
            >
              <PickaxeCursor striking={striking()} />
            </span>
          </div>
        </Portal>
      </Show>
    </div>
  )
}
