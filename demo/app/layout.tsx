import type { Metadata } from "next"
import Script from "next/script"
import { GoogleTagManager } from "@next/third-parties/google"
import "./globals.css"

// GTM container ID は CI から NEXT_PUBLIC_GTM_ID で差し込む (例:
// "GTM-XXXXXXX")。未設定の dev 環境では <GoogleTagManager> を
// レンダリングしないので、ローカル動作確認で本番 GTM を汚さない。
const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID

// Microsoft Clarity プロジェクト ID は CI から NEXT_PUBLIC_CLARITY_ID で差し込む。
// 未設定の dev 環境ではスクリプトをレンダリングしない。
const CLARITY_ID = process.env.NEXT_PUBLIC_CLARITY_ID

const SITE_URL = "https://securecode.acompany.tech/"
const SITE_TITLE = "Acompanyセキュアコード — 機密ソースコードを守る AI コーディング"
const SITE_DESCRIPTION =
  "機密ソースコードを社外に出さずに AI コーディング支援を導入できる、Acompany の Confidential AI Suite 第 2 弾製品。Trusted Execution Environment (TEE) と運用ハーネスで、組織の機密を守ったまま生成 AI を活用できる。"

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  verification: {
    google: "r2ZU-6G2iamBmyNO38yrcI12t6dokaWliTu0CnaksWo",
  },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    siteName: "Acompanyセキュアコード",
    locale: "ja_JP",
    type: "website",
    images: [
      {
        url: "/keyvisual/wide.png",
        width: 1920,
        height: 1080,
        alt: SITE_TITLE,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ["/keyvisual/wide.png"],
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
      {GTM_ID && <GoogleTagManager gtmId={GTM_ID} />}
      <body className="min-h-screen antialiased">
        {children}
        {CLARITY_ID && (
          <Script id="clarity-script" strategy="afterInteractive">
            {`(function(c,l,a,r,i,t,y){
                c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
                t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
                y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
            })(window, document, "clarity", "script", "${CLARITY_ID}");`}
          </Script>
        )}
      </body>
    </html>
  )
}
