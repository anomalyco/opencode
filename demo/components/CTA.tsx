"use client"

import { motion } from "framer-motion"
import { Wordmark } from "./Wordmark"

export function CTA() {
  return (
    <section className="relative isolate w-full overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_60%,rgba(252,83,58,0.15)_0%,transparent_55%)]"
      />
      <div className="mx-auto flex max-w-4xl flex-col items-center px-6 py-32 text-center md:py-40">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.8 }}
          className="w-full max-w-lg"
        >
          <Wordmark />
        </motion.div>

        <motion.h2
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7, delay: 0.15 }}
          className="mt-8 text-balance text-3xl font-medium leading-tight md:text-4xl"
        >
          ベータ版で、
          <br className="md:hidden" />
          あなたのコードベースを試そう。
        </motion.h2>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, delay: 0.3 }}
          className="mt-4 max-w-xl text-sm leading-relaxed text-sc-text-mid"
        >
          現在 Confidential AI Suite の第 2 弾製品としてベータ提供中。
          オンプレ・エアギャップ要件のご相談も承っています。
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.45 }}
          className="mt-10 flex flex-col gap-3 sm:flex-row"
        >
          <a
            href="#"
            onClick={(e) => e.preventDefault()}
            className="rounded-md border border-sc-ember bg-sc-ember/15 px-6 py-3 font-mono text-sm text-sc-text transition-colors hover:bg-sc-ember/25"
          >
            $ ベータ版に申し込む →
          </a>
          <a
            href="#"
            onClick={(e) => e.preventDefault()}
            className="rounded-md border border-sc-border px-6 py-3 font-mono text-sm text-sc-text-mid transition-colors hover:border-sc-text-mid hover:text-sc-text"
          >
            お問い合わせ
          </a>
        </motion.div>

        <p className="mt-6 font-mono text-[10px] text-sc-text-dim">
          ※ このボタンはデモ用ダミーです。実際のリンクには接続されていません。
        </p>
      </div>
    </section>
  )
}
