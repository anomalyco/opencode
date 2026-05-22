"use client"

import { motion } from "framer-motion"

type Row = {
  feature: string
  generic: { mark: "○" | "◎" | "—"; note?: string }
  securecode: { mark: "○" | "◎" | "—"; note?: string }
}

// 観点は「機能」ではなく「安全性」。各セルの記号は次の意味:
//   ◯ = 人 (規約・契約・運用) を信頼することで担保
//   ◎ = 仕組み (TEE / 設定ファイル / 管理者統制) で物理的に担保
//   — = 非対応・対象外
const ROWS: Row[] = [
  {
    feature: "ソースコードが LLM 提供者の手に渡らない",
    generic: { mark: "○", note: "規約・契約で信頼" },
    securecode: { mark: "◎", note: "TEE で隔離" },
  },
  {
    feature: "入力が学習に使われない",
    generic: { mark: "○", note: "Opt-out で信頼" },
    securecode: { mark: "◎", note: "TEE 越しで見えない" },
  },
  {
    feature: "推論時のコードがインフラ事業者から見えない",
    generic: { mark: "—" },
    securecode: { mark: "◎", note: "Confidential VM" },
  },
  {
    feature: "リモートアテステーションで実行環境を検証できる",
    generic: { mark: "—" },
    securecode: { mark: "◎", note: "AMD SEV-SNP / NVIDIA CC" },
  },
  {
    feature: "誰が何を承認したか後追いできる",
    generic: { mark: "○", note: "提供者ログを信頼" },
    securecode: { mark: "◎", note: "自社で監査ログ保有" },
  },
  {
    feature: "AI の外部アクセス先を組織側から制限できる",
    generic: { mark: "—" },
    securecode: { mark: "◎", note: "予定 / 管理者一元管理" },
  },
  {
    feature: "危険な操作を人間が承認できる",
    generic: { mark: "○", note: "都度フックを設定" },
    securecode: { mark: "◎", note: "permission-policy 標準搭載" },
  },
]

export function SectionComparison() {
  return (
    <section id="compare" className="relative w-full bg-sc-bg-soft/30">
      <div className="mx-auto max-w-6xl px-6 py-32 md:py-40">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="mb-12"
        >
          <span className="text-stamp">05 / 安全性の比較</span>
          <h2 className="mt-3 text-balance text-3xl font-medium leading-tight md:text-5xl">
            「信頼」で守るのか、
            <br />
            「仕組み」で守るのか。
          </h2>
          <p className="mt-6 max-w-2xl text-sm leading-relaxed text-sc-text-mid md:text-base">
            一般的なコーディングエージェントの安全性は、最終的に
            「提供者・運用者を信頼する契約」に行き着く。Acompanyセキュアコードは、
            同じ観点を信頼ではなく物理的な隔離と組織側のポリシーで担保する。
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7 }}
          className="overflow-hidden rounded-lg border border-sc-border bg-sc-bg-soft"
        >
          <div className="grid grid-cols-[2fr_1.2fr_1.2fr] border-b border-sc-border bg-sc-bg-elev/50 px-4 py-3 font-mono text-[10px] tracking-widest text-sc-text-dim">
            <span>観点</span>
            <span className="text-center">一般的なコーディングエージェント</span>
            <span className="text-center text-sc-ember">
              Acompanyセキュアコード
            </span>
          </div>
          {ROWS.map((row) => (
            <div
              key={row.feature}
              className="grid grid-cols-[2fr_1.2fr_1.2fr] items-center border-b border-sc-border/60 px-4 py-3 text-sm last:border-b-0"
            >
              <span className="text-sc-text">{row.feature}</span>
              <Cell mark={row.generic.mark} note={row.generic.note} />
              <Cell mark={row.securecode.mark} note={row.securecode.note} highlight />
            </div>
          ))}
        </motion.div>

        <div className="mt-6 grid gap-3 text-center font-mono text-[11px] text-sc-text-dim md:grid-cols-3">
          <span>
            <span className="text-sc-text-mid">○</span> 人 (規約・契約・運用) を信頼することで担保
          </span>
          <span>
            <span className="text-sc-ember">◎</span> 仕組み (TEE・設定・管理者統制) で物理的に担保
          </span>
          <span>
            <span className="text-sc-text-dim">—</span> 非対応・対象外
          </span>
        </div>
      </div>
    </section>
  )
}

function Cell({
  mark,
  note,
  highlight = false,
}: {
  mark: "○" | "◎" | "—"
  note?: string
  highlight?: boolean
}) {
  const markColor =
    mark === "◎"
      ? highlight
        ? "text-sc-ember"
        : "text-sc-text-mid"
      : mark === "○"
        ? "text-sc-text-mid"
        : "text-sc-text-dim"
  return (
    <div className="text-center">
      <div className={`text-lg font-medium ${markColor}`}>{mark}</div>
      {note && (
        <div className="mt-1 text-[10px] text-sc-text-dim">{note}</div>
      )}
    </div>
  )
}
