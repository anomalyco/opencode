"use client"

import { useState, type FormEvent } from "react"

// SecureCode.dc.html の WaitlistBand（セクション間に繰り返し挿入される
// 軽量なメール登録帯）。accent-soft 背景・1行レイアウト。送信は既存の
// Notion waitlist-api（NEXT_PUBLIC_WAITLIST_ENDPOINT）へ。

const ENDPOINT = process.env.NEXT_PUBLIC_WAITLIST_ENDPOINT ?? ""
const PRIVACY_POLICY_URL = "https://www.acompany.tech/privacy-policy"
const HANKEN = '"Hanken Grotesk", sans-serif'

function detectSource(): string {
  if (typeof window === "undefined") return "lp-ad"
  const utm = new URLSearchParams(window.location.search).get("utm_source")
  return utm ? `lp-ad (${utm})` : "lp-ad"
}

export function LpWaitlistBand() {
  const [email, setEmail] = useState("")
  const [website, setWebsite] = useState("") // honeypot
  const [done, setDone] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    // honeypot: bot が埋めたら成功扱いで黙って捨てる（demo Waitlist と同様）
    if (website.trim()) {
      setDone(true)
      return
    }
    const v = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return
    if (!ENDPOINT) {
      setDone(true)
      return
    }
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: v, website, source: detectSource() }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean }
      if (res.ok && data.ok) setDone(true)
    } catch {
      /* noop */
    }
  }

  return (
    <div className="border-y border-brand-100 bg-brand-50">
      <div className="mx-auto flex max-w-[980px] flex-col items-center gap-2.5 px-5 py-5 md:px-8">
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-2.5">
            <span
              className="inline-flex items-center rounded-full bg-brand-600 px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-white"
              style={{ fontFamily: HANKEN }}
            >
              Waitlist
            </span>
            <span className="text-[15px] font-bold text-slate-900">
              β版ウェイトリストに参加する
            </span>
          </div>

          {done ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700">
              ✓ 登録しました。順次ご案内をお送りします。
            </div>
          ) : (
            <form onSubmit={onSubmit} className="flex gap-2.5">
              {/* honeypot */}
              <input
                type="text"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                aria-hidden
                className="pointer-events-none absolute -left-[9999px] h-0 w-0 overflow-hidden opacity-0"
              />
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                aria-label="メールアドレス"
                className="w-[180px] rounded-lg border border-brand-100 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none focus:border-brand-500 sm:w-[240px]"
              />
              <button
                type="submit"
                className="shrink-0 whitespace-nowrap rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
              >
                登録
              </button>
            </form>
          )}
        </div>
        <p className="text-center text-[12.5px] leading-relaxed text-slate-600">
          ご登録をもって
          <a
            href={PRIVACY_POLICY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-brand-600 underline underline-offset-2 hover:text-brand-700"
          >
            プライバシーポリシー
          </a>
          に同意したものとみなします。
        </p>
      </div>
    </div>
  )
}
