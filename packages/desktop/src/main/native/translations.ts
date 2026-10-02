import {
  DESKTOP_NATIVE_ENGLISH,
  DESKTOP_NATIVE_KEYS,
  DESKTOP_NATIVE_LOCALE_TAGS,
  formatDesktopNativeMessage,
  type DesktopNativeBundle,
  type DesktopNativeKey,
} from "@opencode/app/i18n/desktop-native"

let bundle: DesktopNativeBundle = { locale: "en", messages: { ...DESKTOP_NATIVE_ENGLISH } }
const listeners = new Set<() => void>()

export function setNativeTranslations(next: DesktopNativeBundle) {
  if (
    next.locale === bundle.locale &&
    DESKTOP_NATIVE_KEYS.every((key) => next.messages[key] === bundle.messages[key])
  ) {
    return false
  }
  bundle = next
  listeners.forEach((listener) => listener())
  return true
}

export function nativeT(key: DesktopNativeKey, params?: Record<string, string | number>) {
  return formatDesktopNativeMessage(bundle.messages[key], params)
}

/** The app locale the renderer last pushed. GUI extension catalogs resolve against it. */
export function nativeLocale() {
  return bundle.locale
}

/** Runs after the renderer pushes a different bundle, such as when the user switches language. */
export function onNativeTranslations(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** A shared app message for a key that is only known at runtime, such as one an extension asks for. */
export function nativeMessage(key: string) {
  const messages: Readonly<Record<string, string>> = bundle.messages
  return Object.hasOwn(messages, key) ? messages[key] : undefined
}

export function nativePluralCategory(count: number) {
  return new Intl.PluralRules(DESKTOP_NATIVE_LOCALE_TAGS[bundle.locale]).select(count)
}

// Same placeholder syntax the renderer's language API resolves, so one catalog serves both hosts.
export function formatNativeTemplate(template: string, params?: Readonly<Record<string, string | number | boolean>>) {
  if (!params) return template
  return template.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (match, key: string) =>
    Object.hasOwn(params, key) ? String(params[key]) : match,
  )
}
