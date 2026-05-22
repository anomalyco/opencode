"use client"

import { motion } from "framer-motion"

// 各セクション末尾に置く控えめな CTA。
// 「もっと知りたくなった」読者を CTA セクションに誘導する受け皿。
// メイン CTA (CTA.tsx) と差別化するため、塗りボタンではなく ghost / pill。

export function MicroCta({
  label = "詳しく聞いてみる",
  href = "#apply",
}: {
  label?: string
  href?: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5 }}
      className="mt-16 flex justify-center"
    >
      <a
        href={href}
        className="group inline-flex items-center gap-2 rounded-full border border-sc-border bg-sc-bg-soft/60 px-5 py-2.5 font-mono text-xs tracking-wide text-sc-text-mid backdrop-blur transition-colors hover:border-sc-ember/70 hover:bg-sc-ember/10 hover:text-sc-text"
      >
        {label}
        <span className="text-sc-ember transition-transform group-hover:translate-x-0.5">
          →
        </span>
      </a>
    </motion.div>
  )
}
