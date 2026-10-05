// Type-level contract of typed composition, checked by `bun typecheck`. Nothing imports this file. Each
// `@ts-expect-error` fails the typecheck if its line stops being an error.
import type { Accessor } from "solid-js"
import { Schema } from "effect"
import {
  Extension,
  bindExtension,
  Ipc,
  Contract,
  Store,
  type Composition,
  type Conflict,
  type DefinitionCheck,
  type Desktop,
  type Duplicate,
  type DuplicateExtension,
  type IpcClient,
  type Live,
  type Missing,
  type MissingMain,
  type IpcsProvided,
  type SessionScreen,
  type MountedSession,
  type Panel,
  type PanelProps,
  type PanelTab,
  type SlotMap,
  type IconName,
  type Setup,
} from "./index"
import type { MainSetup } from "./main"

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

const equal = <A, B>(value: Equal<A, B>) => value

const Tree = Contract.define<{ open(path: string): void }, "fixture.tree">("fixture.tree")

const Changes = Contract.define<{ count(): number }, "fixture.changes">("fixture.changes")

const Pane = Ipc.define({ id: "fixture.pane", methods: { open: { input: Schema.String } } })

const View = Schema.Struct({ open: Schema.Boolean })

const TreeProvider = Extension.define({ id: "tree", provides: { tree: Tree } })

const PaneProvider = Extension.define({ id: "pane", provides: { pane: Pane } })

const Consumer = Extension.define({
  id: "consumer",
  uses: { changes: Changes },
  requires: { tree: Tree, pane: Pane },
  stores: { view: Store.global(View, { open: false }), draft: Store.session(View, { open: true }) },
})

// A composition with every hard provider and no duplicate compiles, and is the identity at runtime.
export const renderer = Extension.compose(TreeProvider, PaneProvider, Consumer)

equal<typeof renderer, readonly [typeof TreeProvider, typeof PaneProvider, typeof Consumer]>(true)

// A `requires` token nobody provides.
// @ts-expect-error the composition is missing a provider of fixture.tree
Extension.compose(PaneProvider, Consumer)

equal<Composition<[typeof PaneProvider, typeof Consumer]>, { readonly "missing provider": Missing<"fixture.tree"> }>(
  true,
)

// Extension identities must be unique even when the definitions provide nothing.
const SameId = Extension.define({ id: "tree" })

// @ts-expect-error two definitions share the extension id tree
Extension.compose(TreeProvider, SameId)

equal<
  Composition<[typeof TreeProvider, typeof SameId]>,
  { readonly "duplicate extension": DuplicateExtension<"tree"> }
>(true)

// Two providers of one token.
const Second = Extension.define({ id: "second", provides: { tree: Tree } })

// @ts-expect-error two extensions provide fixture.tree
Extension.compose(TreeProvider, Second, PaneProvider, Consumer)

equal<
  Composition<[typeof TreeProvider, typeof Second, typeof PaneProvider, typeof Consumer]>,
  { readonly "duplicate provider": Duplicate<"fixture.tree"> }
>(true)

// A renderer Ipc needs an entry with a main module that provides it in the main composition.
export const main = Extension.compose({ ...PaneProvider, main: async () => ({ default: () => undefined }) })

export const ipcs: IpcsProvided<typeof renderer, typeof main> = true

export const mainless = Extension.compose(PaneProvider)

// @ts-expect-error no main entry provides fixture.pane
export const unprovided: IpcsProvided<typeof renderer, typeof mainless> = true

equal<IpcsProvided<typeof renderer, typeof mainless>, MissingMain<"fixture.pane">>(true)

// A reference types like its token, resolves from the full token, and is refused in `requires`.
const PaneRef = Ipc.ref<typeof Pane>("fixture.pane")

const RefConsumer = Extension.define({ id: "ref", uses: { pane: PaneRef } })

export const referenced: IpcsProvided<[typeof RefConsumer], typeof main> = true

export const resolver: Setup<typeof RefConsumer> = (ctx) => {
  const full = ctx.uses.pane.load(Pane)
  equal<typeof full, Accessor<Live<IpcClient<(typeof Pane)["spec"]>>>>(true)
  // @ts-expect-error the full token must be the reference's
  ctx.uses.pane.load(Ipc.define({ id: "fixture.other", methods: {} }))
  // @ts-expect-error the id must be the token's
  Ipc.ref<typeof Pane>("fixture.other")
}

// @ts-expect-error a reference cannot be required
Extension.define({ id: "held", requires: { pane: PaneRef } })

// The typed context exposes only what the definition declares.
export const setup: Setup<typeof Consumer> = (ctx) => {
  equal<typeof ctx.uses.changes, Accessor<Live<{ count(): number }>>>(true)
  ctx.requires.tree.open("a.ts")
  void ctx.requires.pane.open("https://example.com")
  equal<typeof ctx.stores.view.value, { readonly open: boolean }>(true)
  equal<ReturnType<typeof ctx.stores.draft>["value"], { readonly open: boolean } | undefined>(true)
  // Host APIs are properties of the context; the desktop one is undefined on the web.
  equal<typeof ctx.desktop, Desktop | undefined>(true)
  // @ts-expect-error host APIs are properties, not tokens
  void ctx.use
  // @ts-expect-error nothing named unlisted is declared in uses
  void ctx.uses.unlisted
  // @ts-expect-error fixture.tree is required, not used: its value is `ctx.requires.tree`
  void ctx.uses.tree
  // @ts-expect-error the consumer declares no provides
  ctx.provide(Tree, { open: () => undefined })
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

equal<ReturnType<Setup<typeof Consumer>>, undefined>(true)

// @ts-expect-error an async window setup returns a Promise, not undefined
export const asyncSetup: Setup<typeof Consumer> = async () => {}

// @ts-expect-error a window setup cannot return an object either
export const returningSetup: Setup<typeof Consumer> = () => ({ open: true })

equal<ReturnType<MainSetup<typeof Consumer>>, void | Promise<void>>(true)

equal<PanelProps["screen"], SessionScreen>(true)

equal<Parameters<Panel["list"]>[0]["session"], MountedSession>(true)

equal<Parameters<Panel["list"]>[0]["screen"], SessionScreen>(true)

equal<Parameters<NonNullable<Panel["focus"]>>[0]["restored"], boolean>(true)

equal<Parameters<NonNullable<Panel["normalize"]>>[0]["screen"], SessionScreen>(true)

equal<Parameters<NonNullable<Panel["close"]>>[0], PanelProps>(true)

equal<SlotMap["session.header"]["screen"], SessionScreen>(true)

equal<SlotMap["session.panel.end"]["screen"], SessionScreen>(true)

equal<SlotMap["session.panel.sidebar"]["screen"], SessionScreen>(true)

equal<SlotMap["window.bottom"]["screen"], never>(true)

equal<PanelTab["fallback"], boolean | undefined>(true)

export const ineligible: PanelTab = { id: "details", title: "Details", fallback: false }

equal<Extract<Live<never>, { status: "inactive" }>["reason"], "disabled" | "failed" | "blocked" | "restarting">(true)

// @ts-expect-error only known artwork names belong to SDK icon fields
export const unknownIcon: IconName = "not-an-icon"

export const bound = bindExtension((props: { readonly label: string }) => props.label)

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

const Nested = Extension.define({
  id: "nested",
  stores: {
    prefs: Store.global(Schema.Struct({ items: Schema.Array(Schema.Struct({ shown: Schema.Boolean })) }), {
      items: [],
    }),
  },
})

export const nested: Setup<typeof Nested> = (ctx) => {
  ctx.stores.prefs.update((draft) => {
    draft.items.push({ shown: true })
    draft.items[0].shown = false
  })
  // @ts-expect-error stored values stay readonly outside update
  ctx.stores.prefs.value.items.push({ shown: true })
}

export const provider: Setup<typeof TreeProvider> = (ctx) => {
  ctx.provide(Tree, { open: () => undefined })
  // @ts-expect-error the implementation must match the token
  ctx.provide(Tree, { close: () => undefined })
  // What an extension provides it reads through `uses` too, without declaring it twice.
  equal<typeof ctx.uses.tree, Accessor<Live<{ open(path: string): void }>>>(true)
}

export const ipcProvider: Setup<typeof PaneProvider> = (ctx) => {
  equal<typeof ctx.uses.pane, Accessor<Live<IpcClient<(typeof Pane)["spec"]>>>>(true)
}

// The same token under one key in both records is allowed; two different tokens under one key are not.
export const repeated = Extension.define({ id: "repeated", provides: { tree: Tree }, uses: { tree: Tree } })

// @ts-expect-error `tree` names fixture.tree in provides and fixture.changes in uses
Extension.define({ id: "clash", provides: { tree: Tree }, uses: { tree: Changes } })

equal<
  DefinitionCheck<{
    readonly provides: { readonly tree: typeof Tree }
    readonly uses: { readonly tree: typeof Changes }
  }>,
  { readonly "conflicting key": Conflict<"tree"> }
>(true)

// Each process's `ctx.stores` holds only its own declared stores; main's are always loaded.
const Split = Extension.define({
  id: "split",
  stores: { view: Store.global(View, { open: false }), count: Store.main(Schema.Number, 0) },
})

export const windowStores: Setup<typeof Split> = (ctx) => {
  equal<typeof ctx.stores.view.value, { readonly open: boolean }>(true)
  // @ts-expect-error a main store is not in the window's context
  void ctx.stores.count
}

export const mainStores: MainSetup<typeof Split> = (ctx) => {
  equal<typeof ctx.stores.count.value, number>(true)
  // @ts-expect-error a window store is not in the main context
  void ctx.stores.view
  // @ts-expect-error main has no session screen; it is a window API
  void ctx.screen
}

// A main entry provides only the Ipcs its definition declares, a reference through its full token; with no
// definition, as for an installed extension's plain JavaScript, any Ipc.
const Other = Ipc.define({ id: "fixture.other", methods: { ping: {} } })

const RefProvider = Extension.define({ id: "refProvider", provides: { pane: PaneRef } })

export const mainProvider: MainSetup<typeof PaneProvider> = (ctx) => {
  ctx.provide(Pane, { open: () => undefined })
  // @ts-expect-error fixture.other is not in the definition's provides
  ctx.provide(Other, { ping: () => undefined })
}

export const mainRefProvider: MainSetup<typeof RefProvider> = (ctx) => void ctx.provide(Pane, { open: () => undefined })

export const installedProvider: MainSetup = (ctx) => void ctx.provide(Other, { ping: () => undefined })

// @ts-expect-error a main store's `from` names a settings key or a state namespace and key, not a raw string
Store.main(Schema.Number, 0, "settings:count")
