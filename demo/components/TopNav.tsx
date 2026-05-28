"use client"

import { motion, useScroll, useTransform } from "framer-motion"

const SECTIONS = [
  { id: "problem", label: "課題" },
  { id: "tee", label: "TEE 保護" },
  { id: "harness", label: "ハーネス" },
  { id: "coding", label: "AI 開発" },
  { id: "compare", label: "比較" },
] as const

export function TopNav() {
  const { scrollY } = useScroll()
  const bg = useTransform(
    scrollY,
    [0, 200],
    ["rgba(19,16,16,0)", "rgba(19,16,16,0.78)"],
  )

  return (
    <motion.header
      style={{ background: bg }}
      className="fixed top-0 left-0 right-0 z-40 border-b border-sc-border/0 backdrop-blur-md"
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <a href="#top" className="flex items-center gap-2 font-mono text-xs tracking-widest text-sc-text">
          <span className="inline-block size-2 rounded-full bg-sc-ember sc-pulse" />
          Acompanyセキュアコード
        </a>
        <div className="flex items-center gap-6">
          <nav className="hidden md:flex items-center gap-6 text-xs text-sc-text-mid">
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="hover:text-sc-text transition-colors"
              >
                {s.label}
              </a>
            ))}
          </nav>
          <a
            href="#apply"
            className="group inline-flex items-center gap-1.5 rounded-full border border-sc-ember/40 bg-sc-ember/10 px-4 py-1.5 text-xs text-sc-text transition-colors hover:border-sc-ember/70 hover:bg-sc-ember/20"
          >
            問い合わせ
            <span className="text-sc-ember transition-transform group-hover:translate-x-0.5">
              →
            </span>
          </a>
        </div>
      </div>
    </motion.header>
  )
}
