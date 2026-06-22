"use client"

import { motion } from "framer-motion"

// 意思決定者 (CTO / 情シス / AI活用推進) の「板挟み」を言語化する。
// 白基調で落ち着いたトーンにし、煽りではなく共感で自分ごと化させる。

const PAINS = [
  {
    no: "01",
    title: "現場は使いたい。でも承認できない。",
    body: "エンジニアはCopilotやCursorを使いたがり、生産性が上がるのも分かっている。だが機密コードが社外へ渡る構造を、責任を持って承認しきれない。",
  },
  {
    no: "02",
    title: "「学習に使いません」では監査に耐えない。",
    body: "規約やオプトアウト契約は“約束”でしかない。入力したコードはログとして保存され、事故や設定ミスで漏れるリスクも残る。",
  },
  {
    no: "03",
    title: "禁止し続けると、競争力で差がつく。",
    body: "全面禁止すれば情報は守れる。だがAI活用が当たり前になるほど、活用する組織との差は開いていく。",
  },
] as const

export function LpPain() {
  return (
    <section className="relative mx-auto max-w-5xl px-6 py-20 md:py-28">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.5 }}
      >
        <div className="flex items-start gap-4">
          <span
            className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-red-600 font-bold text-white"
            aria-hidden
          >
            Q
          </span>
          <div>
            <span className="text-sm font-semibold text-slate-500">障壁</span>
            <h2 className="mt-1 text-balance text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">
              AIを使わせたい。でも、機密コードは出せない。
            </h2>
            <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-slate-600">
              この板挟みに、心当たりはありませんか。
            </p>
          </div>
        </div>
      </motion.div>

      <div className="mt-10 grid gap-5 md:grid-cols-3">
        {PAINS.map((p, i) => (
          <motion.article
            key={p.no}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.5, delay: i * 0.1 }}
            className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <span className="text-sm font-bold text-slate-300">{p.no}</span>
            <h3 className="mt-2 text-base font-semibold leading-snug text-slate-900">
              {p.title}
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">{p.body}</p>
          </motion.article>
        ))}
      </div>

      <motion.p
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, delay: 0.2 }}
        className="mx-auto mt-12 max-w-2xl text-center text-lg font-semibold leading-relaxed text-slate-900"
      >
        Acompanyセキュアコードは、この板挟みを
        <span className="text-blue-700">「仕組み」</span>
        で終わらせます。
      </motion.p>
    </section>
  )
}
