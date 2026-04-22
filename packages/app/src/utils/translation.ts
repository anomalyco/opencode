import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"
import { formatServerError } from "./server-errors"

type Translator = (key: string, vars?: Record<string, string | number | boolean>) => string

export type TranslateError = {
  message: string
  detail: string
}

function configLocale(input: unknown) {
  if (typeof input !== "object" || !input) return
  const locale = (input as { locale?: unknown }).locale
  if (typeof locale !== "string") return
  const next = locale.trim().toLowerCase()
  if (!next) return
  return next
}

export function issue(input: {
  err: unknown
  t: Translator
  tag: "memory" | "bug-report"
  locale: string
}): TranslateError {
  const detail = formatServerError(input.err, input.t, input.t("common.requestFailed"))
  return {
    message: input.t("common.requestFailed"),
    detail,
  }
}

export function align(input: {
  sdk: OpencodeClient
  directory?: string
  locale: string
}) {
  const locale = input.locale.trim().toLowerCase()
  if (!locale) return Promise.resolve()
  return input.sdk.config
    .get({ directory: input.directory })
    .then((result) => configLocale(result.data))
    .catch(() => undefined)
    .then((current) => {
      if (current === locale) return
      return input.sdk.config
        .update({
          directory: input.directory,
          config: { locale } as never,
        })
        .then(() => undefined)
    })
}
