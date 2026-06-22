"use client"

import { motion } from "framer-motion"

// 意思決定者がメール登録・問い合わせの前に必ず引っかかる反論を先回りで
// 潰すFAQ。稟議を通す側の不安に答える粒度。白基調・アコーディオン。

const QA = [
  {
    q: "本当にコードの中身を誰にも見られないのですか？",
    a: "コードはConfidential Computing 環境（TEE）の中だけで復号・推論され、提供元の Acompany も、インフラ事業者・モデル提供者もアクセスできません。「見ない運用」ではなく、構造的に「見られない」設計です。",
  },
  {
    q: "どの AI モデルが使えますか？",
    a: "GPT-OSS / Gemma / Qwen などのオープンウェイト高性能モデルを、Confidential Computing 環境の上で利用します。クラウド AI に平文を送らないため、機密を保ったまま生成・レビュー・リファクタ・テスト生成に使えます。",
  },
  {
    q: "Claude Code や Cursor とは何が違うのですか？",
    a: "一般的な AI ツールは「漏らさない・学習に使わない」を規約や契約で担保します。セキュアコードはConfidential Computing 環境による物理的な隔離と、自社で検証できるリモートアテステーションで担保します。操作感は使い慣れた TUI のままです。",
  },
  {
    q: "導入のハードルは高いですか？",
    a: "既存のコーディングエージェントに近い操作感で使えます。編集できるフォルダ・通信先・連携 MCP は管理者ポリシーで一元制御でき、現場に自由を与えつつ組織で統制できます。",
  },
  {
    q: "今すぐ使えますか？費用は？",
    a: "β 版を提供中で、ウェイティングリストにご登録いただいた方から順次ご案内しています。導入条件・費用の詳細は、お問い合わせよりお気軽にご相談ください。",
  },
] as const

export function LpFaq() {
  return (
    <section id="faq" className="relative w-full bg-slate-50">
      <div className="mx-auto max-w-3xl px-5 py-20 md:px-6 md:py-28">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5 }}
          className="mb-8"
        >
          <span className="text-sm font-semibold text-brand-600">FAQ</span>
          <h2 className="mt-3 text-balance text-2xl font-bold tracking-tight text-slate-900 md:text-[2rem]">
            導入を判断する前に。
          </h2>
        </motion.div>

        <div className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {QA.map((item) => (
            <details key={item.q} className="group px-5 py-4 md:px-6">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-slate-900 marker:hidden">
                {item.q}
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-brand-600 transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-slate-600">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}
