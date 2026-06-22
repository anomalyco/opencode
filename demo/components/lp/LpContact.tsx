"use client"

import { motion } from "framer-motion"
import { useState, type FormEvent } from "react"

// 詳細問い合わせ（商談）フォーム。白基調。
//
// 送信先・フィールド名・送信方式は既存components/CTA.tsxと完全に揃えて
// いる（Pardot Form Handlerはurlencodedのみ受け付け、CORSは返らない
// ためno-cors）。見た目だけLPのクリーンコーポレートに合わせた版。

const PARDOT_ENDPOINT = "https://go.acompany.tech/l/1079873/2026-05-21/2sz5dn"
const PRIVACY_POLICY_URL = "https://www.acompany.tech/privacy-policy"

type Status = "idle" | "submitting" | "success" | "error"

type FieldErrors = Partial<{
  company: string
  last_name: string
  email: string
  phone: string
  privacypolicy: string
}>

function validate(fd: FormData): FieldErrors {
  const errors: FieldErrors = {}
  const trim = (k: string) => (fd.get(k)?.toString() ?? "").trim()

  if (!trim("company")) errors.company = "会社名を入力してください。"
  if (!trim("last_name")) errors.last_name = "姓を入力してください。"
  if (!fd.get("privacypolicy")) {
    errors.privacypolicy = "プライバシーポリシーへの同意が必要です。"
  }

  const email = trim("email")
  if (!email) {
    errors.email = "メールアドレスを入力してください。"
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "メールアドレスの形式が正しくありません。"
  }

  const phone = trim("phone")
  if (phone && !/^[0-9+\-() ]{10,20}$/.test(phone)) {
    errors.phone = "電話番号の形式が正しくありません。"
  }

  return errors
}

export function LpContact() {
  const [status, setStatus] = useState<Status>("idle")
  const [errors, setErrors] = useState<FieldErrors>({})

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (status === "submitting") return

    const form = e.currentTarget
    const fd = new FormData(form)

    if ((fd.get("corporate_website")?.toString() ?? "").trim()) {
      setStatus("success")
      return
    }

    const validation = validate(fd)
    setErrors(validation)
    if (Object.keys(validation).length > 0) {
      const firstKey = Object.keys(validation)[0]
      const el = form.querySelector<HTMLInputElement>(`[name="${firstKey}"]`)
      el?.focus()
      return
    }

    setStatus("submitting")

    const params = new URLSearchParams()
    for (const [key, value] of fd.entries()) {
      if (typeof value === "string") params.append(key, value)
    }

    try {
      await fetch(PARDOT_ENDPOINT, {
        method: "POST",
        mode: "no-cors",
        body: params,
      })
      setStatus("success")
      form.reset()
    } catch {
      setStatus("error")
    }
  }

  return (
    <section id="apply" className="relative w-full scroll-mt-20 bg-slate-50">
      <div className="mx-auto max-w-2xl px-6 py-20 md:py-28">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5 }}
          className="text-center"
        >
          <span className="text-sm font-semibold text-blue-700">お問い合わせ</span>
          <h2 className="mt-3 text-balance text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">
            導入相談・お見積り・資料請求
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-slate-600">
            自社での適用可否やご不明点など、担当よりご案内します。お気軽にご相談ください。
          </p>
        </motion.div>

        {status === "success" ? (
          <SuccessPanel onReset={() => setStatus("idle")} />
        ) : (
          <motion.form
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="mt-10 rounded-2xl border border-slate-200 bg-white p-6 text-left shadow-sm md:p-8"
            noValidate
            onSubmit={onSubmit}
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field
                label="会社名"
                name="company"
                required
                placeholder="例) 株式会社Acompany"
                maxLength={100}
                error={errors.company}
              />
              <Field
                label="部署名"
                name="department"
                placeholder="例) 情報システム部"
                maxLength={100}
              />
              <Field label="役職名" name="Post" placeholder="例) 部長" maxLength={100} />
              <div className="grid grid-cols-2 gap-4">
                <Field
                  label="姓"
                  name="last_name"
                  required
                  placeholder="例) 田中"
                  maxLength={30}
                  error={errors.last_name}
                />
                <Field
                  label="名"
                  name="first_name"
                  placeholder="例) 太郎"
                  maxLength={30}
                />
              </div>
              <Field
                label="メールアドレス"
                name="email"
                type="email"
                required
                placeholder="例) info@example.com"
                maxLength={100}
                error={errors.email}
              />
              <Field
                label="電話番号"
                name="phone"
                type="tel"
                placeholder="例) 03-1234-5678"
                maxLength={20}
                error={errors.phone}
              />
            </div>

            {/* Honeypot — sighted usersには見えない */}
            <div
              aria-hidden
              className="pointer-events-none absolute -left-[9999px] h-0 w-0 overflow-hidden opacity-0"
            >
              <label>
                Corporate website
                <input
                  type="text"
                  name="corporate_website"
                  tabIndex={-1}
                  autoComplete="off"
                  maxLength={40}
                />
              </label>
            </div>

            <label className="mt-6 flex items-start gap-3 text-sm text-slate-700">
              <input
                type="checkbox"
                name="privacypolicy"
                value="プライバシーポリシーに同意する"
                className="mt-0.5 size-4 cursor-pointer accent-blue-700"
              />
              <span>
                <a
                  href={PRIVACY_POLICY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-blue-700 underline underline-offset-2 hover:text-blue-900"
                >
                  プライバシーポリシー
                </a>
                に同意する
                <span className="ml-1 text-red-500">*</span>
              </span>
            </label>
            {errors.privacypolicy && (
              <p className="mt-1 ml-7 text-xs text-red-600">{errors.privacypolicy}</p>
            )}

            <div className="mt-8 flex flex-col items-center gap-3">
              <button
                type="submit"
                disabled={status === "submitting"}
                className="w-full rounded-lg bg-blue-700 px-8 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                {status === "submitting" ? "送信中..." : "この内容で問い合わせる"}
              </button>
              {status === "error" && (
                <p className="text-xs text-red-600">
                  送信に失敗しました。ネットワーク状況をご確認の上、再度お試しください。
                </p>
              )}
              <p className="text-xs text-slate-400">* は必須項目</p>
            </div>
          </motion.form>
        )}
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
  maxLength,
  error,
}: {
  label: string
  name: string
  type?: "text" | "email" | "tel"
  required?: boolean
  placeholder?: string
  maxLength?: number
  error?: string
}) {
  const id = `lp-field-${name}`
  return (
    <div className="flex flex-col">
      <label htmlFor={id} className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
        {label}
        {required && <span className="text-red-500">*</span>}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        placeholder={placeholder}
        maxLength={maxLength}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`rounded-lg border bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 ${error ? "border-red-400" : "border-slate-300"}`}
      />
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}

function SuccessPanel({ onReset }: { onReset: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="mt-10 rounded-2xl border border-emerald-200 bg-emerald-50 px-6 py-8 text-left"
    >
      <div className="flex items-center gap-2">
        <span className="inline-block size-2 rounded-full bg-emerald-500" />
        <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
          Submitted
        </span>
      </div>
      <h3 className="mt-3 text-xl font-bold text-slate-900">送信ありがとうございます。</h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        担当より、ご記入いただいた連絡先にてご連絡いたします。しばらく経っても返信がない
        場合は、お手数ですが
        <a
          href="https://www.acompany.tech/contact"
          target="_blank"
          rel="noopener noreferrer"
          className="mx-1 font-medium text-blue-700 underline underline-offset-2"
        >
          お問い合わせフォーム
        </a>
        からご連絡ください。
      </p>
      <button
        type="button"
        onClick={onReset}
        className="mt-6 rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-600 transition hover:border-slate-400 hover:text-slate-900"
      >
        ← 入力画面に戻る
      </button>
    </motion.div>
  )
}
