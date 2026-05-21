import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "Acompany Secure Code — チュートリアル / デモ",
  description:
    "機密ソースコードを漏洩させずに AI コーディング支援を実現する、Acompany Secure Code のスクロールテリングデモ。",
  // 検索エンジンに乗せたいデモではないので noindex
  robots: { index: false, follow: false },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ja">
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
