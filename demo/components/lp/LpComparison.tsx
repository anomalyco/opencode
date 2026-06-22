"use client"

import { motion } from "framer-motion"

// 既存SectionComparisonの論点 (信頼で守るか / 仕組みで守るか) を、LP用に
// 凝縮した比較表。稟議・社内説明にそのまま使える粒度。白基調。

type Mark = "○" | "◎" | "—"

const ROWS: { feature: string; generic: [Mark, string]; sc: [Mark, string] }[] = [
  {
    feature: "入力コードが社外に漏れない",
    generic: ["○", "規約・契約で担保"],
    sc: ["◎", "秘密計算環境で隔離"],
  },
  {
    feature: "学習に使われない",
    generic: ["○", "オプトアウト契約"],
    sc: ["◎", "そもそも平文が出ない"],
  },
  {
    feature: "安全性を自社で検証できる",
    generic: ["—", "—"],
    sc: ["◎", "リモートアテステーション"],
  },
  {
    feature: "AIの権限を組織で統制",
    generic: ["○", "個人設定に依存"],
    sc: ["◎", "管理者ポリシーで一元強制"],
  },
]

export function LpComparison() {
  return (
    <section className="relative mx-auto max-w-5xl px-6 py-20 md:py-28">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.5 }}
        className="mb-8"
      >
        <span className="text-sm font-semibold text-blue-700">既存のAIツールとの違い</span>
        <h2 className="mt-3 text-balance text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">
          一般的なAIコーディングと、何が違うのか。
        </h2>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.55 }}
        className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
      >
        <div className="grid grid-cols-[1.6fr_1fr_1.2fr] border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-500 md:px-6">
          <span>観点</span>
          <span className="text-center">一般的なAIツール</span>
          <span className="text-center text-blue-700">セキュアコード</span>
        </div>
        {ROWS.map((row) => (
          <div
            key={row.feature}
            className="grid grid-cols-[1.6fr_1fr_1.2fr] items-center border-b border-slate-100 px-4 py-3.5 text-sm last:border-b-0 md:px-6"
          >
            <span className="font-medium text-slate-800">{row.feature}</span>
            <Cell mark={row.generic[0]} note={row.generic[1]} />
            <Cell mark={row.sc[0]} note={row.sc[1]} highlight />
          </div>
        ))}
      </motion.div>

      <div className="mt-4 flex flex-wrap justify-center gap-x-6 gap-y-1.5 text-center text-xs text-slate-500">
        <span>
          <span className="font-medium text-slate-600">○</span> 人（規約・契約）への信頼で担保
        </span>
        <span>
          <span className="font-bold text-blue-700">◎</span> 仕組み（秘密計算環境・統制）で機械的に担保
        </span>
        <span>
          <span className="text-slate-400">—</span> 非対応・対象外
        </span>
      </div>

      <p className="mt-5 text-center text-xs leading-relaxed text-slate-400">
        ※ 一部の機能は現在も鋭意開発中です。提供時期・仕様は変わる可能性があり、
        現時点でご利用いただける範囲はお問い合わせください。
      </p>
    </section>
  )
}

function Cell({
  mark,
  note,
  highlight = false,
}: {
  mark: Mark
  note: string
  highlight?: boolean
}) {
  const color =
    mark === "◎"
      ? highlight
        ? "text-blue-700"
        : "text-slate-500"
      : mark === "○"
        ? "text-slate-500"
        : "text-slate-300"
  return (
    <div className={`text-center ${highlight ? "rounded-lg bg-blue-50/60 py-1" : ""}`}>
      <div className={`text-lg font-bold ${color}`}>{mark}</div>
      {note && note !== "—" && (
        <div className="mt-0.5 text-[11px] text-slate-500">{note}</div>
      )}
    </div>
  )
}
