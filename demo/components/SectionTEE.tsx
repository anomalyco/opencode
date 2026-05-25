"use client"

import { motion, useScroll, useTransform, type MotionValue } from "framer-motion"
import { useRef } from "react"
import { MicroCta } from "./MicroCta"

// 4 ステップの scrollytelling。各ステップが progress の 0..1 の区間を持つ。
//   01 リモートアテステーション (TEE の正当性を検証)
//   02 暗号化して送信          (prompt に鍵が被さり、TEE へ移動、TEE 内で鍵が外れる)
//   03 LLM 推論                (prompt を LLM model に渡し、response を生成)
//   04 暗号化して返信          (response に鍵が被さり、手元へ移動、手元で鍵が外れる)
const STEPS = [
  {
    id: "attest",
    title: "01. リモートアテステーション",
    body: "接続先サーバーが本当に TEE 上で動いており、想定通りのコードを実行していることを CPU 製造元の署名付きレポートで検証する。想定外のコードや設定が動いている環境には鍵を渡さない。",
  },
  {
    id: "send",
    title: "02. 暗号化して送信",
    body: "TEE と DH 鍵交換で共有した共通鍵でプロンプトとソースコードを暗号化して送出し、TEE 内で復号する。平文は TEE の外に一切露出しない。",
  },
  {
    id: "infer",
    title: "03. TEE 内で LLM 推論",
    body: "復号した入力で LLM 推論を実行。Acompany を含む第三者からは、処理中のコードも生成結果も見えない。",
  },
  {
    id: "return",
    title: "04. 暗号化して返信",
    body: "戻り値も同じ共通鍵で暗号化し、開発者の手元で復号。平文は最後まで TEE の外に出ない。",
  },
] as const

export function SectionTEE() {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  })

  // ステップごとの「進入率」 0..1
  const a0 = useTransform(scrollYProgress, [0.0, 0.22], [0, 1], { clamp: true })
  const a1 = useTransform(scrollYProgress, [0.26, 0.52], [0, 1], { clamp: true })
  const a2 = useTransform(scrollYProgress, [0.54, 0.72], [0, 1], { clamp: true })
  const a3 = useTransform(scrollYProgress, [0.74, 1.0], [0, 1], { clamp: true })

  // --- Step 01: アテステーション ---
  const attestShow = useTransform(a0, [0.15, 0.55], [0, 1], { clamp: true })
  const teeBoxFilter = useTransform(
    a0,
    [0, 1],
    [
      "drop-shadow(0 0 0px rgba(3,76,255,0))",
      "drop-shadow(0 0 18px rgba(3,76,255,0.4))",
    ],
  )
  const blockedOpacity = useTransform(a0, [0.5, 1], [0, 0.95], { clamp: true })

  // --- Step 02: 暗号化して送信（prompt パケット）---
  // prompt は最初から表示。Step 03 中盤で LLM model に吸収されて消える。
  const promptOpacity = useTransform(
    scrollYProgress,
    [0, 0.62, 0.68],
    [1, 1, 0],
    { clamp: true },
  )
  const fwdX = useTransform(a1, [0, 0.28, 0.78, 1], [0, 0, 288, 288])
  const fwdLock = useTransform(a1, [0.1, 0.24, 0.74, 0.88], [0, 1, 1, 0])
  // 矢印の線は Step 02 で出現し、Step 03 に移ったタイミングで消える
  const fwdLineOpacity = useTransform(a1, [0, 0.12, 0.9, 1], [0, 1, 1, 0], {
    clamp: true,
  })
  // バッジ 02 は出現したら消さずに残す
  const fwdBadgeOpacity = useTransform(a1, [0, 0.12], [0, 1], { clamp: true })

  // --- Step 03: LLM 推論 ---
  const llmStroke = useTransform(a2, [0, 1], ["#4b4646", "#89b5ff"])
  const llmBarScale = useTransform(a2, [0.1, 0.9], [0, 1], { clamp: true })
  // 他のバッジと同様、Step 03 に入ったタイミングで濃く表示する
  const llmBadgeOpacity = useTransform(a2, [0, 0.12], [0, 1], { clamp: true })

  // --- Step 04: 暗号化して返信（response パケット）---
  // response は Step 03 後半で LLM model から出てくる。
  const retShell = useTransform(scrollYProgress, [0.63, 0.7], [0, 1], {
    clamp: true,
  })
  const retX = useTransform(a3, [0, 0.28, 0.78, 1], [0, 0, -288, -288])
  const retLock = useTransform(a3, [0.1, 0.24, 0.74, 0.88], [0, 1, 1, 0])
  // 矢印の線は Step 04 で出現し、Step 04 の終わりで消える
  const retLineOpacity = useTransform(a3, [0, 0.12, 0.88, 1], [0, 1, 1, 0], {
    clamp: true,
  })
  // バッジ 04 は出現したら消さずに残す
  const retBadgeOpacity = useTransform(a3, [0, 0.12], [0, 1], { clamp: true })

  // Mobile: step card slide transitions (右からスライドイン、左へスライドアウト)
  const mob0Op = useTransform(scrollYProgress, [0.00, 0.10, 0.22, 0.32], [0, 1, 1, 0], { clamp: true })
  const mob0X = useTransform(scrollYProgress, [0.00, 0.10, 0.22, 0.32], [20, 0, 0, -20], { clamp: true })
  const mob1Op = useTransform(scrollYProgress, [0.26, 0.36, 0.48, 0.58], [0, 1, 1, 0], { clamp: true })
  const mob1X = useTransform(scrollYProgress, [0.26, 0.36, 0.48, 0.58], [20, 0, 0, -20], { clamp: true })
  const mob2Op = useTransform(scrollYProgress, [0.52, 0.62, 0.70, 0.78], [0, 1, 1, 0], { clamp: true })
  const mob2X = useTransform(scrollYProgress, [0.52, 0.62, 0.70, 0.78], [20, 0, 0, -20], { clamp: true })
  const mob3Op = useTransform(scrollYProgress, [0.74, 0.84, 1.00, 1.00], [0, 1, 1, 1], { clamp: true })
  const mob3X = useTransform(scrollYProgress, [0.74, 0.84], [20, 0], { clamp: true })

  return (
    <>
    <section
      id="tee"
      ref={ref}
      className="relative w-full h-[420vh]"
    >
      {/*
       * Desktop (>= md): sticky + h-[100dvh] で scrollytelling として、
       *   外側 h-[420vh] の 4 倍スクロール範囲で a0..a3 を進行させる。
       * Mobile (< md):  h-[420vh] + sticky で desktop と同じ scrollytelling。
        *   図とステップカードが sticky viewport 内で同期アニメーション。
        */}
      <div className="flex w-full flex-col sticky top-0 h-[100dvh] min-h-[640px] overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_70%_30%,rgba(3,76,255,0.12)_0%,transparent_55%)]"
        />

        <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-6 py-12">
          <div className="flex items-center justify-between">
            <span className="text-stamp">02 / 価値 1 · TEE 保護</span>
            <span className="font-mono text-[10px] text-sc-text-dim">
              TRUSTED EXECUTION ENVIRONMENT
            </span>
          </div>

          <h2 className="mt-4 max-w-3xl text-balance text-3xl font-medium leading-tight md:text-5xl">
            AI 推論を、
            <span className="text-sc-ember">TEE</span> で物理的に隔離する。
            <br className="md:hidden" />
            だから、誰も中を覗けない。
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-sc-text-mid md:text-base">
            Trusted Execution Environment (TEE) は CPU 内に物理的に隔離された
            実行領域。推論中の平文がメモリ上に展開されても、インフラ事業者を含む
            第三者からは参照できない。
          </p>

          <div className="mt-6 flex flex-1 flex-col gap-4 md:grid md:grid-cols-[1.8fr_1fr] md:gap-8">
            {/* === 図 === */}
            <div className="relative flex min-h-0 flex-[3] items-center justify-center">
              <svg
                viewBox="0 0 520 420"
                className="h-full w-full max-h-[62vh]"
                aria-hidden
              >
                <defs>
                  <linearGradient id="tee-glow" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#fc533a" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#034cff" stopOpacity="0.4" />
                  </linearGradient>
                  <marker
                    id="arrow"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="7"
                    markerHeight="7"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1 L 9 5 L 0 9 z" fill="#fc533a" />
                  </marker>
                </defs>

                {/* 領域ラベル */}
                <text
                  x="116"
                  y="120"
                  textAnchor="middle"
                  fill="#716c6b"
                  fontFamily="JetBrains Mono, monospace"
                  fontSize="10"
                  letterSpacing="1.2"
                >
                  Developer
                </text>
                <text
                  x="404"
                  y="96"
                  textAnchor="middle"
                  fill="#89b5ff"
                  fontFamily="JetBrains Mono, monospace"
                  fontSize="10"
                  letterSpacing="1.2"
                >
                  TEE Server
                </text>

                {/* Local node — 常時発光 */}
                <rect
                  x="28"
                  y="146"
                  width="176"
                  height="180"
                  rx="8"
                  fill="#1b1818"
                  stroke="#3e3939"
                  style={{ filter: "drop-shadow(0 0 12px rgba(200,255,196,0.4))" }}
                />
                <text
                  x="116"
                  y="182"
                  textAnchor="middle"
                  fill="#b7b1b1"
                  fontFamily="JetBrains Mono, monospace"
                  fontSize="12"
                >
                  Local
                </text>
                <text
                  x="116"
                  y="202"
                  textAnchor="middle"
                  fill="#716c6b"
                  fontFamily="JetBrains Mono, monospace"
                  fontSize="9"
                >
                  $ securecode
                </text>

                {/* source code — Local 環境に置かれたコード */}
                <FileIcon x={76} y={216} />
                <text
                  x="96"
                  y="230"
                  fill="#716c6b"
                  fontFamily="JetBrains Mono, monospace"
                  fontSize="9"
                >
                  source code
                </text>

                {/* TEE box */}
                <motion.rect
                  x="312"
                  y="118"
                  width="184"
                  height="208"
                  rx="10"
                  fill="#1b1818"
                  stroke="url(#tee-glow)"
                  strokeWidth="2"
                  style={{ filter: teeBoxFilter }}
                />

                {/* Step 01: attestation — バッジ(左) + 盾アイコン + ラベル を横並び */}
                <motion.g style={{ opacity: attestShow }}>
                  <StepBadge x={344} y={152} n="01" tone="cobalt" />
                  <ShieldIcon x={362} y={144} />
                  <text
                    x="384"
                    y="156"
                    fill="#89b5ff"
                    fontFamily="JetBrains Mono, monospace"
                    fontSize="10"
                  >
                    attested
                  </text>
                </motion.g>

                {/* Step 03: LLM box */}
                <motion.rect
                  x="336"
                  y="186"
                  width="136"
                  height="126"
                  rx="6"
                  fill="#252121"
                  style={{ stroke: llmStroke }}
                  strokeWidth="1.5"
                />
                <RobotIcon x={395} y={187} />
                <text
                  x="404"
                  y="218"
                  textAnchor="middle"
                  fill="#f1ecec"
                  fontFamily="JetBrains Mono, monospace"
                  fontSize="11"
                >
                  LLM model
                </text>
                <motion.g style={{ opacity: llmBadgeOpacity }}>
                  <StepBadge x={404} y={234} n="03" tone="cobalt" />
                </motion.g>
                <rect
                  x="356"
                  y="276"
                  width="96"
                  height="4"
                  rx="2"
                  fill="#2f2b2b"
                />
                <motion.rect
                  x="356"
                  y="276"
                  width="96"
                  height="4"
                  rx="2"
                  fill="#034cff"
                  style={{ scaleX: llmBarScale, transformOrigin: "0 0" }}
                />

                {/* Step 02: 往路の矢印 (Local → TEE) — 軸 + 三角 */}
                <motion.path
                  d="M 204 258 L 312 258"
                  fill="none"
                  stroke="#fc533a"
                  strokeWidth="2.5"
                  markerEnd="url(#arrow)"
                  style={{ opacity: fwdLineOpacity }}
                />
                <motion.g style={{ opacity: fwdBadgeOpacity }}>
                  <StepBadge x={258} y={234} n="02" />
                </motion.g>

                {/* Step 04: 復路の矢印 (TEE → Local) — 軸 + 三角 */}
                <motion.path
                  d="M 312 294 L 204 294"
                  fill="none"
                  stroke="#fc533a"
                  strokeWidth="2.5"
                  markerEnd="url(#arrow)"
                  style={{ opacity: retLineOpacity }}
                />
                <motion.g style={{ opacity: retBadgeOpacity }}>
                  <StepBadge x={258} y={318} n="04" />
                </motion.g>

                {/* prompt パケット — 最初から表示、Step 02 で TEE へ移動 */}
                <motion.g style={{ x: fwdX, opacity: promptOpacity }}>
                  <rect
                    x="80"
                    y="246"
                    width="72"
                    height="24"
                    rx="4"
                    fill="#252121"
                    stroke="#4b4646"
                  />
                  <text
                    x="116"
                    y="262"
                    textAnchor="middle"
                    fill="#b7b1b1"
                    fontFamily="JetBrains Mono, monospace"
                    fontSize="9"
                  >
                    prompt
                  </text>
                  {/* 鍵は prompt に被さる */}
                  <motion.g style={{ opacity: fwdLock }}>
                    <LockIcon x={110} y={252} />
                  </motion.g>
                </motion.g>

                {/* response パケット — Step 03 で LLM から出現、Step 04 で Local へ移動 */}
                <motion.g style={{ x: retX, opacity: retShell }}>
                  <rect
                    x="368"
                    y="282"
                    width="72"
                    height="24"
                    rx="4"
                    fill="#252121"
                    stroke="#4b4646"
                  />
                  <text
                    x="404"
                    y="298"
                    textAnchor="middle"
                    fill="#c8ffc4"
                    fontFamily="JetBrains Mono, monospace"
                    fontSize="9"
                  >
                    response
                  </text>
                  {/* 鍵は response に被さる */}
                  <motion.g style={{ opacity: retLock }}>
                    <LockIcon x={398} y={288} />
                  </motion.g>
                </motion.g>

                {/* 「外からは覗けない」— 弾かれ表現 */}
                <motion.g style={{ opacity: blockedOpacity }}>
                  <text
                    x="404"
                    y="350"
                    textAnchor="middle"
                    fontFamily="JetBrains Mono, monospace"
                    fontSize="9"
                    fill="#716c6b"
                  >
                    TEE の外からは、特権アクセスでも閲覧できない
                  </text>
                  <DenyItem cx={348} label="クラウド事業者" />
                  <DenyItem cx={462} label="Acompany" />
                </motion.g>
              </svg>
            </div>

            {/* === ステップリスト === */}
            <ol className="hidden space-y-3 self-center md:block">
              <Step progress={a0} index={0} step={STEPS[0]} />
              <Step progress={a1} index={1} step={STEPS[1]} />
              <Step progress={a2} index={2} step={STEPS[2]} />
              <Step progress={a3} index={3} step={STEPS[3]} />
            </ol>

            {/* モバイル: スライドイン/アウト */}
            <div className="relative min-h-0 flex-[2] md:hidden">
              <motion.div style={{ opacity: mob0Op, x: mob0X }} className="absolute inset-0 flex items-center">
                <MobileStepCard index={0} step={STEPS[0]} />
              </motion.div>
              <motion.div style={{ opacity: mob1Op, x: mob1X }} className="absolute inset-0 flex items-center">
                <MobileStepCard index={1} step={STEPS[1]} />
              </motion.div>
              <motion.div style={{ opacity: mob2Op, x: mob2X }} className="absolute inset-0 flex items-center">
                <MobileStepCard index={2} step={STEPS[2]} />
              </motion.div>
              <motion.div style={{ opacity: mob3Op, x: mob3X }} className="absolute inset-0 flex items-center">
                <MobileStepCard index={3} step={STEPS[3]} />
              </motion.div>
            </div>
          </div>
        </div>
      </div>
    </section>
    {/* sticky scrollytelling 終了後の自然な位置に出すため、
        section の外で MicroCta を出す。inside だと sticky viewport に
        張り付き続けて主役の図と CTA が常時並ぶ形になる。 */}
    <div className="mx-auto max-w-6xl px-6 pb-16 md:pb-24">
      <MicroCta label="TEE 構成の詳細を相談する" />
    </div>
    </>
  )
}

function Step({
  progress,
  index,
  step,
}: {
  progress: MotionValue<number>
  index: number
  step: (typeof STEPS)[number]
}) {
  const opacity = useTransform(progress, [0, 0.4, 1], [0.25, 0.7, 1])
  const x = useTransform(progress, [0, 1], [12, 0])
  const borderColor = useTransform(
    progress,
    [0, 1],
    ["rgba(75,70,70,0.5)", "rgba(252,83,58,0.9)"],
  )
  const dotScale = useTransform(progress, [0, 1], [0.6, 1.4])

  return (
    <motion.li
      style={{ opacity, x, borderColor }}
      className="rounded-md border bg-sc-bg-soft/60 p-4 backdrop-blur-sm"
    >
      <div className="mb-1 flex items-center gap-2">
        <motion.span
          className="block size-1.5 rounded-full bg-sc-ember"
          style={{ scale: dotScale }}
        />
        <span className="font-mono text-[10px] tracking-[0.18em] text-sc-text-dim">
          STEP {String(index + 1).padStart(2, "0")}
        </span>
      </div>
      <h3 className="text-base font-medium text-sc-text">{step.title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-sc-text-mid">
        {step.body}
      </p>
    </motion.li>
  )
}

function MobileStepCard({
  index,
  step,
}: {
  index: number
  step: (typeof STEPS)[number]
}) {
  return (
    <div className="w-full rounded-md border border-[rgba(252,83,58,0.9)] bg-sc-bg-soft/60 p-4 backdrop-blur-sm">
      <div className="mb-1 flex items-center gap-2">
        <span className="block size-1.5 rounded-full bg-sc-ember" />
        <span className="font-mono text-[10px] tracking-[0.18em] text-sc-text-dim">
          STEP {String(index + 1).padStart(2, "0")}
        </span>
      </div>
      <h3 className="text-base font-medium text-sc-text">{step.title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-sc-text-mid">{step.body}</p>
    </div>
  )
}

// 図中の各遷移ポイントに振る "01", "02"... のバッジ。
// 配色: zone (ember / cobalt) を問わず白に統一し、「これはステップ番号」
// であることを優先する。tone prop は API 互換のため残すが使わない。
function StepBadge({
  x,
  y,
  n,
}: {
  x: number
  y: number
  n: string
  tone?: "ember" | "cobalt"
}) {
  return (
    <g>
      <circle
        cx={x}
        cy={y}
        r="11"
        fill="#f1ecec"
        fillOpacity="0.08"
        stroke="#f1ecec"
        strokeOpacity="0.7"
        strokeWidth="1.2"
      />
      <text
        x={x}
        y={y + 3}
        textAnchor="middle"
        fill="#f1ecec"
        fontFamily="JetBrains Mono, monospace"
        fontSize="10"
        fontWeight="700"
        letterSpacing="0.5"
      >
        {n}
      </text>
    </g>
  )
}

// 暗号化を表す錠前アイコン
function LockIcon({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect width="12" height="9" y="3" rx="1.5" fill="#fc533a" />
      <path
        d="M 3 3 V 1.5 a 3 3 0 0 1 6 0 V 3"
        fill="none"
        stroke="#fc533a"
        strokeWidth="1.4"
      />
      <circle cx="6" cy="7.5" r="1.2" fill="#131010" />
    </g>
  )
}

// 検証済み (信頼できる) を表す盾アイコン
function ShieldIcon({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <path
        d="M 7 0 L 14 3 V 8 C 14 12 7 16 7 16 C 7 16 0 12 0 8 V 3 Z"
        fill="#89b5ff"
        fillOpacity="0.18"
        stroke="#89b5ff"
        strokeWidth="1.2"
      />
      <path
        d="M 4 8 L 6 10.5 L 10.5 5"
        fill="none"
        stroke="#89b5ff"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  )
}

// LLM model を表すロボットアイコン
function RobotIcon({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* アンテナ */}
      <line x1="9" y1="0" x2="9" y2="3" stroke="#89b5ff" strokeWidth="1.2" />
      <circle cx="9" cy="0" r="1.4" fill="#89b5ff" />
      {/* 頭 */}
      <rect
        x="1"
        y="3"
        width="16"
        height="13"
        rx="3"
        fill="#89b5ff"
        fillOpacity="0.16"
        stroke="#89b5ff"
        strokeWidth="1.2"
      />
      {/* 目 */}
      <circle cx="6" cy="9.5" r="1.7" fill="#89b5ff" />
      <circle cx="12" cy="9.5" r="1.7" fill="#89b5ff" />
    </g>
  )
}

// source code を表す書類アイコン
function FileIcon({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <path
        d="M 0 0 H 9 L 13 4 V 17 H 0 Z"
        fill="#252121"
        stroke="#5a5454"
        strokeWidth="1"
      />
      <path d="M 9 0 V 4 H 13" fill="none" stroke="#5a5454" strokeWidth="1" />
      <line x1="3" y1="8" x2="10" y2="8" stroke="#716c6b" strokeWidth="1" />
      <line x1="3" y1="11" x2="10" y2="11" stroke="#716c6b" strokeWidth="1" />
      <line x1="3" y1="14" x2="8" y2="14" stroke="#716c6b" strokeWidth="1" />
    </g>
  )
}

// TEE の中を覗けない主体を示す「拒否アイテム」(枠なし)
function DenyItem({ cx, label }: { cx: number; label: string }) {
  return (
    <text
      x={cx}
      y={370}
      textAnchor="middle"
      fontFamily="JetBrains Mono, monospace"
      fontSize="9"
    >
      <tspan fill="#fc533a" fontWeight="700">
        ✕{" "}
      </tspan>
      <tspan fill="#9a8f8e" textDecoration="line-through">
        {label}
      </tspan>
    </text>
  )
}
