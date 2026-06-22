import type { Metadata } from "next"
import { LpNav } from "@/components/lp/LpNav"
import { LpHero } from "@/components/lp/LpHero"
import { LpCredibility } from "@/components/lp/LpCredibility"
import { LpProduct } from "@/components/lp/LpProduct"
import { LpPain } from "@/components/lp/LpPain"
import { LpProtection } from "@/components/lp/LpProtection"
import { LpHarness } from "@/components/lp/LpHarness"
import { LpComparison } from "@/components/lp/LpComparison"
import { LpSecureChat } from "@/components/lp/LpSecureChat"
import { LpFaq } from "@/components/lp/LpFaq"
import { LpContact } from "@/components/lp/LpContact"
import { LpWaitlistBand } from "@/components/lp/LpWaitlistBand"
import { LpFooter } from "@/components/lp/LpFooter"

const TITLE = "機密コードを外に出さずにAIコーディングを — Acompanyセキュアコード"
const DESCRIPTION =
  "「セキュリティ上、生成AIは使えない」を終わらせる。TEEによる物理隔離と組織ポリシーで、機密ソースコードを守ったままAI開発を解禁します。株式会社Acompanyが開発・運営するConfidential AI Suiteの製品。"

// 広告 (X) 着地専用ページ。検索インデックスには載せず、広告のリンクからのみ
// 到達させる。既存サービスサイト (/) とは別物として申込導線に振り切る。
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
      <LpNav />
      <main className="relative">
        <LpHero />
        <LpCredibility />
        <LpProduct />
        <LpWaitlistBand />
        <LpPain />
        <LpWaitlistBand />
        <LpProtection />
        <LpWaitlistBand />
        <LpHarness />
        <LpWaitlistBand />
        <LpComparison />
        <LpWaitlistBand />
        <LpSecureChat />
        <LpWaitlistBand />
        <LpFaq />
        <LpContact />
      </main>
      <LpFooter />
    </>
  )
}
