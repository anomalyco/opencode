// Type-level contract of the setup contexts, checked by `bun typecheck`. Nothing imports this file. Each
// `@ts-expect-error` fails the typecheck if its line stops being an error.
import type { Accessor } from "solid-js"
import { Schema } from "effect"
import {
  bindPlugin,
  Contract,
  Ipc,
  Plugin,
  Store,
  type Cleanup,
  type Desktop,
  type IconName,
  type IpcClient,
  type Live,
  type MountedSession,
  type Panel,
  type PanelProps,
  type PanelTab,
  type SessionScreen,
  type SlotMap,
} from "./index.js"

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

const equal = <A, B>(value: Equal<A, B>) => value

const Tree = Contract.define<{ open(path: string): void }, "fixture.tree">("fixture.tree")

const Pane = Ipc.define({ id: "fixture.pane", methods: { open: { input: Schema.String } } })

const View = Schema.Struct({ open: Schema.Boolean })

const Consumer = Plugin.define({
  stores: { view: Store.global(View, { open: false }), draft: Store.session(View, { open: true }) },
})

// Contracts are read and provided at runtime, typed by their tokens.
export const setup: Plugin.Setup<typeof Consumer> = (ctx) => {
  const tree = ctx.use(Tree)
  equal<typeof tree, Accessor<Live<{ open(path: string): void }>>>(true)
  const pane = ctx.use(Pane)
  equal<typeof pane, Accessor<Live<IpcClient<(typeof Pane)["spec"]>>>>(true)
  ctx.provide(Tree, { open: () => undefined })
  // @ts-expect-error the implementation must match the contract
  ctx.provide(Tree, { close: () => undefined })
  // @ts-expect-error Ipcs are provided by the main entry
  ctx.provide(Pane, { open: () => undefined })
  void ctx.main(Pane).open("https://example.com")
  // @ts-expect-error the input must match the method's schema
  void ctx.main(Pane).open(1)
  equal<typeof ctx.stores.view.value, { readonly open: boolean }>(true)
  equal<ReturnType<typeof ctx.stores.draft>["value"], { readonly open: boolean } | undefined>(true)
  // The desktop API is undefined on the web.
  equal<typeof ctx.desktop, Desktop | undefined>(true)
  // @ts-expect-error no store named missing
  void ctx.stores.missing
  // A session carries its identity and data only; the route-following models belong to the session screen.
  const session = ctx.sessions.current()
  // @ts-expect-error a session has no workspace files: read `ctx.screen.current()?.file`
  void session?.file
  // @ts-expect-error a session has no comments: read `ctx.screen.current()?.comment`
  void session?.comment
  // @ts-expect-error a session has no composer: read `ctx.screen.current()?.composer`
  void session?.composer
  equal<ReturnType<typeof ctx.screen.current>, SessionScreen | undefined>(true)
  // @ts-expect-error the screen has no duplicate session accessor
  void ctx.screen.current()?.session
  ctx.stores.view.update((draft) => {
    draft.open = true
  })
  ctx.stores.view.set({ open: false })
  // @ts-expect-error update only mutates; replacement values go through set
  ctx.stores.view.update(() => ({ open: true }))
  // @ts-expect-error replacement values match the schema
  ctx.stores.view.set({ open: "wrong" })
}

equal<ReturnType<Plugin.Setup<typeof Consumer>>, Cleanup | void>(true)

// @ts-expect-error an async window setup returns a Promise, not nothing or a cleanup
export const asyncSetup: Plugin.Setup<typeof Consumer> = async () => {}

// @ts-expect-error a window setup cannot return an object either
export const returningSetup: Plugin.Setup<typeof Consumer> = () => ({ open: true })

equal<ReturnType<Plugin.MainSetup>, Cleanup | void | Promise<Cleanup | void>>(true)

// Main provides any Ipc at compile time; the host refuses one outside the plugin's id at runtime.
export const mainProvider: Plugin.MainSetup = (ctx) => {
  ctx.provide(Pane, { open: () => undefined })
  // @ts-expect-error the implementation must match the Ipc's methods
  ctx.provide(Pane, { close: () => undefined })
  // @ts-expect-error main stores through ctx.storage, not declared stores
  void ctx.stores
  // @ts-expect-error main has no session screen; it is a window API
  void ctx.screen
  const count = ctx.storage.store("count", { schema: Schema.Number, initial: 0 })
  equal<typeof count.value, number>(true)
  ctx.onCleanup(() => count.set(0))
}

equal<PanelProps["screen"], SessionScreen>(true)

equal<Parameters<Panel["list"]>[0]["session"], MountedSession>(true)

equal<Parameters<Panel["list"]>[0]["screen"], SessionScreen>(true)

equal<Parameters<NonNullable<Panel["focus"]>>[0]["restored"], boolean>(true)

equal<Parameters<NonNullable<Panel["normalize"]>>[0]["screen"], SessionScreen>(true)

equal<Parameters<NonNullable<Panel["close"]>>[0], PanelProps>(true)

equal<SlotMap["session.header"]["screen"], SessionScreen>(true)

equal<SlotMap["session.panel.end"]["screen"], SessionScreen>(true)

equal<SlotMap["window.bottom"]["screen"], never>(true)

equal<PanelTab["fallback"], boolean | undefined>(true)

export const ineligible: PanelTab = { id: "details", title: "Details", fallback: false }

equal<Extract<Live<never>, { status: "inactive" }>["reason"], "disabled" | "failed">(true)

// @ts-expect-error only known artwork names belong to SDK icon fields
export const unknownIcon: IconName = "not-an-icon"

export const bound = bindPlugin((props: { readonly label: string }) => props.label)

// @ts-expect-error bound components preserve the original props
bound({ wrong: "field" })

const NoInput = Ipc.define({ id: "fixture.no-input", methods: { info: { output: Schema.String } } })

export function noInput(client: IpcClient<typeof NoInput.spec>, signal: AbortSignal) {
  void client.info()
  void client.info({ signal })
  // @ts-expect-error no input placeholder before call options
  void client.info(undefined, { signal })
  // @ts-expect-error strictly typed call options
  void client.info({ signal: "wrong" })
}

const Nested = Plugin.define({
  stores: {
    prefs: Store.global(Schema.Struct({ items: Schema.Array(Schema.Struct({ shown: Schema.Boolean })) }), {
      items: [],
    }),
  },
})

export const nested: Plugin.Setup<typeof Nested> = (ctx) => {
  ctx.stores.prefs.update((draft) => {
    draft.items.push({ shown: true })
    draft.items[0].shown = false
  })
  // @ts-expect-error stored values stay readonly outside update
  ctx.stores.prefs.value.items.push({ shown: true })
}
