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
import { BoxRenderable, CodeRenderable, InputRenderable, MarkdownRenderable, ScrollBoxRenderable, TextRenderable } from "./renderables"
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

// `@opentui/solid`'s `Portal` (CT-10): its children go into the renderer's root, absolute boxes over the screen. A
// mount draws only in its own room, so they go into a box that fills the room of the mount that renders the portal,
// over the rest of it, which `ref` gets as the container. In the `app` slot that room is the screen, as in TS
// (opencode-landstrip's pane); elsewhere it is the slot's. Its `mount` is not followed.
function Portal(props: { children?: unknown; ref?: (container: unknown) => void }) {
  const container = render.createElement("box")
  for (const [name, value] of Object.entries({ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 1 }))
    render.setProp(container, name, value)
  props.ref?.(container)
  render.insert(container, () => props.children)
  return container
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
  // With the renderables a plugin builds with `new` (contract 2.x, step D).
  "@opentui/core": exports("core", {
    ...core,
    BoxRenderable,
    TextRenderable,
    MarkdownRenderable,
    CodeRenderable,
    ScrollBoxRenderable,
    InputRenderable,
  }),
  "@opencode/plugin/tui": plugin,
  // The definition of a plugin's own server RPC, which its TUI part calls through `client.rpc` (CT-4).
  "@opencode/plugin/rpc": { Rpc },
  // The Effect entry, whose `Rpc` is the same definition (CT-23: opencode-superagent's TUI defines its RPC by it). Its
  // other names, the server's Effect schemas, link but are undefined: a TUI part has no use for them.
  "@opencode/plugin/effect": {
    Rpc,
    ...Object.fromEntries(
      [
        "Plugin",
        "Agent",
        "Artifact",
        "Command",
        "Connection",
        "Credential",
        "Integration",
        "Location",
        "Mcp",
        "Model",
        "PersistentPty",
        "Provider",
        "Reference",
        "Skill",
        "Tool",
        "Vcs",
        "WebSearch",
        "Worktree",
      ].map((name) => [name, undefined]),
    ),
  },
}

export { context, reported }
export { inside, real } from "./paths"
