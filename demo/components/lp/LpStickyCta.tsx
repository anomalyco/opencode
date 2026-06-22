"use client"

import { motion, useScroll, useMotionValueEvent } from "framer-motion"
import { useEffect, useState } from "react"

// ファーストビューを抜けたら下部に出る、控えめなスティッキーCTA。
// 白基調・落ち着いた配色で「押し売り感」を出さず、行動導線だけを常に
// 手元に置く。
//
// 問い合わせフォーム (#apply) が視界に入ったら引っ込める。最下部まで
// スクロールしたときに固定バーが本来のフッターを覆ってしまうのを防ぎ、
// かつその時点では本物の CTA が見えているので floating バーは不要になる。

export function LpStickyCta() {
  const { scrollY } = useScroll()
  const [pastHero, setPastHero] = useState(false)
  const [ctaInView, setCtaInView] = useState(false)

  useMotionValueEvent(scrollY, "change", (y) => {
    setPastHero(y > 720)
  })

  useEffect(() => {
    const el = document.getElementById("apply")
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => setCtaInView(entry.isIntersecting),
      { rootMargin: "0px 0px -15% 0px" },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const shown = pastHero && !ctaInView

  return (
    <motion.div
      initial={false}
      className={`fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 shadow-[0_-4px_20px_-8px_rgba(15,23,42,0.12)] backdrop-blur transition-transform duration-300 ${
        shown ? "translate-y-0" : "translate-y-full"
      }`}
    >
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-3">
        <p className="hidden text-sm font-medium text-slate-700 sm:block">
          機密コードを守ったまま、AI開発を始める。
        </p>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <a
            href="#mid-cta"
            className="flex-1 rounded-lg bg-blue-700 px-5 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-blue-800 sm:flex-none"
          >
            β版の案内を受け取る
          </a>
          <a
            href="#apply"
            className="rounded-lg border border-slate-300 px-4 py-2.5 text-center text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-900"
          >
            相談する
          </a>
        </div>
      </div>
    </motion.div>
  )
}
