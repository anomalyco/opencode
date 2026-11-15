import { createResource, onCleanup, type JSX } from "solid-js"
import type { Entry } from "@opencode/plugin/gui/host"
import { pluralCategory } from "@opencode/ui/context/i18n"
import { useTheme } from "@opencode/ui/theme/context"
import { toaster } from "@opencode/ui/toast"
import { useLanguage } from "@/runtime/i18n/language"
import { ui } from "@/runtime/plugin/ui"
import { showToast } from "@/shell/notifications/toast"
import type { BuiltinLocale } from "../../plugin/src/gui/builtin"
import { PluginContext } from "../../plugin/src/gui/internal"
import {
  type App,
  type Appearance,
  type Attention,
  type Catalog,
  type Commands,
  type Context,
  type Keybinds,
  type Messages,
  type Params,
  type Router,
  type Servers,
  type Toasts,
  type Workspaces,
} from "../../plugin/src/gui/index"

const definitions = import.meta.glob<Entry>("../../gui-plugins/src/*/index.ts", { eager: true, import: "default" })
const styles = import.meta.glob<string>("../../gui-plugins/src/*/*.css", {
  eager: true,
  query: "?inline",
  import: "default",
})

/**
 * Renders a story from `gui-plugins/src/<id>/` the way the host renders that plugin's contributions: inside its
 * plugin context and with its stylesheets. The plugin's setup does not run; stories render its components.
 */
export function PluginStory(props: { file: unknown; children: JSX.Element }) {
  const id = typeof props.file === "string" ? props.file.match(/gui-plugins\/src\/([^/]+)\//)?.[1] : undefined
  const definition = id ? definitions[`../../gui-plugins/src/${id}/index.ts`] : undefined
  if (!definition) return props.children
  Object.entries(styles)
    .filter(([file]) => file.startsWith(`../../gui-plugins/src/${id}/`))
    .forEach(([, css]) => {
      const sheet = document.createElement("style")
      sheet.textContent = css
      document.head.append(sheet)
      onCleanup(() => sheet.remove())
    })
  // The frame renders a story in one synchronous pass, so the context cannot wait for the async
  // plugin host. It follows the host's rules: the plugin's catalog first, then the app's shared keys.
  return <PluginContext.Provider value={createStoryContext(id, definition)}>{props.children}</PluginContext.Provider>
}

// Built-ins take their id from their folder, as `compose` keys them.
function createStoryContext(id: string, definition: Entry) {
  const language = useLanguage()
  const [catalog] = createResource(language.locale, (locale) => loadMessages(definition.i18n, locale), {
    initialValue: definition.i18n?.en ?? {},
  })
  const apis = createStoryHostApis("web")
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  const unavailable = (name: string) => () => {
    throw new Error(`${name} is unavailable in plugin stories`)
  }
  const context = {
    id,
    signal: controller.signal,
    add: unavailable("ctx.add"),
    list: () => [],
    provide: unavailable("ctx.provide"),
    ...Object.fromEntries(Object.entries(apis).map(([name, create]) => [name, create()])),
    // Stories render built-ins on the web, outside any route: no plugin options or plugin server client.
    desktop: undefined,
    options: {},
    client: undefined,
    t: (key: string, params?: Params) => {
      const template = catalog.latest[key]
      if (template !== undefined) return resolveTemplate(template, params)
      return language.t(key as Parameters<typeof language.t>[0], params)
    },
    plural: (key: string, count: number, params?: Params) => {
      const current = catalog.latest
      const template = current[`${key}.${pluralCategory(language.intl(), count)}`] ?? current[`${key}.other`]
      if (template !== undefined) return resolveTemplate(template, { ...params, count })
      return language.plural(key as Parameters<typeof language.plural>[0], count, params)
    },
  }
  // The HostApis a story has no stand-in for fail when read.
  ;["layout", "sessions", "screen", "storage", "system", "dialogs", "tabs", "links", "embeds"].forEach((name) =>
    Object.defineProperty(context, name, { get: unavailable(`ctx.${name}`) }),
  )
  return context as unknown as Context
}

/**
 * The host's app, locale, appearance, router, keybind, server, workspace, toast, attention, command and UI APIs for a
 * story, by context property.
 */
export function createStoryHostApis(platform: App["platform"]) {
  const language = useLanguage()
  const app: App = { name: "opencode", version: "", channel: "dev", platform, packaged: false }
  // Built-ins such as the debug bar also override the direction.
  const locale: BuiltinLocale = {
    locale: language.intl,
    direction: language.direction,
    setDirection: language.setDirection,
  }
  const theme = useTheme()
  const appearance: Appearance = { font: () => "var(--font-family-mono)", mode: theme.mode }
  const router: Router = { routing: () => false, path: () => "/" }
  const keybinds: Keybinds = { keybind: () => [], keys: () => [], matches: () => false }
  const servers: Servers = { list: () => [], get: () => undefined }
  const workspaces: Workspaces = { on: () => () => {} }
  // Stories show real toasts; they have no command registry and send no system notifications.
  const toast: Toasts = {
    show: (options) => {
      const id = showToast({
        ...options,
        actions: options.actions?.map((action) => ({ label: action.label, onClick: action.run })),
      })
      return { dismiss: () => void toaster.dismiss(id) }
    },
  }
  const attention: Attention = { notify: async () => ({ notification: false, sound: false }) }
  const commands: Commands = { run: () => false }
  return {
    app: () => app,
    locale: () => locale,
    appearance: () => appearance,
    router: () => router,
    keybinds: () => keybinds,
    servers: () => servers,
    workspaces: () => workspaces,
    toast: () => toast,
    attention: () => attention,
    commands: () => commands,
    // The app's own components, as the host provides them.
    ui: () => ui,
  }
}

async function loadMessages(catalog: Catalog | undefined, locale: string): Promise<Messages> {
  const english = catalog?.en ?? {}
  const source = catalog?.[locale]
  if (!source || locale === "en") return english
  const loaded =
    typeof source === "function"
      ? await source().then(
          (module) => module.default,
          () => ({}),
        )
      : source
  return { ...english, ...loaded }
}

function resolveTemplate(text: string, params?: Params) {
  if (!params) return text
  return text.replace(/{{\s*([^}]+?)\s*}}/g, (_, key: string) => String(params[key] ?? ""))
}
