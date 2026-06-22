// LP専用フッター（白基調）。運営主体を明示して信頼を担保する。会社名・
// 姉妹製品・問い合わせ導線に加え、最下部に各種ポリシーへのリンクを置く。
//
// ポリシーリンク群 (Privacy / Cookie / Security) は、アクセス解析に
// Microsoft Clarity を利用しており Microsoft へデータを送信している旨を
// 明示するために必要（cookie-policy に Clarity の記載がある）。本家 demo
// 側は PR #305 で Footer.tsx に追加されるため、こちらの LP にも同じ趣旨で
// 掲載する。

const POLICIES = [
  { label: "Privacy Policy", href: "https://www.acompany.tech/privacy-policy" },
  { label: "Cookie Policy", href: "https://www.acompany.tech/cookie-policy" },
  { label: "Security Policy", href: "https://www.acompany.tech/security-policy" },
] as const

export function LpFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-12 md:flex-row md:items-start md:justify-between">
        <div className="max-w-md">
          <div className="text-sm font-bold tracking-tight text-slate-900">
            Acompanyセキュアコード
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            機密ソースコードを隔離された秘密計算環境の中だけで処理できる、機密プロジェクト向けのAIコーディング支援。
            <a
              href="https://www.acompany.tech/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-600 underline underline-offset-2 hover:text-blue-700"
            >
              株式会社Acompany
            </a>
            が開発・運営するConfidential AI Suiteの製品です。
          </p>
        </div>
        <nav className="grid gap-2.5 text-sm text-slate-600">
          <a href="#how" className="hover:text-blue-700">
            解決のしくみ
          </a>
          <a href="#apply" className="hover:text-blue-700">
            お問い合わせ
          </a>
          <a
            href="https://service.acompany.tech/cas/secure-chat/"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-blue-700"
          >
            姉妹製品 セキュアチャット
          </a>
        </nav>
      </div>

      <div className="border-t border-slate-100">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-6 py-6 text-[11px] text-slate-400 md:flex-row md:items-center md:justify-between">
          <p className="max-w-2xl">
            ※ 本ページに記載の一部の機能は現在も鋭意開発中です。提供時期・仕様は変わる可能性があり、現時点でご利用いただける範囲はお問い合わせください。
          </p>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-6">
            <nav className="flex flex-wrap gap-x-4 gap-y-1">
              {POLICIES.map((p) => (
                <a
                  key={p.label}
                  href={p.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-blue-700"
                >
                  {p.label}
                  <ExternalLinkIcon />
                </a>
              ))}
            </nav>
            <p className="shrink-0">© Acompany Co., Ltd.</p>
          </div>
        </div>
      </div>
    </footer>
  )
}

function ExternalLinkIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="ml-1 inline-block h-[0.65em] w-[0.65em] -translate-y-[1px]"
    >
      <path d="M3.5 8.5L8.5 3.5" />
      <path d="M4 3.5h4.5V8" />
    </svg>
  )
}
