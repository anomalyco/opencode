const DEFAULT_ORIGINS = ["http://localhost", "http://127.0.0.1", "https://localhost", "https://127.0.0.1"]
const OPAQUE_ORIGIN = ["null"]

type SessionUI = {
  tabs?: unknown
  buttons?: unknown
}

export type PluginWebTab = {
  id: string
  tab: string
  title: string
  src: string
  origins: string[]
  permissions: {
    file: {
      read: string[]
      write: string[]
    }
  }
}

export type PluginWebButton = {
  id: string
  label: string
  tab: string
}

const asRecord = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  return value as Record<string, unknown>
}

const asList = (value: unknown) => (Array.isArray(value) ? value : [])

const asText = (value: unknown) => {
  if (typeof value !== "string") return ""
  return value.trim()
}

const toList = (value: unknown) => asList(value).map(asText).filter(Boolean)

const normalizeOrigin = (value: string) => {
  if (!value) return ""
  if (value === "*") return "*"
  if (value === "null") return "null"
  try {
    const url = new URL(value)
    if (url.protocol === "app:") return "null"
    if (url.protocol !== "http:" && url.protocol !== "https:") return ""
    return url.origin
  } catch {
    return ""
  }
}

const normalizeOrigins = (value: unknown, fallback: string[]) => {
  const list = toList(value).map(normalizeOrigin).filter(Boolean)
  if (list.length) return Array.from(new Set(list))
  return fallback
}

const normalizeScopes = (value: unknown) =>
  toList(value)
    .map((item) => item.replace(/\\/g, "/").replace(/^\.\//, ""))
    .filter(Boolean)

const sessionUI = (config: unknown): SessionUI => {
  const root = asRecord(config)
  const ui = asRecord(root?.ui)
  const session = asRecord(ui?.session)
  return {
    tabs: session?.tabs,
    buttons: session?.buttons,
  }
}

export function resolveSessionPluginUI(
  config: unknown,
  directory: string,
  baseUrl?: string,
): {
  tabs: PluginWebTab[]
  buttons: PluginWebButton[]
} {
  const ui = sessionUI(config)

  const tabs = asList(ui.tabs)
    .map((item) => {
      const row = asRecord(item)
      const id = asText(row?.id)
      const title = asText(row?.title)
      const src = asText(row?.src)
      if (!id || !title || !src) return
      try {
        const url = new URL(src, baseUrl)
        if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "app:") return
        if (!url.searchParams.has("directory") && directory) {
          url.searchParams.set("directory", directory)
        }
        const fallback = url.protocol === "app:" ? OPAQUE_ORIGIN : DEFAULT_ORIGINS
        const permissions = asRecord(row?.permissions)
        const file = asRecord(permissions?.file)
        return {
          id,
          tab: `web:${id}`,
          title,
          src: url.toString(),
          origins: normalizeOrigins(row?.origins, fallback),
          permissions: {
            file: {
              read: normalizeScopes(file?.read),
              write: normalizeScopes(file?.write),
            },
          },
        } satisfies PluginWebTab
      } catch {
        return
      }
    })
    .filter((item): item is PluginWebTab => Boolean(item))
    .filter((item, index, list) => list.findIndex((row) => row.id === item.id) === index)

  const tabSet = new Set(tabs.map((tab) => tab.id))

  const buttons = asList(ui.buttons)
    .map((item) => {
      const row = asRecord(item)
      const id = asText(row?.id)
      const label = asText(row?.label)
      const tab = asText(row?.tab).replace(/^web:/, "")
      if (!id || !label || !tab || !tabSet.has(tab)) return
      return {
        id,
        label,
        tab: `web:${tab}`,
      } satisfies PluginWebButton
    })
    .filter((item): item is PluginWebButton => Boolean(item))
    .filter((item, index, list) => list.findIndex((row) => row.id === item.id) === index)

  return { tabs, buttons }
}
