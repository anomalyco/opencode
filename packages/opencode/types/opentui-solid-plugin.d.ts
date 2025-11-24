// Local shim because @opentui/solid/scripts/solid-plugin ships without types; needed for build script import.
declare module "@opentui/solid/scripts/solid-plugin" {
  import type { BunPlugin } from "bun"
  const plugin: BunPlugin
  export default plugin
}
