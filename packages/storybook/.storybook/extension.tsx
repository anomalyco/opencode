import { createResource, onCleanup, type JSX } from "solid-js"
import { pluralCategory } from "@opencode/ui/context/i18n"
import { useLanguage } from "@/runtime/i18n/language"
import {
  ExtensionContext,
  type Appearance,
  type Build,
  type Catalog,
  type Context,
  type Definition,
  type Keybinds,
  type Locale,
  type Messages,
  type Params,
  type Router,
  type Servers,
  type Workspaces,
} from "../../gui-extensions/src/sdk"

const definitions = import.meta.glob<Definition>(
  ["../../gui-extensions/src/*/index.ts", "!../../gui-extensions/src/sdk/index.ts"],
  { eager: true, import: "default" },
)
const styles = import.meta.glob<string>("../../gui-extensions/src/*/*.css", {
  eager: true,
  query: "?inline",
  import: "default",
})

/**
 * Renders a story from `gui-extensions/src/<id>/` the way the host renders that extension's contributions: inside its
 * extension context and with its stylesheets. The extension's setup does not run; stories render its components.
 */
export function ExtensionStory(props: { file: unknown; children: JSX.Element }) {
  const id = typeof props.file === "string" ? props.file.match(/gui-extensions\/src\/([^/]+)\//)?.[1] : undefined
  const definition = id ? definitions[`../../gui-extensions/src/${id}/index.ts`] : undefined
  if (!definition) return props.children
  Object.entries(styles)
    .filter(([file]) => file.startsWith(`../../gui-extensions/src/${definition.id}/`))
    .forEach(([, css]) => {
      const sheet = document.createElement("style")
      sheet.textContent = css
      document.head.append(sheet)
      onCleanup(() => sheet.remove())
    })
  // Storybook renders a story only during the first synchronous render, so the context cannot wait for the async
  // extension host. It follows the host's rules: the extension's catalog first, then the app's shared keys.
  return <ExtensionContext.Provider value={createStoryContext(definition)}>{props.children}</ExtensionContext.Provider>
}

function createStoryContext(definition: Definition) {
  const language = useLanguage()
  const [catalog] = createResource(language.locale, (locale) => loadMessages(definition.i18n, locale), {
    initialValue: definition.i18n?.en ?? {},
  })
  const apis = createStoryHostApis("web")
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  const unavailable = (name: string) => () => {
    throw new Error(`${name} is unavailable in extension stories`)
  }
  const context = {
    id: definition.id,
    signal: controller.signal,
    add: unavailable("ctx.add"),
    list: () => [],
    provide: unavailable("ctx.provide"),
    ...Object.fromEntries(Object.entries(apis).map(([name, create]) => [name, create()])),
    // Stories render on the web, outside any route.
    desktop: undefined,
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
  ;["layout", "sessions", "storage", "system", "dialogs", "links", "embeds", "preferences"].forEach((name) =>
    Object.defineProperty(context, name, { get: unavailable(`ctx.${name}`) }),
  )
  return context as unknown as Context
}

/** The host's build, locale, appearance, router, keybind, server and workspace APIs for a story, by context property. */
export function createStoryHostApis(platform: Build["platform"]) {
  const language = useLanguage()
  const build: Build = { version: "", channel: "dev", platform, packaged: false }
  const locale: Locale = { locale: language.intl, direction: language.direction, setDirection: language.setDirection }
  const appearance: Appearance = { font: () => "var(--font-family-mono)" }
  const router: Router = { routing: () => false, path: () => "/" }
  const keybinds: Keybinds = { keybind: () => [], keys: () => [], matches: () => false }
  const servers: Servers = { list: () => [] }
  const workspaces: Workspaces = { on: () => () => {} }
  return {
    build: () => build,
    locale: () => locale,
    appearance: () => appearance,
    router: () => router,
    keybinds: () => keybinds,
    servers: () => servers,
    workspaces: () => workspaces,
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
