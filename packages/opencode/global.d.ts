declare module "babel-preset-solid" {
  import type { ConfigAPI, PluginObj } from "@babel/core"
  type PluginOptions = object | undefined | false

  export default function preset(api: ConfigAPI, options?: PluginOptions): PluginObj<unknown> | void
}

declare module "@babel/preset-typescript" {
  import type { ConfigAPI, PluginObj } from "@babel/core"
  type PluginOptions = object | undefined | false

  export default function preset(api: ConfigAPI, options?: PluginOptions): PluginObj<unknown> | void
}

declare module "@babel/preset-react" {
  import type { ConfigAPI, PluginObj } from "@babel/core"
  type PluginOptions = object | undefined | false

  export default function preset(api: ConfigAPI, options?: PluginOptions): PluginObj<unknown> | void
}

declare module "@opentui/solid/scripts/solid-plugin" {
  import type { BunPlugin } from "bun"

  const plugin: BunPlugin
  export default plugin
}
