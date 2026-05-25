"use client"

import { motion } from "framer-motion"
import { MicroCta } from "./MicroCta"

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
    feature: "入力が社外に漏洩しない",
    generic: { mark: "○", note: "規約・契約で担保" },
    securecode: { mark: "◎", note: "TEE で物理的に隔離して担保" },
  },
  {
    feature: "実行環境を検証できる",
    generic: { mark: "—" },
    securecode: { mark: "◎", note: "リモートアテステーションで担保" },
  },
  {
    feature: "外部アクセス先の制限",
    generic: { mark: "○", note: "個別設定に依存" },
    securecode: { mark: "◎", note: "管理者ポリシーで一元強制" },
  },
  {
    feature: "操作ごとの柔軟な権限設定",
    generic: { mark: "○", note: "個別設定に依存" },
    securecode: { mark: "◎", note: "管理者ポリシーで一元強制" },
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
            一般的なコーディングエージェントの安全性は、最終的に運用元への信頼に依存している。
            Acompanyセキュアコードは、同じ観点を信頼ではなく物理的な隔離と組織側のポリシーで担保する。
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
            <span className="text-sc-text-mid">○</span> 人 (規約・契約・個別運用) を信頼することで担保
          </span>
          <span>
            <span className="text-sc-ember">◎</span> 仕組み (TEE・設定ファイル・管理者統制) で機械的に担保
          </span>
          <span>
            <span className="text-sc-text-dim">—</span> 非対応・対象外
          </span>
        </div>

        <MicroCta label="自社への導入を相談する" />
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
