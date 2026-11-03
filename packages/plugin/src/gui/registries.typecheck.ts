// Type-level contract of the registries, checked by `bun typecheck`. Nothing imports this file. Each `@ts-expect-error`
// fails the typecheck if its line stops being an error.
import { Plugin } from "./index.js"
import { MenuItem, Theme, TitlebarItem } from "./index.js"

const Fixture = Plugin.define({})

export const menus: Plugin.Setup<typeof Fixture> = (ctx) => {
  // Each menu takes its own fields.
  ctx.add(MenuItem, { menu: "session.panel", id: "open", title: "Open", icon: "plus", keybind: "file.open", run() {} })
  ctx.add(MenuItem, { menu: "server.add", id: "add", title: "Add", order: 1, run() {} })
  ctx.add(MenuItem, {
    menu: "server.row",
    id: "connect",
    title: "Connect",
    when: (server) => server.startsWith("ssh:"),
    enabled: () => true,
    run: (server) => void server.length,
  })
  ctx.add(MenuItem, (): MenuItem | undefined =>
    Math.random() > 0.5 ? { menu: "server.add", id: "add", title: "Add", run() {} } : undefined,
  )

  // @ts-expect-error the Add server menu shows no icon
  ctx.add(MenuItem, { menu: "server.add", id: "add", title: "Add", icon: "plus", run() {} })
  // @ts-expect-error the + menu lists every item, so it takes no `when`
  ctx.add(MenuItem, { menu: "session.panel", id: "open", title: "Open", when: () => true, run() {} })
  // @ts-expect-error a server row shows no keybind
  ctx.add(MenuItem, { menu: "server.row", id: "connect", title: "Connect", keybind: "file.open", run() {} })
  // @ts-expect-error only a server row's `run` receives a server key
  ctx.add(MenuItem, { menu: "server.add", id: "add", title: "Add", run: (server: string) => void server })

  // A pill without `run` only shows its label.
  ctx.add(TitlebarItem, { id: "status", label: "Ready" })
}

const palette = {
  neutral: "#2e3440",
  ink: "#e5e9f0",
  primary: "#88c0d0",
  success: "#a3be8c",
  warning: "#d08770",
  error: "#bf616a",
  info: "#81a1c1",
}

const seeds = { ...palette, interactive: "#88c0d0", diffAdd: "#a3be8c", diffDelete: "#bf616a" }

// Typed like an imported theme file: JSON modules widen every color to `string`.
const file = {
  $schema: "https://opencode.ai/desktop-theme.json",
  name: "Nord",
  id: "nord",
  light: { palette, overrides: { "syntax-keyword": "var(--text-strong)" } },
  dark: { seeds },
}

export const themes: Plugin.Setup<typeof Fixture> = (ctx) => {
  ctx.add(Theme, file)

  // @ts-expect-error a variant starts from seeds or a palette, not both
  ctx.add(Theme, { ...file, light: { palette, seeds } })
}
