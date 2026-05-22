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
    body: "AMD SEV-SNP / NVIDIA Confidential Computing が発行する署名済みレポートを検証し、改ざんされた実行環境を拒否する。",
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
      <div className="sticky top-0 flex h-[100dvh] min-h-[640px] w-full flex-col overflow-hidden">
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

          <div className="mt-6 grid flex-1 grid-cols-1 gap-6 md:grid-cols-[1.5fr_1fr]">
            {/* === 図 === */}
            <div className="relative flex items-center justify-center">
              <svg
                viewBox="0 0 620 380"
                className="block h-auto w-full"
                aria-hidden
              >
                <defs>
                  <linearGradient id="tee-glow" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#fc533a" stopOpacity="0.5" />
                    <stop offset="100%" stopColor="#034cff" stopOpacity="0.5" />
                  </linearGradient>
                  <linearGradient id="flow-right" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#fc533a" />
                    <stop offset="100%" stopColor="#034cff" />
                  </linearGradient>
                  <linearGradient id="flow-left" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#034cff" />
                    <stop offset="100%" stopColor="#fc533a" />
                  </linearGradient>
                </defs>

                {/* Zone labels: OUTSIDE (left) と INSIDE TEE (right) の 2 ゾーンのみ */}
                <text
                  x="85"
                  y="32"
                  textAnchor="middle"
                  fill="#716c6b"
                  fontFamily="JetBrains Mono, monospace"
                  fontSize="10"
                  letterSpacing="1.4"
                >
                  OUTSIDE / untrusted
                </text>
                <text
                  x="410"
                  y="32"
                  textAnchor="middle"
                  fill="#89b5ff"
                  fontFamily="JetBrains Mono, monospace"
                  fontSize="10"
                  letterSpacing="1.4"
                >
                  INSIDE TEE / trusted
                </text>
                <line
                  x1="170"
                  y1="20"
                  x2="170"
                  y2="340"
                  stroke="#3e3939"
                  strokeDasharray="2 4"
                />

                {/* Developer node (left, 縦に大きく配置して 2 本の矢印を上下に通せる高さ) */}
                <g>
                  <rect
                    x="20"
                    y="90"
                    width="130"
                    height="180"
                    rx="6"
                    fill="#1b1818"
                    stroke="#3e3939"
                  />
                  <text
                    x="85"
                    y="120"
                    textAnchor="middle"
                    fill="#b7b1b1"
                    fontFamily="JetBrains Mono, monospace"
                    fontSize="11"
                  >
                    Developer
                  </text>
                  <text
                    x="85"
                    y="138"
                    textAnchor="middle"
                    fill="#716c6b"
                    fontFamily="JetBrains Mono, monospace"
                    fontSize="9"
                  >
                    $ securecode
                  </text>
                  <motion.text
                    x="85"
                    y="158"
                    textAnchor="middle"
                    fill="#fc533a"
                    fontFamily="JetBrains Mono, monospace"
                    fontSize="9"
                    style={{ opacity: a0 }}
                  >
                    plaintext
                  </motion.text>
                  <StepBadge x={85} y={235} n="01" opacity={a0} />
                </g>

                {/* Arrow 1: Developer → TEE (top, 送信)
                 *   - 棒線部分は strokeDashoffset を 200→0 にアニメして
                 *     scroll に合わせて「描かれていく」ように見せる
                 *   - 矢じり (motion.polygon) は a1 と opacity をそろえて、
                 *     線が描き終わるタイミングで一緒に現れるようにする
                 *     (markerEnd だと strokeDashoffset と関係なく常時表示
                 *     されてしまい、線が無い状態で先に三角だけ見える) */}
                <motion.path
                  d="M 152 150 L 238 150"
                  fill="none"
                  stroke="#034cff"
                  strokeWidth="2"
                  strokeDasharray="6 6"
                  style={{ strokeDashoffset: dashOffset1 }}
                />
                <motion.polygon
                  points="228,144 239,150 228,156"
                  fill="#034cff"
                  style={{ opacity: a1 }}
                />
                <StepBadge x={195} y={120} n="02" opacity={a1} />
                <motion.text
                  x="195"
                  y="170"
                  textAnchor="middle"
                  fill="#fc533a"
                  fontFamily="JetBrains Mono, monospace"
                  fontSize="9"
                  style={{ opacity: a1 }}
                >
                  encrypted
                </motion.text>

                {/* TEE box (right, 大きく) */}
                <motion.rect
                  x="240"
                  y="60"
                  width="360"
                  height="260"
                  rx="10"
                  fill="#1b1818"
                  stroke="url(#tee-glow)"
                  strokeWidth="2.5"
                  style={{ filter: teeBoxFilter }}
                />
                <text
                  x="420"
                  y="84"
                  textAnchor="middle"
                  fill="#b7b1b1"
                  fontFamily="JetBrains Mono, monospace"
                  fontSize="11"
                  letterSpacing="1.2"
                >
                  CONFIDENTIAL VM (TEE)
                </text>
                <text
                  x="420"
                  y="100"
                  textAnchor="middle"
                  fill="#716c6b"
                  fontFamily="JetBrains Mono, monospace"
                  fontSize="9"
                >
                  AMD SEV-SNP · NVIDIA CC
                </text>

                {/* Attestation block (step 03) — シールド + 説明 */}
                <motion.g style={{ opacity: a2 }}>
                  <rect
                    x="260"
                    y="118"
                    width="320"
                    height="44"
                    rx="6"
                    fill="#034cff"
                    fillOpacity="0.1"
                    stroke="#034cff"
                    strokeOpacity="0.5"
                  />
                  {/* Shield icon */}
                  <g transform="translate(274, 132)">
                    <path
                      d="M 8 0 L 16 3 V 10 a 8 8 0 0 1 -8 8 a 8 8 0 0 1 -8 -8 V 3 Z"
                      fill="#034cff"
                      fillOpacity="0.25"
                      stroke="#034cff"
                      strokeWidth="1.4"
                    />
                    <path
                      d="M 4.5 9 L 7.5 12 L 12 6.5"
                      fill="none"
                      stroke="#034cff"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </g>
                  <text
                    x="306"
                    y="138"
                    fill="#89b5ff"
                    fontFamily="JetBrains Mono, monospace"
                    fontSize="11"
                    fontWeight="700"
                    letterSpacing="0.6"
                  >
                    ATTESTATION VERIFIED
                  </text>
                  <text
                    x="306"
                    y="154"
                    fill="#b7b1b1"
                    fontFamily="JetBrains Mono, monospace"
                    fontSize="9"
                  >
                    改ざんされた実行環境を検出して拒否
                  </text>
                  <StepBadge x={555} y={140} n="03" tone="cobalt" />
                </motion.g>

                {/* LLM block (step 04) */}
                <motion.g style={{ opacity: a3 }}>
                  <rect
                    x="260"
                    y="180"
                    width="320"
                    height="120"
                    rx="6"
                    fill="#252121"
                    stroke="#4b4646"
                  />
                  <text
                    x="280"
                    y="208"
                    fill="#f1ecec"
                    fontFamily="JetBrains Mono, monospace"
                    fontSize="13"
                    fontWeight="600"
                  >
                    Qwen3.6-35B-A3B-fp8
                  </text>
                  <text
                    x="280"
                    y="228"
                    fill="#b7b1b1"
                    fontFamily="JetBrains Mono, monospace"
                    fontSize="9"
                  >
                    decrypt → infer → encrypt
                  </text>
                  <text
                    x="280"
                    y="248"
                    fill="#716c6b"
                    fontFamily="JetBrains Mono, monospace"
                    fontSize="8"
                  >
                    平文はこの箱の中だけに存在する
                  </text>
                  <rect
                    x="280"
                    y="270"
                    width="280"
                    height="6"
                    rx="3"
                    fill="#2d2828"
                  />
                  <motion.rect
                    x="280"
                    y="270"
                    width="280"
                    height="6"
                    rx="3"
                    fill="#fc533a"
                    style={{ scaleX: a3, transformOrigin: "280px 273px" }}
                  />
                  <StepBadge x={555} y={195} n="04" tone="cobalt" />
                </motion.g>

                {/* Arrow 2: TEE → Developer (bottom, 応答)
                 *   矢じりは a4 と opacity をそろえる (Arrow 1 と同じ理屈) */}
                <motion.path
                  d="M 238 220 L 152 220"
                  fill="none"
                  stroke="#fc533a"
                  strokeWidth="2"
                  strokeDasharray="6 6"
                  style={{ strokeDashoffset: dashOffset2, opacity: a4 }}
                />
                <motion.polygon
                  points="163,214 152,220 163,226"
                  fill="#fc533a"
                  style={{ opacity: a4 }}
                />
                <StepBadge x={195} y={250} n="05" opacity={a4} />
                <motion.text
                  x="195"
                  y="208"
                  textAnchor="middle"
                  fill="#fc533a"
                  fontFamily="JetBrains Mono, monospace"
                  fontSize="9"
                  style={{ opacity: a4 }}
                >
                  encrypted response
                </motion.text>

                {/* 「TEE 内は見えない」アノテーション (TEE 図の下に配置) */}
                <motion.g style={{ opacity: blockedOpacity }}>
                  <text
                    x="420"
                    y="348"
                    textAnchor="middle"
                    fontFamily="JetBrains Mono, monospace"
                    fontSize="10"
                    fill="#fc533a"
                  >
                    ✕ infra · cloud admin · Acompany inc.
                  </text>
                  <text
                    x="420"
                    y="365"
                    textAnchor="middle"
                    fontFamily="JetBrains Mono, monospace"
                    fontSize="9"
                    fill="#716c6b"
                  >
                    特権アクセスでも TEE 内のデータは復号できない
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

// 図中の各遷移ポイントに振る "01", "02"... のバッジ。
// opacity に右ペインの side step と同じ MotionValue を渡すことで、
// 図中の badge と side step のフォーカス遷移を同期させる。
// 配色: zone (ember / cobalt) を問わず白に統一し、「これはステップ番号」
// であることを優先する。tone prop は API 互換のため残すが使わない。
function StepBadge({
  x,
  y,
  n,
  opacity,
}: {
  x: number
  y: number
  n: string
  tone?: "ember" | "cobalt"
  opacity?: MotionValue<number>
}) {
  return (
    <motion.g style={opacity ? { opacity } : undefined}>
      <circle
        cx={x}
        cy={y}
        r="13"
        fill="#f1ecec"
        fillOpacity="0.08"
        stroke="#f1ecec"
        strokeOpacity="0.7"
        strokeWidth="1.2"
      />
      <text
        x={x}
        y={y + 4}
        textAnchor="middle"
        fill="#f1ecec"
        fontFamily="JetBrains Mono, monospace"
        fontSize="11"
        fontWeight="700"
        letterSpacing="0.5"
      >
        {n}
      </text>
    </motion.g>
  )
}
