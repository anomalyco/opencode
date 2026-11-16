// The V2 compatibility layer of the JS host (P8), bundled into `compat.js` by `script/gen/js-host.ts`: the modules a
// V2 plugin imports, which the JS host serves in place of the TS client's (`runtime-plugin-support.bun.ts` gives
// `@opencode/plugin/tui`, Solid and `@opentui/solid` the same way), and the context its setup gets.
import { Rpc } from "../../../../../../schema/src/rpc"
import * as solid from "solid-js"
import * as store from "solid-js/store"
import { createComponent, splitProps } from "solid-js"
import * as core from "./core"
import { exports } from "./inert"
import * as jsx from "./jsx"
import * as render from "./render"
import { context, PluginContext, reported } from "./v2"

// `@opentui/solid`'s `Dynamic`: a component or an intrinsic, chosen by `component`.
function Dynamic(props: Record<string, any>) {
  const [local, rest] = splitProps(props, ["component"])
  return solid.createMemo(() => {
    const component = local.component
    if (typeof component === "function") return solid.untrack(() => createComponent(component, rest))
    if (typeof component !== "string") return undefined
    return solid.untrack(() => {
      const element = render.createElement(component)
      render.spread(element, rest)
      return element
    })
  }) as unknown
}

function Portal(): never {
  throw new Error("<Portal> is not supported by opencode-native's JS host")
}

// Every name the real package exports links (FT-5): those the layer lacks are inert (`inert.ts`).
const opentuiSolid = exports("solid", {
  ...render,
  ...solid,
  createComponent: render.createComponent,
  mergeProps: render.mergeProps,
  Dynamic,
  createDynamic: (component: () => unknown, props: Record<string, unknown>) =>
    Dynamic(
      render.mergeProps(props, {
        get component() {
          return component()
        },
      }),
    ),
  Portal,
  RendererContext: solid.createContext(),
  extend() {
    throw new Error("extend is not supported by opencode-native's JS host")
  },
})

const plugin = {
  Plugin: { define: (definition: unknown) => definition },
  PluginContextProvider: (props: { value: unknown; children?: unknown }) =>
    createComponent(PluginContext.Provider, {
      value: props.value,
      get children() {
        return props.children
      },
    }),
  usePlugin() {
    const value = solid.useContext(PluginContext)
    if (!value) throw new Error("PluginContextProvider is missing")
    return value
  },
}

// Each specifier a plugin may import, and what the JS host gives it.
export const modules: Record<string, Record<string, unknown>> = {
  "solid-js": solid,
  "solid-js/store": store,
  "@opentui/solid": opentuiSolid,
  "@opentui/solid/jsx-runtime": jsx,
  "@opentui/solid/jsx-dev-runtime": jsx,
  // A local module without the pragma compiles for React's runtime; it gets OpenTUI's (TS compiles it with Solid's).
  "react/jsx-runtime": jsx,
  "react/jsx-dev-runtime": jsx,
  "@opentui/core": exports("core", core),
  "@opencode/plugin/tui": plugin,
  // The definition of a plugin's own server RPC, which its TUI part calls through `client.rpc` (CT-4).
  "@opencode/plugin/rpc": { Rpc },
}

export { context, reported }
export { inside, real } from "./paths"
