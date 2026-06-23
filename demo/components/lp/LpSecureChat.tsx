"use client"

import { motion } from "framer-motion"

// 姉妹製品セキュアチャットの紹介。SecureCode 本体とは別製品であることが視覚的に
// 伝わるよう、専用アイブロウ + 外枠カード + アクセント色強調 + 縦区切り +
// ブラウザ chrome を備える。Claude Design (SecureCode.dc.html) の構造に合わせている。

const HANKEN = '"Hanken Grotesk", sans-serif'

const FEATURES = ["Confidential Computing 環境で推論", "社内ドキュメント連携", "管理者統制"] as const

export function LpSecureChat() {
  return (
    <section id="chat" className="relative w-full border-t border-slate-100 bg-white">
      <div className="mx-auto max-w-[1000px] px-5 py-20 md:px-8 md:py-24">
        <div
          className="text-center text-[12px] font-bold uppercase tracking-[0.14em] text-slate-400"
          style={{ fontFamily: HANKEN }}
        >
          別プロダクトのご案内
        </div>
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5 }}
          className="mt-5 flex flex-wrap items-stretch overflow-hidden rounded-2xl border border-slate-200 bg-[#fafbfc]"
        >
          {/* left copy */}
          <div className="flex min-w-[300px] flex-1 flex-col justify-center px-7 py-8 md:px-9 md:py-10">
            <span className="inline-flex items-center gap-1.5 self-start rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11.5px] font-bold text-slate-600">
              姉妹製品 ／ セキュアコードとは別の製品です
            </span>
            <h2 className="mt-4 text-balance text-2xl font-bold leading-[1.5] tracking-tight text-slate-900">
              コードはセキュアコード。
              <br className="hidden sm:inline" />
              チャットは<span className="text-brand-600">セキュアチャット</span>。
            </h2>
            <p className="mt-3 text-sm leading-[1.85] text-slate-500">
              セキュアコードのチャット版。同じ TEE 基盤で動く、コーディング以外の業務向け製品です。社外秘の資料も顧客データも、平文を外に出さずに AI へ相談できます。
            </p>
            <ul className="mt-5 flex flex-wrap gap-2">
              {FEATURES.map((f) => (
                <li
                  key={f}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12.5px] font-medium text-slate-700"
                >
                  {f}
                </li>
              ))}
            </ul>
            <a
              href="https://service.acompany.tech/cas/secure-chat/"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-flex items-center gap-1.5 self-start text-sm font-semibold text-brand-600 hover:text-brand-700"
            >
              セキュアチャットの製品サイトへ
              <span aria-hidden>→</span>
            </a>
          </div>

          {/* right chat screenshot with browser chrome */}
          <div className="flex min-w-[300px] flex-1 items-center justify-center border-slate-100 p-6 md:border-l">
            <div className="w-full max-w-[360px] overflow-hidden rounded-[11px] border border-slate-200 bg-white shadow-[0_8px_24px_rgba(13,40,80,0.10)]">
              <div className="flex items-center gap-1.5 border-b border-slate-100 bg-[#f7f8fb] px-3 py-2.5">
                <span className="size-[9px] rounded-full bg-[#ef4d54]" />
                <span className="size-[9px] rounded-full bg-[#f5bf4f]" />
                <span className="size-[9px] rounded-full bg-[#5ac05a]" />
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/lp/securechat.png"
                alt="セキュアチャットの会話画面。プライベートモデルが社内資料を解説している様子"
                className="block h-auto w-full"
              />
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
