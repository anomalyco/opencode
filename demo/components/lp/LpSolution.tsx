"use client"

import { motion } from "framer-motion"
import { LpFlowDiagram } from "./LpFlowDiagram"
import { LpMediaSlot } from "./LpMediaSlot"

// 「契約・規約への信頼」ではなく「仕組み」で守る、を概念図と3レイヤで端的に。
// 意思決定者が30秒で要点を掴める粒度。白基調・落ち着いたトーン。

// 「守られるしくみ」図。今は React で組んだ LpFlowDiagram を表示しているが、
// 自作の図（画像）に差し替える場合は、ここに public 配下のパス（例: "/diagram.png"）
// を入れるだけで、LpMediaSlot 経由でその画像に切り替わる（現状の図はフォールバックとして残る）。
const DIAGRAM_IMAGE: string | null = null

const LAYERS = [
  {
    step: "01",
    head: "秘密計算環境",
    title: "隔離された環境の中だけで推論する",
    body: "コードは秘密計算環境（TEE）の中だけで復号・推論。「見ない約束」ではなく、構造的に「見られない」設計です。",
  },
  {
    step: "02",
    head: "リモートアテステーション",
    title: "“本当に守られている”を検証できる",
    body: "改ざんされていない正規の環境かを暗号的に検証してから送信。安全性を自社の手元で確かめられます。",
  },
  {
    step: "03",
    head: "運用ハーネス",
    title: "AIの権限を組織が握る",
    body: "編集できるフォルダ・通信先・連携MCPを管理者ポリシーで一元制御。統制を現場任せにしません。",
  },
] as const

export function LpSolution() {
  return (
    <section id="how" className="relative w-full bg-slate-50">
      <div className="mx-auto max-w-5xl px-6 py-20 md:py-28">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5 }}
        >
          <div className="flex items-start gap-4">
            <span
              className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-blue-700 font-bold text-white"
              aria-hidden
            >
              A
            </span>
            <div>
              <span className="text-sm font-semibold text-blue-700">解決</span>
              <h2 className="mt-1 text-balance text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">
                「信頼」ではなく「仕組み」で守る。
              </h2>
              <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-slate-600">
                だから、これまでAI利用を制限せざるを得なかった組織でも導入できます。
              </p>
            </div>
          </div>
        </motion.div>

        {/* 守られるしくみ図。DIAGRAM_IMAGE を設定すると自作の図に差し替わる */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.5 }}
          className="mt-10"
        >
          {DIAGRAM_IMAGE ? (
            <LpMediaSlot aspect="wide">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={DIAGRAM_IMAGE}
                alt="機密コードが守られるしくみ"
                className="size-full object-contain"
              />
            </LpMediaSlot>
          ) : (
            <LpFlowDiagram />
          )}
        </motion.div>

        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {LAYERS.map((l, i) => (
            <motion.div
              key={l.step}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <div className="flex items-center gap-2.5">
                <span className="flex size-8 items-center justify-center rounded-lg bg-blue-700 text-sm font-bold text-white">
                  {l.step}
                </span>
                <span className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                  {l.head}
                </span>
              </div>
              <h3 className="mt-4 text-base font-semibold leading-snug text-slate-900">
                {l.title}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-slate-600">{l.body}</p>
            </motion.div>
          ))}
        </div>

        {/* TEEの補足解説。平易な説明を置き、詳細は技術ブログ (PrivacyTech Lab) へ誘導する */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.5 }}
          className="mt-10 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8"
        >
          <h3 className="text-base font-semibold text-slate-900">
            そもそも秘密計算環境とは？
          </h3>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            秘密計算環境（TEE: Trusted Execution Environment）は、CPUやGPUの中に作られる
            <strong className="font-semibold text-slate-900">「鍵のかかった隔離領域」</strong>
            です。この中のデータは閲覧出来ないことが保証されており、インフラ事業者やモデルプロバイダー、そしてサービス提供者であるAcompanyでさえも読み取ることが出来ません。そのため、送信したデータが閲覧されることも、学習に使われることも、その他外部の攻撃によって漏洩することも決してありません。
          </p>
          <a
            href="https://www.acompany.tech/privacytechlab/trusted-execution-environment"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-blue-700 underline underline-offset-2 hover:text-blue-900"
          >
            秘密計算環境の詳しい解説を読む（Acompany技術ブログPrivacyTech Lab）
            <span aria-hidden>→</span>
          </a>
        </motion.div>

        {/* 導入ステップ/構成図の差し込み枠。素材が来たら children に画像を入れる */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.5 }}
          className="mt-10"
        >
          <p className="mb-3 text-sm font-semibold text-slate-900">導入のイメージ</p>
          <LpMediaSlot label="導入ステップ・構成図（準備中）" aspect="wide" />
        </motion.div>
      </div>
    </section>
  )
}
