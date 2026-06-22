"use client"

import { useState } from "react"

// SecureCode.dc.html のヘッダーを忠実に再現。上部に7色のレインボーバー、
// ロゴ＋ナビ＋2つのCTA（ウェイトリスト=ghost / お問い合わせ=primary）。
// 源は非レスポンシブなので、モバイルではナビをハンバーガーに畳む。

const LINKS: { href: string; label: string; external?: boolean }[] = [
  { href: "#product", label: "プロダクト" },
  { href: "#problem", label: "課題" },
  { href: "#tee", label: "TEE 保護" },
  { href: "#harness", label: "ハーネス" },
  { href: "#compare", label: "比較" },
  {
    href: "https://service.acompany.tech/cas/secure-chat/",
    label: "セキュアチャット",
    external: true,
  },
]

const RAINBOW =
  "linear-gradient(90deg,#153658 0 14.3%,#114f7c 14.3% 28.6%,#0d68a0 28.6% 42.9%,#389bd9 42.9% 57.2%,#41c5f9 57.2% 71.5%,#b4f5e9 71.5% 85.8%,#e8fcf9 85.8% 100%)"

export function LpNav() {
  const [open, setOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 border-b border-slate-100 bg-white/[0.86] backdrop-blur-md backdrop-saturate-150">
      <div className="h-1 w-full" style={{ background: RAINBOW }} />
      <div className="mx-auto flex max-w-[1180px] items-center justify-between gap-4 px-5 py-3.5 md:px-8">
        <a href="#top" className="flex shrink-0 items-center" aria-label="Acompany セキュアコード">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/lp/logo.png" alt="Acompany セキュアコード" className="h-9 w-auto md:h-[46px]" />
        </a>

        <div className="flex items-center gap-5">
          <nav className="hidden items-center gap-[18px] text-[13px] font-medium text-slate-600 lg:flex">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                target={l.external ? "_blank" : undefined}
                rel={l.external ? "noopener noreferrer" : undefined}
                className="whitespace-nowrap transition-colors hover:text-slate-900"
              >
                {l.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <a
              href="#waitlist"
              className="hidden whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-[12.5px] font-semibold text-slate-800 transition-colors hover:border-brand-600 hover:bg-brand-50 hover:text-brand-600 sm:inline-flex"
            >
              ウェイトリストに登録
            </a>
            <a
              href="#apply"
              className="whitespace-nowrap rounded-lg bg-brand-600 px-3.5 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-brand-700"
            >
              お問い合わせ
            </a>
            <button
              type="button"
              aria-label="メニュー"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className="inline-flex size-9 items-center justify-center rounded-lg border border-slate-200 text-slate-700 lg:hidden"
            >
              <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
              </svg>
            </button>
          </div>
        </div>
      </div>

      {open && (
        <nav className="border-t border-slate-200 bg-white px-5 py-3 lg:hidden">
          <ul className="flex flex-col">
            {LINKS.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  target={l.external ? "_blank" : undefined}
                  rel={l.external ? "noopener noreferrer" : undefined}
                  onClick={() => setOpen(false)}
                  className="block py-2 text-sm text-slate-700"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  )
}
