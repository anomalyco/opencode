// 新デザインのフッター（ダークネイビー）。ロゴ・製品/会社ナビ・ポリシー・注記。
//
// ポリシーリンク群 (Privacy / Cookie / Security) は、アクセス解析に
// Microsoft Clarity を利用しているため必要（cookie-policy に Clarity の記載）。

const PRODUCT_LINKS = [
  { href: "#product", label: "プロダクト" },
  { href: "#tee", label: "TEE 保護" },
  { href: "#harness", label: "ハーネス" },
  { href: "#compare", label: "比較" },
  { href: "#faq", label: "FAQ" },
] as const

const COMPANY_LINKS: { href: string; label: string; external?: boolean }[] = [
  { href: "#waitlist", label: "ウェイトリストに登録" },
  { href: "#apply", label: "お問い合わせ" },
  { href: "https://www.acompany.tech/", label: "株式会社 Acompany", external: true },
]

const POLICIES = [
  { label: "Privacy Policy", href: "https://www.acompany.tech/privacy-policy" },
  { label: "Cookie Policy", href: "https://www.acompany.tech/cookie-policy" },
  { label: "Security Policy", href: "https://www.acompany.tech/security-policy" },
] as const

export function LpFooter() {
  return (
    <footer className="bg-[#0b1220] text-slate-300">
      <div className="mx-auto grid max-w-[1180px] gap-10 px-5 py-14 md:grid-cols-[1.4fr_1fr_1fr] md:px-8">
        <div className="max-w-sm">
          <div className="text-lg font-bold tracking-tight text-white">
            Acompany セキュアコード
          </div>
          <p className="mt-4 text-xs leading-relaxed text-slate-400">
            機密ソースコードを Confidential Computing 環境の中だけで処理する、機密プロジェクト
            向けの AI コーディング支援。
          </p>
          <a
            href="#apply"
            className="mt-5 inline-flex items-center rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
          >
            お問い合わせ →
          </a>
        </div>

        <nav>
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Product</div>
          <ul className="mt-3 flex flex-col gap-2.5 text-sm">
            {PRODUCT_LINKS.map((l) => (
              <li key={l.href}>
                <a href={l.href} className="text-slate-300 hover:text-white">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <nav>
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Company</div>
          <ul className="mt-3 flex flex-col gap-2.5 text-sm">
            {COMPANY_LINKS.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  target={l.external ? "_blank" : undefined}
                  rel={l.external ? "noopener noreferrer" : undefined}
                  className="text-slate-300 hover:text-white"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-6 text-[11px] text-slate-400 md:flex-row md:items-center md:justify-between md:px-6">
          <p className="max-w-2xl">
            ※ 記載の一部機能は開発中であり、提供時期および仕様は変更となる可能性があります。
          </p>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-6">
            <nav className="flex flex-wrap gap-x-4 gap-y-1">
              {POLICIES.map((p) => (
                <a
                  key={p.label}
                  href={p.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white"
                >
                  {p.label}
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
