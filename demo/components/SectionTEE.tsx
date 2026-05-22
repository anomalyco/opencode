"use client"

import { motion, useScroll, useTransform, type MotionValue } from "framer-motion"
import { useRef } from "react"

// 5 ステップの scrollytelling。各ステップが progress の 0..1 の区間を持つ。
const STEPS = [
  {
    id: "raw",
    title: "01. 開発者の手元",
    body: "ローカルの IDE / TUI で生成されたプロンプトとソースコード。",
  },
  {
    id: "encrypt",
    title: "02. クライアント側で暗号化",
    body: "TEE の公開鍵で暗号化されたまま送出。平文はネットワークにも我々のサーバにも残らない。",
  },
  {
    id: "attest",
    title: "03. リモートアテステーション",
    body: "Intel TDX / NVIDIA Confidential Computing が発行する署名済みレポートを検証し、改ざんされた実行環境を拒否する。",
  },
  {
    id: "infer",
    title: "04. TEE 内で LLM 推論",
    body: "復号〜推論〜結果生成までを Enclave 内で完結。Acompany を含む第三者からは中身が見えない。",
  },
  {
    id: "return",
    title: "05. 暗号化されたまま応答",
    body: "戻り値も同じ秘匿経路で開発者へ。監査用の最小ログだけが外に出る。",
  },
] as const

export function SectionTEE() {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  })

  // ステップごとの「進入率」 0..1
  const a0 = useTransform(scrollYProgress, [0.0, 0.18], [0, 1], { clamp: true })
  const a1 = useTransform(scrollYProgress, [0.18, 0.38], [0, 1], { clamp: true })
  const a2 = useTransform(scrollYProgress, [0.38, 0.58], [0, 1], { clamp: true })
  const a3 = useTransform(scrollYProgress, [0.58, 0.78], [0, 1], { clamp: true })
  const a4 = useTransform(scrollYProgress, [0.78, 1.0], [0, 1], { clamp: true })

  // 流線アニメ
  const dashOffset1 = useTransform(scrollYProgress, [0.05, 0.4], [200, 0])
  const dashOffset2 = useTransform(scrollYProgress, [0.55, 0.95], [0, -200])

  // SVG 要素ごとに必要な派生値
  const teeBoxFilter = useTransform(
    a2,
    [0, 1],
    [
      "drop-shadow(0 0 0px rgba(3,76,255,0))",
      "drop-shadow(0 0 20px rgba(3,76,255,0.45))",
    ],
  )
  const blockedOpacity = useTransform(a2, [0, 1], [0, 0.9])

  return (
    <section id="tee" ref={ref} className="relative h-[420vh] w-full">
      <div className="sticky top-0 flex h-screen w-full flex-col overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_70%_30%,rgba(3,76,255,0.12)_0%,transparent_55%)]"
        />

        <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-6 py-12">
          <div className="flex items-center justify-between">
            <span className="text-stamp">02 / 価値 1</span>
            <span className="font-mono text-[10px] text-sc-text-dim">
              TRUSTED EXECUTION ENVIRONMENT
            </span>
          </div>

          <h2 className="mt-4 max-w-3xl text-balance text-3xl font-medium leading-tight md:text-5xl">
            AI 推論を、
            <span className="text-sc-ember"> 暗号化された箱の中 </span>
            だけで実行する。
          </h2>

          <div className="mt-6 grid flex-1 grid-cols-1 gap-8 md:grid-cols-[1.2fr_1fr]">
            {/* === 図 === */}
            <div className="relative flex items-center justify-center">
              <svg
                viewBox="0 0 600 380"
                className="h-full w-full max-h-[60vh]"
                aria-hidden
              >
                <defs>
                  <linearGradient id="tee-glow" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#fc533a" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#034cff" stopOpacity="0.4" />
                  </linearGradient>
                  <linearGradient id="flow" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#fc533a" />
                    <stop offset="100%" stopColor="#034cff" />
                  </linearGradient>
                </defs>

                {/* "Untrusted" boundary label (上部、TEE 外側) */}
                <text
                  x="80"
                  y="60"
                  textAnchor="middle"
                  fill="#716c6b"
                  fontFamily="JetBrains Mono, monospace"
                  fontSize="9"
                  letterSpacing="1.2"
                >
                  OUTSIDE  /  untrusted
                </text>
                <text
                  x="350"
                  y="60"
                  textAnchor="middle"
                  fill="#89b5ff"
                  fontFamily="JetBrains Mono, monospace"
                  fontSize="9"
                  letterSpacing="1.2"
                >
                  INSIDE TEE  /  trusted
                </text>
                <text
                  x="575"
                  y="60"
                  textAnchor="middle"
                  fill="#716c6b"
                  fontFamily="JetBrains Mono, monospace"
                  fontSize="9"
                  letterSpacing="1.2"
                >
                  OUTSIDE
                </text>

                {/* developer node */}
                <g>
                  <rect
                    x="20"
                    y="150"
                    width="120"
                    height="80"
                    rx="6"
                    fill="#1b1818"
                    stroke="#3e3939"
                  />
                  <StepBadge x={80} y={138} n="01" />
                  <text
                    x="80"
                    y="180"
                    textAnchor="middle"
                    fill="#b7b1b1"
                    fontFamily="JetBrains Mono, monospace"
                    fontSize="10"
                  >
                    Developer
                  </text>
                  <text
                    x="80"
                    y="200"
                    textAnchor="middle"
                    fill="#716c6b"
                    fontFamily="JetBrains Mono, monospace"
                    fontSize="9"
                  >
                    $ securecode
                  </text>
                  <motion.text
                    x="80"
                    y="215"
                    textAnchor="middle"
                    fill="#fc533a"
                    fontFamily="JetBrains Mono, monospace"
                    fontSize="8"
                    style={{ opacity: a0 }}
                  >
                    plaintext
                  </motion.text>
                </g>

                {/* arrow 1 (encryption boundary in) */}
                <motion.path
                  d="M 140 190 L 240 190"
                  fill="none"
                  stroke="url(#flow)"
                  strokeWidth="2"
                  strokeDasharray="6 6"
                  style={{ strokeDashoffset: dashOffset1 }}
                />
                <StepBadge x={190} y={166} n="02" />
                <LockIcon x={184} y={196} />
                <motion.text
                  x="200"
                  y="208"
                  textAnchor="middle"
                  fill="#fc533a"
                  fontFamily="JetBrains Mono, monospace"
                  fontSize="8"
                  style={{ opacity: a1 }}
                >
                  encrypted (AES-GCM)
                </motion.text>

                {/* TEE box */}
                <motion.rect
                  x="240"
                  y="80"
                  width="220"
                  height="220"
                  rx="8"
                  fill="#1b1818"
                  stroke="url(#tee-glow)"
                  strokeWidth="2"
                  style={{ filter: teeBoxFilter }}
                />
                <text
                  x="350"
                  y="110"
                  textAnchor="middle"
                  fill="#b7b1b1"
                  fontFamily="JetBrains Mono, monospace"
                  fontSize="10"
                >
                  Confidential VM (TEE)
                </text>
                <text
                  x="350"
                  y="124"
                  textAnchor="middle"
                  fill="#716c6b"
                  fontFamily="JetBrains Mono, monospace"
                  fontSize="9"
                >
                  Intel TDX · NVIDIA CC
                </text>

                {/* attestation badge */}
                <motion.g style={{ opacity: a2 }}>
                  <rect
                    x="262"
                    y="140"
                    width="74"
                    height="22"
                    rx="3"
                    fill="#034cff"
                    fillOpacity="0.15"
                    stroke="#034cff"
                  />
                  <text
                    x="299"
                    y="155"
                    textAnchor="middle"
                    fill="#89b5ff"
                    fontFamily="JetBrains Mono, monospace"
                    fontSize="9"
                  >
                    attested
                  </text>
                  <StepBadge x={350} y={138} n="03" tone="cobalt" />
                </motion.g>

                {/* LLM inside */}
                <motion.g style={{ opacity: a3 }}>
                  <rect
                    x="270"
                    y="180"
                    width="160"
                    height="80"
                    rx="6"
                    fill="#252121"
                    stroke="#4b4646"
                  />
                  <StepBadge x={350} y={170} n="04" tone="cobalt" />
                  <text
                    x="350"
                    y="210"
                    textAnchor="middle"
                    fill="#f1ecec"
                    fontFamily="JetBrains Mono, monospace"
                    fontSize="11"
                  >
                    Qwen3.6
                  </text>
                  <text
                    x="350"
                    y="228"
                    textAnchor="middle"
                    fill="#716c6b"
                    fontFamily="JetBrains Mono, monospace"
                    fontSize="9"
                  >
                    decrypt → infer → encrypt
                  </text>
                  <motion.rect
                    x="290"
                    y="240"
                    width="120"
                    height="4"
                    rx="2"
                    fill="#fc533a"
                    style={{ scaleX: a3, transformOrigin: "0 0" }}
                  />
                </motion.g>

                {/* arrow 2 (encryption boundary out) */}
                <motion.path
                  d="M 460 190 L 560 190"
                  fill="none"
                  stroke="url(#flow)"
                  strokeWidth="2"
                  strokeDasharray="6 6"
                  style={{ strokeDashoffset: dashOffset2, opacity: a4 }}
                />
                <motion.g style={{ opacity: a4 }}>
                  <StepBadge x={510} y={166} n="05" />
                  <LockIcon x={504} y={196} />
                </motion.g>

                {/* response node */}
                <motion.g style={{ opacity: a4 }}>
                  <rect
                    x="560"
                    y="160"
                    width="30"
                    height="60"
                    rx="4"
                    fill="#1b1818"
                    stroke="#3e3939"
                  />
                  <text
                    x="575"
                    y="195"
                    textAnchor="middle"
                    fill="#c8ffc4"
                    fontFamily="JetBrains Mono, monospace"
                    fontSize="8"
                  >
                    ok
                  </text>
                </motion.g>

                {/* 「見えない」アノテーション */}
                <motion.g style={{ opacity: blockedOpacity }}>
                  <text
                    x="350"
                    y="328"
                    textAnchor="middle"
                    fontFamily="JetBrains Mono, monospace"
                    fontSize="10"
                    fill="#fc533a"
                  >
                    ✕ infra · cloud admin · Acompany
                  </text>
                  <text
                    x="350"
                    y="344"
                    textAnchor="middle"
                    fontFamily="JetBrains Mono, monospace"
                    fontSize="9"
                    fill="#716c6b"
                  >
                    特権アクセスでも復号できない
                  </text>
                </motion.g>
              </svg>
            </div>

            {/* === ステップリスト === */}
            <ol className="space-y-3 self-center">
              <Step progress={a0} index={0} step={STEPS[0]} />
              <Step progress={a1} index={1} step={STEPS[1]} />
              <Step progress={a2} index={2} step={STEPS[2]} />
              <Step progress={a3} index={3} step={STEPS[3]} />
              <Step progress={a4} index={4} step={STEPS[4]} />
            </ol>
          </div>
        </div>
      </div>
    </section>
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

// 図中の各遷移ポイントに振る "01", "02"... のバッジ
function StepBadge({
  x,
  y,
  n,
  tone = "ember",
}: {
  x: number
  y: number
  n: string
  tone?: "ember" | "cobalt"
}) {
  const fill = tone === "cobalt" ? "#034cff" : "#fc533a"
  return (
    <g>
      <circle cx={x} cy={y} r="11" fill={fill} fillOpacity="0.18" stroke={fill} />
      <text
        x={x}
        y={y + 3}
        textAnchor="middle"
        fill={fill}
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

// 暗号化境界に置く錠前アイコン
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
