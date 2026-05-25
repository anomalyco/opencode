"use client"

import { motion } from "framer-motion"
import { MicroCta } from "./MicroCta"

const RISKS = [
  {
    tag: "INFRA",
    title: "インフラ事業者を信頼するしかない",
    body: "生成 AI への問い合わせは、推論を提供するインフラ事業者を経由する。データの取り扱いは規約に基づくが、最終的には事業者の運用と特権アクセス管理を信頼することが前提になる。",
  },
  {
    tag: "PROVIDER",
    title: "学習に使われない保証は契約だけ",
    body: "デフォルトの API では入力が学習に使われるリスクがあり、オプトアウトしても運用ログとしての保管は残る。結局のところ「モデル提供者を信頼する」契約で縛っているに過ぎない。",
  },
  {
    tag: "AGENT",
    title: "AI に強い権限を与えることのリスク",
    body: "コーディングエージェントが行うことはファイル編集・シェル実行・外部通信など多岐にわたる。AI に権限を渡すことが開発効率化には不可欠だが、その分だけインシデントリスクも増加していく。",
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
          機密コードを外に出せない組織にも、AI を。
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
        className="mt-20 border-t border-sc-border pt-10 text-center"
      >
        <p className="font-mono text-sm tracking-widest text-sc-text md:text-base">
          Acompanyセキュアコードは、この壁を<span className="text-sc-ember">3つのレイヤ</span>で壊す。
        </p>
      </motion.div>

      <MicroCta label="課題への解決策を相談する" />
    </section>
  )
}
