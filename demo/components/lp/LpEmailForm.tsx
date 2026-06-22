"use client"

import { useState, type FormEvent } from "react"

// 軽量メール登録フォーム（白基調）。
//
// 既存components/Waitlist.tsxと同じNotionバックエンド (Cloud Runの
// waitlist-api) に投げるが、X広告着地用の新LP (/lp) からの流入だと
// 判別できるようsourceを分けている。摩擦を最小化するため入力はメール
// アドレス1項目のみ。詳細な商談は下部の問い合わせフォーム側で受ける。
const ENDPOINT = process.env.NEXT_PUBLIC_WAITLIST_ENDPOINT ?? ""
const PRIVACY_POLICY_URL = "https://www.acompany.tech/privacy-policy"

function detectSource(): string {
  if (typeof window === "undefined") return "lp-ad"
  const utm = new URLSearchParams(window.location.search).get("utm_source")
  return utm ? `lp-ad (${utm})` : "lp-ad"
}

type Status = "idle" | "submitting" | "success" | "error"

type Props = {
  cta?: string
  successText?: string
  align?: "center" | "start"
}

export function LpEmailForm({
  cta = "資料・β版の案内を受け取る",
  successText = "登録ありがとうございます。担当より、β版と資料のご案内を順次お送りします。",
  align = "start",
}: Props) {
  const [status, setStatus] = useState<Status>("idle")
  const [emailError, setEmailError] = useState("")

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (status === "submitting") return

    const form = e.currentTarget
    const fd = new FormData(form)

    if ((fd.get("website")?.toString() ?? "").trim()) {
      setStatus("success")
      return
    }

    const email = (fd.get("email")?.toString() ?? "").trim()
    if (!email) {
      setEmailError("メールアドレスを入力してください。")
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError("メールアドレスの形式が正しくありません。")
      return
    }
    setEmailError("")

    if (!ENDPOINT) {
      setStatus("error")
      return
    }

    setStatus("submitting")

    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          website: (fd.get("website")?.toString() ?? "").trim(),
          source: detectSource(),
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean }
      if (res.ok && data.ok) {
        setStatus("success")
        form.reset()
      } else {
        setStatus("error")
      }
    } catch {
      setStatus("error")
    }
  }

  if (status === "success") {
    return (
      <div
        className={`flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 ${align === "center" ? "mx-auto max-w-lg" : ""}`}
      >
        <svg
          className="mt-0.5 size-5 shrink-0 text-emerald-600"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden
        >
          <path
            fillRule="evenodd"
            d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.1 3.1 6.8-6.8a1 1 0 0 1 1.4 0Z"
            clipRule="evenodd"
          />
        </svg>
        <p className="text-sm leading-relaxed text-emerald-800">{successText}</p>
      </div>
    )
  }

  return (
    <form
      className={align === "center" ? "mx-auto w-full max-w-lg" : "w-full max-w-lg"}
      noValidate
      onSubmit={onSubmit}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -left-[9999px] h-0 w-0 overflow-hidden opacity-0"
      >
        <input type="text" name="website" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="flex flex-col gap-2.5 sm:flex-row">
        <input
          type="email"
          name="email"
          required
          inputMode="email"
          autoComplete="email"
          placeholder="your@company.com"
          aria-label="メールアドレス"
          aria-invalid={!!emailError}
          className={`w-full flex-1 rounded-lg border bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 ${emailError ? "border-red-400" : "border-slate-300"}`}
        />
        <button
          type="submit"
          disabled={status === "submitting"}
          className="rounded-lg bg-brand-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60 sm:shrink-0"
        >
          {status === "submitting" ? "送信中..." : cta}
        </button>
      </div>

      {emailError && <p className="mt-2 text-xs text-red-600">{emailError}</p>}
      {status === "error" && (
        <p className="mt-2 text-xs text-red-600">
          送信に失敗しました。時間をおいて再度お試しください。
        </p>
      )}
      <p
        className={`mt-3 text-xs leading-relaxed text-slate-500 ${align === "center" ? "text-center" : ""}`}
      >
        ご記入いただいた情報は株式会社Acompanyが取得し、
        <a
          href={PRIVACY_POLICY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-slate-600 underline underline-offset-2 hover:text-brand-600"
        >
          プライバシーポリシー
        </a>
        に基づいて取り扱います。
      </p>
    </form>
  )
}
