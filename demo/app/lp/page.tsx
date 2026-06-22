import type { Metadata } from "next"
import { LpHero } from "@/components/lp/LpHero"
import { LpCredibility } from "@/components/lp/LpCredibility"
import { LpPain } from "@/components/lp/LpPain"
import { LpSolution } from "@/components/lp/LpSolution"
import { LpMidCta } from "@/components/lp/LpMidCta"
import { LpComparison } from "@/components/lp/LpComparison"
import { LpFaq } from "@/components/lp/LpFaq"
import { LpContact } from "@/components/lp/LpContact"
import { LpStickyCta } from "@/components/lp/LpStickyCta"
import { LpFooter } from "@/components/lp/LpFooter"

const TITLE = "機密コードを守りながらAI開発を始める — Acompanyセキュアコード"
const DESCRIPTION =
  "機密ソースコードを社外に露出させずに、AIコーディング支援を導入できます。隔離された秘密計算環境（TEE）の中だけでコードを処理し、提供元のAcompanyにも、インフラ事業者・モデル提供者にも中身を見せません。株式会社Acompanyが開発・運営するConfidential AI Suiteの製品。"

// 広告 (X) 着地専用ページ。検索インデックスには載せず、広告のリンク
// からのみ到達させる。既存サービスサイト (/) とは別物として、申込み
// (β版メール登録 / 商談問い合わせ) への到達率に振り切った構成にする。
export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  robots: { index: false, follow: true },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "https://securecode.acompany.tech/lp/",
    siteName: "Acompanyセキュアコード",
    locale: "ja_JP",
    type: "website",
    images: [{ url: "/keyvisual/wide.png", width: 1920, height: 1080, alt: TITLE }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/keyvisual/wide.png"],
  },
}

export default function LpPage() {
  return (
    <>
      {/* 最小ヘッダー: 離脱を誘う遷移リンクは置かず、ブランドと申込導線だけ */}
      <header className="fixed inset-x-0 top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <a href="#top" className="flex items-center gap-2 text-sm font-bold tracking-tight text-slate-900">
            <span className="inline-block size-2 rounded-full bg-blue-600" />
            Acompanyセキュアコード
          </a>
          <a
            href="#apply"
            className="rounded-lg border border-slate-300 px-4 py-1.5 text-xs font-medium text-slate-700 transition hover:border-blue-400 hover:text-blue-700"
          >
            お問い合わせ
          </a>
        </div>
      </header>

      <main className="relative pb-24">
        <LpHero />
        <LpCredibility />
        <LpPain />
        <LpSolution />
        <LpMidCta />
        <LpComparison />
        <LpFaq />
        <LpContact />
      </main>

      <LpFooter />
      <LpStickyCta />
    </>
  )
}
