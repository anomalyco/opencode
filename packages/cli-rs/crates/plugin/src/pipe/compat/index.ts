// Virtual modules and JSX entry points served to plugins by the Bun host.
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

// A portal attaches its children to the active render tree.
function Portal(props: { children?: unknown; ref?: (container: unknown) => void }) {
  const container = render.createElement("box")
  for (const [name, value] of Object.entries({ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 1 }))
    render.setProp(container, name, value)
  props.ref?.(container)
  render.insert(container, () => props.children)
  return container
}

// Preserve export names even for unsupported renderables so unused imports can link.
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

export const modules: Record<string, Record<string, unknown>> = {
  "solid-js": solid,
  "solid-js/store": store,
  "@opentui/solid": opentuiSolid,
  "@opentui/solid/jsx-runtime": jsx,
  "@opentui/solid/jsx-dev-runtime": jsx,
  // A local module without the pragma compiles for React's runtime; it gets OpenTUI's (TS compiles it with Solid's).
  "react/jsx-runtime": jsx,
  "react/jsx-dev-runtime": jsx,
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
  "@opencode/plugin/rpc": { Rpc },
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
