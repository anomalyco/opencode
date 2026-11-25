// Type-level contract of `Plugin.define`, checked by `bun typecheck`. Nothing imports this file. Each `@ts-expect-error`
// fails the typecheck if its line stops being an error.

import { Schema } from "effect"
import { Command, Contract, Ipc, Plugin, Store, TitlebarItem, type IconName } from "./index.js"

const Notes = Contract.define<{ count(): number }, "acme.notes">("acme.notes")

const Pinger = Ipc.define({ id: "acme", methods: { ping: { output: Schema.String } } })

export const plugin = Plugin.define({
  stores: { prefs: Store.global(Schema.Struct({ on: Schema.Boolean }), { on: true }) },
  icons: { logo: "<svg viewBox='0 0 16 16'><circle cx='8' cy='8' r='6' stroke='currentColor'/></svg>" },
  setup(ctx) {
    ctx.provide(Notes, { count: () => 1 })
    ctx.add(Command, () => ({ id: "open", title: String(ctx.stores.prefs.value.on), run() {} }))
    ctx.add(TitlebarItem, () => ({ id: "sync", label: "Sync", icon: ctx.icons.logo }))
    // @ts-expect-error only a declared icon has a name
    ctx.add(TitlebarItem, () => ({ id: "sync", label: "Sync", icon: ctx.icons.missing }))
    void ctx.main(Pinger).ping()

    return () => {}
  },
  main(ctx) {
    ctx.provide(Pinger, { ping: () => "pong" })
  },
})

// Split across files: declare once, type each setup from the declarations, then define the plugin with them.
const declared = Plugin.define({
  stores: { count: Store.global(Schema.Struct({ n: Schema.Number }), { n: 0 }) },
  icons: { mark: "<svg viewBox='0 0 16 16'><path d='M3 8h10' stroke='currentColor'/></svg>" },
})

const setup: Plugin.Setup<typeof declared> = (ctx) => {
  ctx.stores.count.set({ n: ctx.stores.count.value.n + 1 })
  ctx.add(TitlebarItem, { id: "count", label: "Count", icon: ctx.icons.mark })
}

// A plugin's icon name comes from `ctx.icons`: a string written by hand names no declared icon.
// @ts-expect-error only `ctx.icons` gives the name of a plugin's icon
export const forged: IconName = "acme:mark"

export const split = Plugin.define({ ...declared, setup })

export const wrongImpl = Plugin.define({
  setup(ctx) {
    // @ts-expect-error the implementation must match the contract
    ctx.provide(Notes, { size: () => 1 })
  },
})

export const asyncWindow = Plugin.define({
  // @ts-expect-error a window setup is synchronous
  async setup() {},
})
