"use client"

import { LpEmailForm } from "./LpEmailForm"
import { LpMediaSlot } from "./LpMediaSlot"

// 広告 (X) のリンク付き画像から着地する、コールド流入向けファーストビュー。
// セキュリティに敏感な意思決定者が「安心して入力できる」ことを最優先に、
// 白基調・余白・落ち着いたブルーで構成する。情報密度を下げるため、しくみの
// 概念図は「解決のしくみ」section に置き、ヒーロー右は製品ビジュアル枠にする。

const TRUST = ["秘密計算環境で隔離", "実行環境を検証", "閲覧すら不可を技術で保証"] as const

export function LpHero() {
  return (
    <section id="top" className="relative isolate w-full overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-gradient-to-b from-slate-50 to-white"
      />

      <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-16 pt-28 md:grid-cols-[1.05fr_0.95fr] md:pb-24 md:pt-36">
        {/* 左: コピー + CTA */}
        <div className="flex flex-col">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
            <span className="size-1.5 rounded-full bg-blue-600" />
            Confidential AI Suite ／ 株式会社Acompany
          </span>

          <h1 className="mt-6 text-balance text-3xl font-bold leading-[1.3] tracking-tight text-slate-900 md:text-[2.75rem]">
            機密コードを守りながら、
            <br className="hidden sm:inline" />
            AI開発を始められる。
          </h1>

          <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-600">
            AIは
            <strong className="font-semibold text-slate-900">隔離された秘密計算環境</strong>
            の中だけで処理するから、コードの中身は誰にも見られません。
          </p>

          <div className="mt-8">
            <LpEmailForm cta="資料・β版の案内を受け取る" />
          </div>

          <ul className="mt-6 flex flex-wrap gap-x-4 gap-y-2">
            {TRUST.map((t) => (
              <li key={t} className="flex items-center gap-1.5 text-xs text-slate-600">
                <svg
                  className="size-4 shrink-0 text-blue-600"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden
                >
                  <path
                    fillRule="evenodd"
                    d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.1 3.1 6.8-6.8a1 1 0 0 1 1.4 0Z"
                    clipRule="evenodd"
                  />
                </svg>
                {t}
              </li>
            ))}
          </ul>
        </div>

        {/* 右: 製品ビジュアル（スクショ/デモ動画）。素材が来たら children に差し込む */}
        <LpMediaSlot label="製品イメージ（準備中）" aspect="video" />
      </div>
    </section>
  )
}
