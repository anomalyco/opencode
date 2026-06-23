"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { LpEmailForm } from "./LpEmailForm"

// 申込導線セクション。主役はウェイトリスト登録（メール1項目）。詳しい商談を
// 希望する人向けの多項目フォームは <details> で折りたたみ、副次的に残す。
//
// 問い合わせの送信先・フィールド名・送信方式は既存 CTA と同じ（Pardot Form
// Handler は urlencoded のみ・CORS 返らないため no-cors）。

const PARDOT_ENDPOINT = "https://go.acompany.tech/l/1079873/2026-05-21/2sz5dn"
const PRIVACY_POLICY_URL = "https://www.acompany.tech/privacy-policy"
const HANKEN = '"Hanken Grotesk", sans-serif'

type Status = "idle" | "submitting" | "success" | "error"

function isFilled(fd: FormData) {
  const trim = (k: string) => (fd.get(k)?.toString() ?? "").trim()
  const email = trim("email")
  return (
    !!trim("company") &&
    !!trim("last_name") &&
    !!fd.get("privacypolicy") &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  )
}

export function LpContact() {
  const [status, setStatus] = useState<Status>("idle")
  const [err, setErr] = useState(false)
  const detailsRef = useRef<HTMLDetailsElement>(null)

  // #apply（ヒーロー / ナビの「お問い合わせ」「導入を相談する」）で着地したら
  // 折りたたみを自動展開する。閉じたまま飛ぶと中身が見えず迷子になるため。
  useEffect(() => {
    const openIfTargeted = () => {
      if (window.location.hash === "#apply" && detailsRef.current) {
        detailsRef.current.open = true
      }
    }
    openIfTargeted()
    window.addEventListener("hashchange", openIfTargeted)
    return () => window.removeEventListener("hashchange", openIfTargeted)
  }, [])

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (status === "submitting") return
    const form = e.currentTarget
    const fd = new FormData(form)

    if ((fd.get("corporate_website")?.toString() ?? "").trim()) {
      setStatus("success")
      return
    }
    if (!isFilled(fd)) {
      setErr(true)
      return
    }
    setErr(false)
    setStatus("submitting")

    const params = new URLSearchParams()
    for (const [k, v] of fd.entries()) if (typeof v === "string") params.append(k, v)

    try {
      await fetch(PARDOT_ENDPOINT, { method: "POST", mode: "no-cors", body: params })
      setStatus("success")
      form.reset()
    } catch {
      setStatus("error")
    }
  }

  return (
    <section
      className="text-white"
      style={{ background: "linear-gradient(135deg,#153658 0%,#0a3a5e 55%,#0d68a0 145%)" }}
    >
      <div className="mx-auto max-w-[760px] px-5 py-20 md:px-8 md:py-24">
        {/* 主役: ウェイトリスト登録 */}
        <div id="waitlist" className="scroll-mt-20 text-center">
          <div
            className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-[#67d4f3]"
            style={{ fontFamily: HANKEN }}
          >
            <span className="size-1.5 rounded-full bg-[#41c5f9]" />
            Join the Waitlist
          </div>
          <h2 className="mt-5 text-balance text-[2rem] font-bold leading-[1.28] tracking-tight md:text-[2.6rem]">
            β版ウェイトリストに登録する
          </h2>
          <p className="mt-5 text-[15px] leading-[1.9] text-[#bcd0e8] md:text-base">
            登録はメールアドレスだけ。準備が整い次第、優先的に β 版アクセスと
            <wbr />
            資料のご案内をお送りします。
          </p>
        </div>

        <div className="mx-auto mt-8 max-w-[540px] rounded-2xl bg-white p-6 text-slate-900 shadow-[0_24px_60px_rgba(13,40,80,.35)] md:p-7">
          <LpEmailForm
            size="lg"
            align="center"
            cta="ウェイトリストに登録"
            successText="✓ ウェイトリストに登録しました。準備が整い次第、優先的にご案内をお送りします。"
          />
        </div>

        {/* 副次: 詳しい導入相談（折りたたみ） */}
        <details ref={detailsRef} id="apply" className="group mt-12 scroll-mt-20 border-t border-white/15 pt-8">
          <summary className="mx-auto flex w-fit cursor-pointer list-none items-center gap-2 text-[14.5px] font-medium text-[#bcd0e8] transition-colors hover:text-white [&::-webkit-details-marker]:hidden">
            <span>導入相談・お見積り・資料請求をご希望の方はこちら</span>
            <svg
              className="size-4 transition-transform group-open:rotate-180"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M5 7.5 10 12.5 15 7.5" />
            </svg>
          </summary>

          {status === "success" ? (
            <div className="mt-7 rounded-2xl border border-emerald-400/35 bg-emerald-400/10 p-8 text-center">
              <div className="text-xl font-bold text-white">送信ありがとうございます。</div>
              <p className="mt-2.5 text-[14.5px] leading-relaxed text-emerald-200">
                担当より、ご記入いただいた連絡先にてご連絡いたします。
              </p>
            </div>
          ) : (
            <form
              noValidate
              onSubmit={onSubmit}
              className="mt-7 rounded-2xl bg-white p-6 text-slate-900 shadow-[0_24px_60px_rgba(13,40,80,.35)] md:p-8"
            >
              <p className="mb-5 text-[13.5px] leading-relaxed text-slate-600">
                自社での適用可否やご不明点など、担当よりご案内します。お気軽にご相談ください。
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="会社名" name="company" required placeholder="例) 株式会社Acompany" />
                <Field label="部署名" name="department" placeholder="例) 情報システム部" />
                <Field label="役職名" name="Post" placeholder="例) 部長" />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="姓" name="last_name" required placeholder="田中" />
                  <Field label="名" name="first_name" placeholder="太郎" />
                </div>
                <Field label="メールアドレス" name="email" type="email" required placeholder="info@example.com" />
                <Field label="電話番号" name="phone" type="tel" placeholder="03-1234-5678" />
              </div>

              {/* honeypot */}
              <div aria-hidden className="pointer-events-none absolute -left-[9999px] h-0 w-0 overflow-hidden opacity-0">
                <input type="text" name="corporate_website" tabIndex={-1} autoComplete="off" />
              </div>

              <label className="mt-5 flex items-start gap-2.5 text-[13.5px] text-slate-700">
                <input
                  type="checkbox"
                  name="privacypolicy"
                  value="プライバシーポリシーに同意する"
                  className="mt-0.5 size-4 accent-brand-600"
                />
                <span>
                  <a href={PRIVACY_POLICY_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-600 underline underline-offset-2">
                    プライバシーポリシー
                  </a>
                  に同意する <span className="text-red-600">*</span>
                </span>
              </label>

              {err && (
                <p className="mt-3 text-[12.5px] text-red-600">
                  会社名・姓・メールアドレスのご入力と、プライバシーポリシーへの同意が必要です。
                </p>
              )}
              {status === "error" && (
                <p className="mt-3 text-[12.5px] text-red-600">送信に失敗しました。時間をおいて再度お試しください。</p>
              )}

              <div className="mt-6 text-center">
                <button
                  type="submit"
                  disabled={status === "submitting"}
                  className="rounded-[10px] bg-brand-600 px-10 py-3.5 text-[15.5px] font-bold text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
                >
                  {status === "submitting" ? "送信中..." : "この内容で問い合わせる"}
                </button>
                <p className="mt-3 text-xs text-slate-400">* は必須項目</p>
              </div>
            </form>
          )}
        </details>
      </div>
    </section>
  )
}

function Field({
  label,
  name,
  type = "text",
  required = false,
  placeholder,
}: {
  label: string
  name: string
  type?: "text" | "email" | "tel"
  required?: boolean
  placeholder?: string
}) {
  return (
    <div className="flex flex-col">
      <label htmlFor={`f-${name}`} className="mb-1.5 text-xs font-bold text-slate-700">
        {label}
        {required && <span className="ml-1 text-red-600">*</span>}
      </label>
      <input
        id={`f-${name}`}
        name={name}
        type={type}
        placeholder={placeholder}
        className="rounded-[9px] border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 outline-none focus:border-brand-600"
      />
    </div>
  )
}
