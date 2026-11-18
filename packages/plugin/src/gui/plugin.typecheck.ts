// Type-level contract of `Plugin.define`, checked by `bun typecheck`. Nothing imports this file. Each `@ts-expect-error`
// fails the typecheck if its line stops being an error.

import { Schema } from "effect"
import { Command, Contract, Ipc, Plugin, Store } from "./index.js"

const Notes = Contract.define<{ count(): number }, "acme.notes">("acme.notes")

const Pinger = Ipc.define({ id: "acme", methods: { ping: { output: Schema.String } } })

export const plugin = Plugin.define({
  stores: { prefs: Store.global(Schema.Struct({ on: Schema.Boolean }), { on: true }) },
  setup(ctx) {
    ctx.provide(Notes, { count: () => 1 })
    ctx.add(Command, () => ({ id: "open", title: String(ctx.stores.prefs.value.on), run() {} }))
    void ctx.main(Pinger).ping()

    return () => {}
  },
  main(ctx) {
    ctx.provide(Pinger, { ping: () => "pong" })
  },
})

// Split across files: declare once, type each setup from the declarations, then define the plugin with them.
const declared = Plugin.define({ stores: { count: Store.global(Schema.Struct({ n: Schema.Number }), { n: 0 }) } })

const setup: Plugin.Setup<typeof declared> = (ctx) => {
  ctx.stores.count.set({ n: ctx.stores.count.value.n + 1 })
}

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
