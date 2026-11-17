// CT-8: `@joe-broadhead/opencode-linear@0.0.9`, unmodified from npm. It binds `r` to "refresh" with `enabled: shown`,
// so it applies only while its status dialog shows; TS binds no disabled command. The host took every `r` anyway, so
// the composer lost them. Now a disabled command declines its key, which goes on to the composer. TS loads the package
// from node_modules; the Rust client runs the same files on the JS host through the V2 compatibility layer.
import { defineApp } from "../../lib/app"
import { keysApp } from "./keys"

export default defineApp({
  ...keysApp,
  config: { plugins: ["./out/npm/node_modules/@joe-broadhead/opencode-linear"] },
  env: { OPENCODE_PARITY_PLUGIN: "npm" },
})
