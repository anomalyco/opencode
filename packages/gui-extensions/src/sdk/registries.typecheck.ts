// Type-level contract of the registries, checked by `bun typecheck`. Nothing imports this file. Each `@ts-expect-error`
// fails the typecheck if its line stops being an error.
import { Extension, MenuItem, TitlebarItem, type Setup } from "./index"

const Fixture = Extension.define({ id: "fixture" })

export const menus: Setup<typeof Fixture> = (ctx) => {
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
