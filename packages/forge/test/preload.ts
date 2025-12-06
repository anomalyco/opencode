import { Log } from "../src/util/log"

// Disable network-heavy/default plugin installs and LSP downloads during tests
process.env.FORGE_DISABLE_DEFAULT_PLUGINS = "true"
process.env.FORGE_DISABLE_LSP_DOWNLOAD = "true"
process.env.FORGE_DISABLE_PLUGINS = "true"

Log.init({
  print: false,
  dev: true,
  level: "DEBUG",
})
