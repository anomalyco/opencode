"use client"

import { motion } from "framer-motion"
import { useState, type FormEvent } from "react"

// Google Form 連携。差し替え時は環境変数で上書き可能。
const FORM_ACTION =
  process.env.NEXT_PUBLIC_WAITLIST_FORM_ACTION ??
  "https://docs.google.com/forms/d/e/1FAIpQLSdXMBUCBBh4d7tVq252EpsKvuAc8lAtX9v14JyOGba-PQkUtQ/formResponse"
const EMAIL_ENTRY =
  process.env.NEXT_PUBLIC_WAITLIST_FORM_EMAIL_ENTRY ?? "entry.504571965"

type Status = "idle" | "submitting" | "success" | "error"
type Variant = "full" | "inline"

type WaitlistProps = {
  variant?: Variant
  id?: string
}

function useWaitlistForm() {
  const [status, setStatus] = useState<Status>("idle")
  const [emailError, setEmailError] = useState("")

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (status === "submitting") return

    const form = e.currentTarget
    const fd = new FormData(form)

    // honeypot
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

    if (!FORM_ACTION || !EMAIL_ENTRY) {
      setStatus("error")
      return
    }

    setStatus("submitting")

    const params = new URLSearchParams()
    params.append(EMAIL_ENTRY, email)

    try {
      await fetch(FORM_ACTION, {
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

  return { status, emailError, onSubmit }
}

export function Waitlist({ variant = "full", id }: WaitlistProps) {
  const { status, emailError, onSubmit } = useWaitlistForm()

  if (variant === "inline") {
    return (
      <section
        id={id}
        className="relative isolate w-full border-y border-sc-border/40 bg-sc-bg-soft/30"
      >
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-5 px-6 py-10 md:flex-row md:justify-between md:py-12">
          <div className="text-center md:text-left">
            <span className="text-stamp">EARLY ACCESS</span>
            <p className="mt-2 text-sm leading-relaxed text-sc-text-mid md:text-base">
              気になったら、いま登録。β 版の案内をメールでお届けします。
            </p>
          </div>

          {status === "success" ? (
            <div className="flex items-center gap-3 rounded-lg border border-sc-mint/40 bg-sc-mint/[0.04] px-5 py-3">
              <span className="inline-block size-2 rounded-full bg-sc-mint" />
              <p className="font-mono text-sm text-sc-mint">登録ありがとうございます！</p>
            </div>
          ) : (
            <form
              className="w-full max-w-md"
              noValidate
              onSubmit={onSubmit}
            >
              {/* honeypot */}
              <div
                aria-hidden
                className="pointer-events-none absolute -left-[9999px] h-0 w-0 overflow-hidden opacity-0"
              >
                <input type="text" name="website" tabIndex={-1} autoComplete="off" />
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="email"
                  name="email"
                  required
                  placeholder="your@email.com"
                  aria-label="メールアドレス"
                  aria-invalid={!!emailError}
                  className={`w-full flex-1 rounded-md border bg-sc-bg-soft px-4 py-2.5 text-sm text-sc-text placeholder:text-sc-text-dim/60 outline-none transition-colors focus:border-sc-ember focus:ring-1 focus:ring-sc-ember/40 ${emailError ? "border-sc-ember" : "border-sc-border"}`}
                />
                <button
                  type="submit"
                  disabled={status === "submitting"}
                  className="rounded-md border border-sc-ember bg-sc-ember/15 px-5 py-2.5 font-mono text-sm text-sc-text transition-colors hover:bg-sc-ember/25 disabled:cursor-not-allowed disabled:opacity-60 sm:shrink-0"
                >
                  {status === "submitting" ? "送信中..." : "登録 →"}
                </button>
              </div>
              {emailError && (
                <p className="mt-2 text-left text-xs text-sc-ember">{emailError}</p>
              )}
              {status === "error" && (
                <p className="mt-2 text-xs text-sc-ember">
                  送信に失敗しました。時間をおいて再度お試しください。
                </p>
              )}
            </form>
          )}
        </div>
      </section>
    )
  }

  return (
    <section
      id={id}
      className="relative isolate w-full overflow-hidden border-y border-sc-border/40"
    >
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_50%,rgba(3,76,255,0.06)_0%,transparent_65%)]"
      />
      <div className="mx-auto flex max-w-4xl flex-col items-center px-6 py-20 text-center md:py-28">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.7 }}
        >
          <span className="text-stamp">EARLY ACCESS</span>
          <h2 className="mt-4 text-balance text-2xl font-medium leading-tight md:text-3xl">
            β版テスターに申し込む
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-sc-text-mid">
            メールアドレスを登録するだけ。
            <br />
            優先的に β 版アクセスの案内をお送りします。
          </p>
        </motion.div>

        {status === "success" ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mt-8 flex items-center gap-3 rounded-lg border border-sc-mint/40 bg-sc-mint/[0.04] px-6 py-4"
          >
            <span className="inline-block size-2 rounded-full bg-sc-mint" />
            <p className="font-mono text-sm text-sc-mint">
              登録しました。β 版の案内をお待ちください！
            </p>
          </motion.div>
        ) : (
          <motion.form
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mt-8 w-full max-w-md"
            noValidate
            onSubmit={onSubmit}
          >
            {/* honeypot */}
            <div
              aria-hidden
              className="pointer-events-none absolute -left-[9999px] h-0 w-0 overflow-hidden opacity-0"
            >
              <input type="text" name="website" tabIndex={-1} autoComplete="off" />
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="flex-1">
                <input
                  type="email"
                  name="email"
                  required
                  placeholder="your@email.com"
                  aria-label="メールアドレス"
                  aria-invalid={!!emailError}
                  className={`w-full rounded-md border bg-sc-bg-soft px-4 py-3 text-sm text-sc-text placeholder:text-sc-text-dim/60 outline-none transition-colors focus:border-sc-ember focus:ring-1 focus:ring-sc-ember/40 ${emailError ? "border-sc-ember" : "border-sc-border"}`}
                />
              </div>
              <button
                type="submit"
                disabled={status === "submitting"}
                className="rounded-md border border-sc-ember bg-sc-ember/15 px-6 py-3 font-mono text-sm text-sc-text transition-colors hover:bg-sc-ember/25 disabled:cursor-not-allowed disabled:opacity-60 sm:shrink-0"
              >
                {status === "submitting" ? "送信中..." : "登録する →"}
              </button>
            </div>

            {emailError && (
              <p className="mt-2 text-left text-xs text-sc-ember">{emailError}</p>
            )}
            {status === "error" && (
              <p className="mt-2 text-xs text-sc-ember">
                送信に失敗しました。時間をおいて再度お試しください。
              </p>
            )}
          </motion.form>
        )}
      </div>
    </section>
  )
}
