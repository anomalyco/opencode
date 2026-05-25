import type { Metadata } from "next"
import "./globals.css"

const SITE_URL = "https://acompany-develop.github.io/securecode/demo/"
const SITE_TITLE = "Acompanyセキュアコード — 機密ソースコードを守る AI コーディング"
const SITE_DESCRIPTION =
  "機密ソースコードを社外に出さずに AI コーディング支援を導入できる、Acompany の Confidential AI Suite 第 2 弾製品。Trusted Execution Environment (TEE) と運用ハーネスで、組織の機密を守ったまま生成 AI を活用できる。"

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    siteName: "Acompanyセキュアコード",
    locale: "ja_JP",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
}

// suppressHydrationWarning: ブラウザの privacy 拡張 (Google Analytics
// Opt-out 等) が <html> に `data-google-analytics-opt-out` 等の属性を
// ハイドレート前に差し込んでくる。Next.js 公式の推奨対処
// (https://nextjs.org/docs/messages/react-hydration-error#solution-2)
// で、属性ミスマッチを <html> 要素 1 段だけに限定して抑える。
export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&family=Noto+Sans+JP:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  )
}
