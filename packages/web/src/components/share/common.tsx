import { createContext, createSignal, useContext } from "solid-js"
import type { JSX } from "solid-js/jsx-runtime"
import { makeResizeObserver } from "@solid-primitives/resize-observer"

export type ShareMessages = { locale: string } & Record<string, string>

const shareContext = createContext<ShareMessages>()

export function ShareI18nProvider(props: { messages: ShareMessages; children: JSX.Element }) {
  return <shareContext.Provider value={props.messages}>{props.children}</shareContext.Provider>
}

export function useShareMessages() {
  const value = useContext(shareContext)
  if (value) {
    return value
  }
  throw new Error("ShareI18nProvider is required")
}

export function normalizeLocale(locale: string) {
  return locale === "root" ? "en" : locale
}

export function formatNumber(value: number, locale: string) {
  return new Intl.NumberFormat(normalizeLocale(locale)).format(value)
}

export function formatCurrency(value: number, locale: string) {
  return new Intl.NumberFormat(normalizeLocale(locale), {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatCount(value: number, locale: string, singular: string, plural: string) {
  const unit = value === 1 ? singular : plural
  return `${formatNumber(value, locale)} ${unit}`
}

export function createOverflow() {
  const [overflow, setOverflow] = createSignal(false)
  return {
    get status() {
      return overflow()
    },
    ref(el: HTMLElement) {
      const sync = () => {
        setOverflow(el.scrollHeight > el.clientHeight + 1)
      }

      const obs = makeResizeObserver(sync)
      obs.observe(el)

      sync()
    },
  }
}

export function formatDuration(ms: number, locale: string): string {
  const normalized = normalizeLocale(locale)
  const ONE_SECOND = 1000
  const ONE_MINUTE = 60 * ONE_SECOND

  if (ms >= ONE_MINUTE) {
    return new Intl.NumberFormat(normalized, {
      style: "unit",
      unit: "minute",
      unitDisplay: "narrow",
      maximumFractionDigits: 0,
    }).format(Math.floor(ms / ONE_MINUTE))
  }

  if (ms >= ONE_SECOND) {
    return new Intl.NumberFormat(normalized, {
      style: "unit",
      unit: "second",
      unitDisplay: "narrow",
      maximumFractionDigits: 0,
    }).format(Math.floor(ms / ONE_SECOND))
  }

  return new Intl.NumberFormat(normalized, {
    style: "unit",
    unit: "millisecond",
    unitDisplay: "narrow",
    maximumFractionDigits: 0,
  }).format(ms)
}
