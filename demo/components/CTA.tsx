"use client"

import { motion } from "framer-motion"
import { useState, type FormEvent } from "react"
import { Wordmark } from "./Wordmark"

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

export function CTA() {
  const [status, setStatus] = useState<Status>("idle")
  const [errors, setErrors] = useState<FieldErrors>({})

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (status === "submitting") return

    const form = e.currentTarget
    const fd = new FormData(form)

    // honeypot: bot が埋めたら成功扱いで黙って捨てる
    if ((fd.get("corporate_website")?.toString() ?? "").trim()) {
      setStatus("success")
      return
    }

    const validation = validate(fd)
    setErrors(validation)
    if (Object.keys(validation).length > 0) {
      // 最初のエラーフィールドへフォーカス
      const firstKey = Object.keys(validation)[0]
      const el = form.querySelector<HTMLInputElement>(`[name="${firstKey}"]`)
      el?.focus()
      return
    }

    setStatus("submitting")

    // Pardot Form Handler は application/x-www-form-urlencoded しか
    // 受け付けない (multipart/form-data で投げると 400 "form handler page
    // with no content" を返す)。FormData を fetch.body にそのまま渡すと
    // browser が自動で multipart にしてしまうので、URLSearchParams に
    // 詰め替えて urlencoded で送る。
    //
    // CORS は返らない想定で no-cors。レスポンスは読めないが、fetch 自体が
    // 落ちた場合のみ error 扱いにする。
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
    <section
      id="apply"
      className="relative isolate w-full overflow-hidden"
    >
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_30%,rgba(252,83,58,0.15)_0%,transparent_55%)]"
      />
      <div className="mx-auto flex max-w-4xl flex-col items-center px-6 py-32 text-center md:py-40">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.8 }}
          className="w-full max-w-lg"
        >
          <Wordmark />
        </motion.div>

        <motion.h2
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7, delay: 0.15 }}
          className="mt-8 text-balance text-3xl font-medium leading-tight md:text-4xl"
        >
          Acompanyセキュアコード について
          <br className="md:hidden" />
          詳しく聞いてみる。
        </motion.h2>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, delay: 0.3 }}
          className="mt-4 max-w-xl text-sm leading-relaxed text-sc-text-mid"
        >
          下記フォームよりお問い合わせください。担当よりご連絡いたします。
        </motion.p>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, delay: 0.4 }}
          className="mt-3 max-w-xl text-xs leading-relaxed text-sc-text-dim"
        >
          Acompanyセキュアコードは Confidential AI Suite の一角を担う製品です。
          社内向けチャット製品の{" "}
          <a
            href="https://service.acompany.tech/cas/secure-chat/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sc-text-mid underline underline-offset-2 hover:text-sc-ember"
          >
            Acompanyセキュアチャット
          </a>
          {" "}もぜひご覧ください。
        </motion.p>

        {status === "success" ? (
          <SuccessPanel onReset={() => setStatus("idle")} />
        ) : (
          <motion.form
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.45 }}
            className="mt-10 w-full max-w-2xl text-left"
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
                placeholder="例) マーケティング部"
                maxLength={100}
              />
              <Field
                label="役職名"
                name="Post"
                placeholder="例) 部長"
                maxLength={100}
              />
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

            {/* Honeypot — sighted users には見えない */}
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

            <label className="mt-6 flex items-start gap-3 text-sm text-sc-text-mid">
              <input
                type="checkbox"
                name="privacypolicy"
                value="プライバシーポリシーに同意する"
                className="mt-1 size-4 cursor-pointer accent-sc-ember"
              />
              <span>
                <a
                  href={PRIVACY_POLICY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sc-text underline underline-offset-2 hover:text-sc-ember"
                >
                  プライバシーポリシー
                </a>
                に同意する
                <span className="ml-1 text-sc-ember">*</span>
              </span>
            </label>
            {errors.privacypolicy && (
              <p className="mt-1 ml-7 text-xs text-sc-ember">
                {errors.privacypolicy}
              </p>
            )}

            <div className="mt-8 flex flex-col items-center gap-3">
              <button
                type="submit"
                disabled={status === "submitting"}
                className="rounded-md border border-sc-ember bg-sc-ember/15 px-8 py-3 font-mono text-sm text-sc-text transition-colors hover:bg-sc-ember/25 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {status === "submitting" ? "送信中..." : "送信する →"}
              </button>
              {status === "error" && (
                <p className="text-xs text-sc-ember">
                  送信に失敗しました。ネットワーク状況をご確認の上、再度お試しください。
                </p>
              )}
              <p className="mt-2 text-[10px] text-sc-text-dim">
                * 必須項目
              </p>
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
  const id = `field-${name}`
  return (
    <div className="flex flex-col">
      <label
        htmlFor={id}
        className="mb-1 flex items-center gap-2 text-xs font-medium text-sc-text-mid"
      >
        {label}
        {required && <span className="text-sc-ember">*</span>}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        placeholder={placeholder}
        maxLength={maxLength}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`rounded-md border bg-sc-bg-soft px-3 py-2 text-sm text-sc-text placeholder:text-sc-text-dim/60 outline-none transition-colors focus:border-sc-ember focus:ring-1 focus:ring-sc-ember/40 ${error ? "border-sc-ember" : "border-sc-border"}`}
      />
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs text-sc-ember">
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
      transition={{ duration: 0.5 }}
      className="mt-12 w-full max-w-xl rounded-lg border border-sc-mint/40 bg-sc-mint/[0.04] px-6 py-8 text-left"
    >
      <div className="flex items-center gap-3">
        <span className="inline-block size-2 rounded-full bg-sc-mint" />
        <span className="font-mono text-xs tracking-[0.2em] text-sc-mint">
          SUBMITTED
        </span>
      </div>
      <h3 className="mt-3 text-xl font-medium text-sc-text">
        送信ありがとうございます。
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-sc-text-mid">
        担当より、ご記入いただいた連絡先にてご連絡いたします。
        しばらく経っても返信がない場合は、お手数ですが
        <a
          href="https://www.acompany.tech/contact"
          target="_blank"
          rel="noopener noreferrer"
          className="mx-1 text-sc-ember underline underline-offset-2"
        >
          お問い合わせフォーム
        </a>
        からご連絡ください。
      </p>
      <button
        type="button"
        onClick={onReset}
        className="mt-6 rounded-md border border-sc-border px-4 py-2 font-mono text-xs text-sc-text-mid transition-colors hover:border-sc-text-mid hover:text-sc-text"
      >
        ← 入力画面に戻る
      </button>
    </motion.div>
  )
}
