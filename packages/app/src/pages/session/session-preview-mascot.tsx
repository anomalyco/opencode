import { For, type JSX } from "solid-js"

const px = (n: number) => `${n}px`
const round = Math.round

// 짓다 측면 캐릭터(새 로고) — 곡괭이질 마스코트의 몸통.
// 디자인 시안(Jitda UI design / shared.jsx · JitdaCharSide)에서 그대로 이식.
function JitdaCharSide(props: { size: number }) {
  const body = "#ffce2c"
  const accent = "#e9ad03"
  const dark = "#403b37"
  return (
    <svg
      width={(props.size * 638.38) / 677.65}
      height={props.size}
      viewBox="0 0 638.38 677.65"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="짓다 측면"
      style={{ display: "block", overflow: "visible" }}
    >
      <path
        fill={dark}
        d="M236.21,519.56c-3.35,12.56-16.89,21.33-31.65,25.44-27.2,7.57-57.56,3.11-80.77-11.16-19.21-11.8-22.86-36.13-5.15-49.9,7.63-5.94,23.48-5.41,30.41.45l27.16,22.94c16.38,12.34,36.26,16.03,60,12.23Z"
      />
      <path
        fill={dark}
        d="M174.28,397.22c21.5-3.12,38.34,11.91,40.79,30.45,2.67,20.27-11,37.89-30.29,40.57-19.53,2.72-37.84-10.29-40.85-28.8-3.29-20.2,8.66-39.07,30.36-42.22Z"
      />
      <path
        fill={body}
        d="M533.43,360.73l-.98-53.78c-.05-2.82-.27-5.97-.64-9.35,0,0,0,0,0,0,0-106.14-94.38-192.18-210.81-192.18-91.13,0-168.74,52.71-198.18,126.51-10.93,23.7-16.44,50.05-18.44,76.91l-.75,47.18c-.05,3.25-4.54,5.15-6.91,6.59l-40.16,24.38c-6.5,3.94-9.07,11.62-7.08,19.14,1.41,5.33,7.57,11.46,15.4,11.46l91.48.03,218.22.06,111.01-.02h21.75s28.89-.38,28.89-.38c7.64-.1,12.9-8.12,15.24-13,6.33-13.19-5.25-31.69-18.03-43.56Z"
      />
      <path
        fill={accent}
        d="M355.92,138.74l19.16,4.86c19.36,4.91,36.3,14.26,52.48,25.68,1.18.31,2.22,1.65,2.9,2.11,23.79,16.25,49.74,48.66,59.56,74.76l5,13.3c1.63,4.35-2.04,7.93-5.7,8.35-3.19.37-5.94-2.02-7.35-5.64-19.08-48.93-57.7-84.43-107.58-100.1-48.61-15.27-99.09-8.14-141.86,19.96-27.69,18.19-48.09,43.83-61.74,74.09-1.65,3.66-6.97,4.31-9.65,3.02-3.2-1.54-3.95-5.73-2.25-9.68l5.54-12.39c21.17-41.47,54.47-73.82,98.39-89.8l5.17-1.88c28.31-10.3,58.22-11.65,87.95-6.64Z"
      />
    </svg>
  )
}

// 헬멧 캐릭터가 땅을 파는 측면 마스코트(DIG). AI가 화면을 "짓는" 순간의 1순위 은유.
// 디자인 시안(participant.jsx OcPreviewGenerating / shared.jsx JitdaMascotDig)에서 이식.
// 애니메이션 키프레임(jt-dig-swing/bob/dirt/shadow)은 index.css 에 정의.
export function SessionPreviewMascot(props: { size?: number }): JSX.Element {
  const size = props.size ?? 84
  const W = round(size * 2.15)
  const H = round(size * 1.78)
  const cx = round(W / 2)
  const lineY = round(H * 0.52)
  const Sx = cx
  const Sy = lineY + round(size * 0.05)
  const helmetX = cx + round(size * 0.13)
  const charH = round(size * 0.92)
  const CUT = 0.58
  const helmetTop = round(lineY - CUT * charH)
  const swH = round(size * 0.92)
  const swW = round((size * 0.92 * 84) / 200)
  const PIVOT_X = 50
  const PIVOT_Y = 98
  const headFill = "#3f3934"
  const headHi = "#6f675f"
  const digHoleX = Sx - round(size * 0.78)
  const digHoleY = Sy + round(size * 0.3)
  const digHoleW = round(size * 0.46)
  const digHoleH = round(size * 0.24)
  const shadowY = lineY + round((1 - CUT) * charH) + round(size * 0.035)
  const shadowW = round(size * 0.62)
  const shadowH = round(size * 0.13)

  const dirt = [
    { a: -54, d: 0.4, r: 0.05, delay: 0 },
    { a: -12, d: 0.48, r: 0.063, delay: -0.04 },
    { a: 30, d: 0.42, r: 0.045, delay: -0.07 },
  ]

  return (
    <span
      style={{ display: "inline-flex", "flex-direction": "column", "align-items": "center" }}
      role="img"
      aria-label="짓다 캐릭터 머리 위로 곡괭이질(측면)"
    >
      <span style={{ position: "relative", width: px(W), height: px(H) }}>
        <span style={{ position: "absolute", left: "0", top: "0", width: px(W), height: px(H), overflow: "visible" }}>
          {/* 발밑 그림자 — 곡괭이질에 맞춰 호흡 */}
          <span
            class="jt-dig-shadow"
            style={{
              position: "absolute",
              left: px(helmetX),
              top: px(shadowY),
              width: px(shadowW),
              height: px(shadowH),
              "margin-left": px(-shadowW / 2),
              "margin-top": px(-shadowH / 2),
              "border-radius": "50%",
              background: "#403b37",
            }}
          />
          {/* 구멍 뒤 림 */}
          <span
            style={{
              position: "absolute",
              left: px(digHoleX),
              top: px(digHoleY),
              width: px(digHoleW),
              height: px(digHoleH),
              transform: "translate(-50%, -50%)",
              "border-radius": "50%",
              background: "#aca69e",
            }}
          />
          {/* 팔(손+곡괭이) — 헬멧 뒤. 지면선에서 clip */}
          <span style={{ position: "absolute", left: "0", top: "0", width: px(W), height: px(digHoleY), overflow: "hidden" }}>
            <span
              class="jt-dig-swing"
              style={{
                position: "absolute",
                left: px(round(Sx - (swW * PIVOT_X) / 100)),
                top: px(round(Sy - (swH * PIVOT_Y) / 100)),
                width: px(swW),
                height: px(swH),
                "transform-origin": `${PIVOT_X}% ${PIVOT_Y}%`,
              }}
            >
              <svg width={swW} height={swH} viewBox="0 0 84 200" style={{ overflow: "visible" }}>
                <rect x="37.5" y="22" width="9" height="118" rx="4.5" fill="#9c6b3f" />
                <rect x="38" y="22" width="3" height="118" rx="1.5" fill="#bd8753" />
                <path d="M8 24 Q42 4 76 24" fill="none" stroke={headFill} stroke-width="12" stroke-linecap="round" />
                <path d="M14 21 Q42 7 70 21" fill="none" stroke={headHi} stroke-width="3.5" stroke-linecap="round" />
                <ellipse cx="32" cy="112" rx="18" ry="14" fill="#ffce2c" stroke="#e9ad03" stroke-width="2.5" />
                <ellipse cx="52" cy="128" rx="18" ry="14" fill="#ffce2c" stroke="#e9ad03" stroke-width="2.5" />
              </svg>
            </span>
          </span>
          {/* 측면 캐릭터 전신 — 곡괭이 앞. 곡괭이질과 동기 끄덕 */}
          <span
            class="jt-dig-bob"
            style={{
              position: "absolute",
              left: px(helmetX),
              top: px(helmetTop),
              "transform-origin": "50% 96%",
              transform: "translateX(-50%)",
              "--bob": px(round(size * 0.03)),
            }}
          >
            <JitdaCharSide size={charH} />
          </span>
          {/* 구멍 앞 림(하단 곡선부) — 곡괭이 위 */}
          <span
            style={{
              position: "absolute",
              left: px(digHoleX),
              top: px(digHoleY),
              width: px(digHoleW),
              height: px(digHoleH),
              transform: "translate(-50%, -50%)",
              "border-radius": "50%",
              background: "#aca69e",
              "clip-path": "inset(50% 0 0 0)",
              "-webkit-clip-path": "inset(50% 0 0 0)",
            }}
          />
        </span>
        {/* 흙 — 회색 동그라미 3개가 구멍에서 위·바깥으로 튐 */}
        <span style={{ position: "absolute", left: px(digHoleX), top: px(digHoleY - round(size * 0.05)), "z-index": "3" }}>
          <For each={dirt}>
            {(c) => (
              <span style={{ position: "absolute", left: "0", top: "0", transform: `rotate(${c.a}deg)` }}>
                <span
                  class="jt-dig-dirt"
                  style={{
                    display: "block",
                    width: px(round(size * c.r * 2)),
                    height: px(round(size * c.r * 2)),
                    "margin-left": px(-round(size * c.r)),
                    "margin-top": px(-round(size * c.r)),
                    "border-radius": "50%",
                    background: "#8f8a84",
                    opacity: "0",
                    "--pop": px(round(size * c.d)),
                    "animation-delay": `${c.delay}s`,
                  }}
                />
              </span>
            )}
          </For>
        </span>
      </span>
    </span>
  )
}
