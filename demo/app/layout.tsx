import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "Acompanyセキュアコード — チュートリアル / デモ",
  description:
    "機密ソースコードを漏洩させずに AI コーディング支援を実現する、Acompanyセキュアコードのスクロールテリングデモ。",
  // 検索エンジンに乗せたいデモではないので noindex
  robots: { index: false, follow: false },
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
