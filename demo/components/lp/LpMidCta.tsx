"use client"

import { motion } from "framer-motion"
import { LpEmailForm } from "./LpEmailForm"

// ページ中盤に置く軽量CTAバンド。スクロール途中で「気になった」読者を
// その場で拾う。重い問い合わせフォームではなくメール1項目で受ける。白基調。

export function LpMidCta() {
  return (
    <section
      id="mid-cta"
      className="relative w-full scroll-mt-20 border-y border-slate-200 bg-blue-700"
    >
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 px-6 py-16 text-center md:py-20">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.5 }}
        >
          <span className="text-xs font-semibold tracking-wider text-blue-200">
            β版 受付中
          </span>
          <h2 className="mt-3 text-balance text-xl font-bold leading-snug text-white md:text-2xl">
            β版を順次ご案内しています。
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-blue-100">
            ご登録いただいた方から順に、セットアップとご利用方法をご案内します。
            メールアドレスのご登録だけで完了します。
          </p>
        </motion.div>

        <div className="w-full rounded-2xl bg-white p-5 shadow-lg md:p-6">
          <LpEmailForm align="center" cta="β版に申し込む" />
        </div>
      </div>
    </section>
  )
}
