"use client"

import { motion } from "framer-motion"

type Row = {
  feature: string
  claude?: string
  opencode?: string
  securecode: string
  highlight?: boolean
}

// Note: 比較は本物の挙動ではなく、デモ用に簡略化した位置づけ説明。
const ROWS: Row[] = [
  {
    feature: "ターミナルファースト UI",
    claude: "○",
    opencode: "○",
    securecode: "○",
  },
  {
    feature: "MCP / プラグイン拡張",
    claude: "○",
    opencode: "○",
    securecode: "◎ harness 強化",
    highlight: true,
  },
  {
    feature: "コードが LLM 提供者に送られない",
    claude: "—",
    opencode: "—",
    securecode: "◎ TEE 内で処理",
    highlight: true,
  },
  {
    feature: "tool output の自動マスキング",
    claude: "—",
    opencode: "—",
    securecode: "◎ secret-mask",
    highlight: true,
  },
  {
    feature: "context overflow からの自動防御",
    claude: "△",
    opencode: "△",
    securecode: "◎ overflow-guard",
    highlight: true,
  },
  {
    feature: "リモートアテステーション",
    claude: "—",
    opencode: "—",
    securecode: "◎",
    highlight: true,
  },
  {
    feature: "監査ログ",
    claude: "△",
    opencode: "△",
    securecode: "◎",
  },
  {
    feature: "エアギャップ / 閉域 LLM",
    claude: "—",
    opencode: "△",
    securecode: "○ 専用構成可",
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
          <span className="text-stamp">05 / Position</span>
          <h2 className="mt-3 text-balance text-3xl font-medium leading-tight md:text-5xl">
            既存の Coding Agent との
            <br />
            違いを、一枚で。
          </h2>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7 }}
          className="overflow-hidden rounded-lg border border-sc-border bg-sc-bg-soft"
        >
          <div className="grid grid-cols-[1.4fr_1fr_1fr_1.2fr] border-b border-sc-border bg-sc-bg-elev/50 px-4 py-3 font-mono text-[10px] tracking-widest text-sc-text-dim">
            <span>FEATURE</span>
            <span className="text-center">Claude Code</span>
            <span className="text-center">opencode</span>
            <span className="text-center text-sc-ember">SECURE CODE</span>
          </div>
          {ROWS.map((row) => (
            <div
              key={row.feature}
              className={`grid grid-cols-[1.4fr_1fr_1fr_1.2fr] items-center border-b border-sc-border/60 px-4 py-3 text-sm last:border-b-0 ${row.highlight ? "bg-sc-ember/[0.04]" : ""}`}
            >
              <span className="text-sc-text">{row.feature}</span>
              <span className="text-center text-sc-text-dim">{row.claude ?? "—"}</span>
              <span className="text-center text-sc-text-dim">{row.opencode ?? "—"}</span>
              <span className="text-center font-medium text-sc-ember">
                {row.securecode}
              </span>
            </div>
          ))}
        </motion.div>

        <p className="mt-6 text-center font-mono text-[10px] text-sc-text-dim">
          ○ 標準対応 / ◎ 主要差別化 / △ 部分対応 / — 非対応
        </p>
      </div>
    </section>
  )
}
