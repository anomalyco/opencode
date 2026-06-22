"use client"

import { motion } from "framer-motion"

// 姉妹製品セキュアチャットの紹介。実スクショ（public/lp/securechat.png）を使う。

const FEATURES = ["Confidential Computing 環境で推論", "社内ドキュメント連携", "管理者統制"] as const

export function LpSecureChat() {
  return (
    <section id="chat" className="relative w-full border-t border-slate-100 bg-white">
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-20 md:px-6 md:py-28 lg:grid-cols-2">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5 }}
        >
          <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11.5px] font-bold text-slate-600">
            姉妹製品 ／ セキュアコードとは別の製品です
          </span>
          <h2 className="mt-3 text-balance text-2xl font-bold leading-tight tracking-tight text-slate-900 md:text-[2rem]">
            コードはセキュアコード。
            <br className="hidden sm:inline" />
            チャットはセキュアチャット。
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-slate-600">
            セキュアコードのチャット版。同じ TEE 基盤で動く、コーディング以外の業務向け
            製品です。社外秘の資料も顧客データも、平文を外に出さずに AI へ相談できます。
          </p>
          <ul className="mt-6 flex flex-wrap gap-2">
            {FEATURES.map((f) => (
              <li
                key={f}
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700"
              >
                {f}
              </li>
            ))}
          </ul>
          <a
            href="https://service.acompany.tech/cas/secure-chat/"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 underline underline-offset-2 hover:text-brand-700"
          >
            セキュアチャットの製品サイトへ
            <span aria-hidden>→</span>
          </a>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.5 }}
          className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_20px_50px_-28px_rgba(15,23,42,0.3)]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/lp/securechat.png"
            alt="セキュアチャットの会話画面。プライベートモデルが社内資料を解説している様子"
            className="block h-auto w-full"
          />
        </motion.div>
      </div>
    </section>
  )
}
