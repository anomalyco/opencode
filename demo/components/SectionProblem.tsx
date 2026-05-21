"use client"

import { motion } from "framer-motion"

const RISKS = [
  {
    tag: "INFRA",
    title: "クラウド事業者に丸見え",
    body: "生成 AI への問い合わせは、推論を提供するインフラ事業者を経由する。コードや認証情報は処理の過程でメモリ上に展開され、特権アクセスがあれば見える。",
  },
  {
    tag: "PROVIDER",
    title: "モデル提供者の学習に流れうる",
    body: "デフォルトの API では入力が学習に使われるリスクがあり、Opt-out しても運用ログとしての保管は残る。社外秘の独自ロジックを送るのは難しい。",
  },
  {
    tag: "AIR-GAP",
    title: "閉域環境では使えない",
    body: "金融・防衛・医療領域はそもそも外部 SaaS への送信が禁じられている。結果、現場のエンジニアだけが生成 AI の恩恵から取り残される。",
  },
] as const

export function SectionProblem() {
  return (
    <section
      id="problem"
      className="relative mx-auto max-w-6xl px-6 py-32 md:py-48"
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ duration: 0.7 }}
      >
        <span className="text-stamp">01 / 課題</span>
        <h2 className="mt-3 text-balance text-3xl font-medium leading-tight md:text-5xl">
          機密コードを、
          <br className="md:hidden" />
          外に出せない組織にも、
          <br />
          AI を。
        </h2>
        <p className="mt-6 max-w-2xl text-sm leading-relaxed text-sc-text-mid md:text-base">
          Claude Code や Cursor の登場以降、AI コーディングはスタンダードになりつつある。
          しかし、機密ソースコードを抱える組織はその波に乗れずにいる。
        </p>
      </motion.div>

      <div className="mt-16 grid gap-4 md:grid-cols-3">
        {RISKS.map((r, i) => (
          <motion.article
            key={r.tag}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.7, delay: i * 0.15 }}
            className="group relative rounded-lg border border-sc-border bg-sc-bg-soft p-6"
          >
            <div className="mb-4 flex items-center gap-2">
              <span className="inline-block size-1.5 rounded-full bg-sc-ember" />
              <span className="font-mono text-[10px] tracking-[0.2em] text-sc-ember">
                {r.tag}
              </span>
            </div>
            <h3 className="text-lg font-medium leading-snug text-sc-text">
              {r.title}
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-sc-text-mid">
              {r.body}
            </p>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-sc-ember/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
          </motion.article>
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8, delay: 0.4 }}
        className="mt-20 border-t border-sc-border pt-10 text-center font-mono text-xs tracking-widest text-sc-text-dim"
      >
        Secure Code は、この壁を 3 つのレイヤで壊す。
      </motion.div>
    </section>
  )
}
