import { fileURLToPath } from "node:url"
import { defineConfig, type Plugin, type UserConfig } from "vite"
import desktopPlugin, { channel } from "./vite.js"
import { icons } from "./vite.icons"
import { serviceWorker } from "./vite.pwa"

// The app is built for the root by default; `vite build --base=/opencode/` serves it under that path. A base without
// its trailing slash would reach `import.meta.env.BASE_URL` and `%BASE_URL%` as is and glue paths onto it.
const basePath: Plugin = {
  name: "opencode-app:base-path",
  config(config) {
    if (config.base?.startsWith("/") && !config.base.endsWith("/")) return { base: `${config.base}/` }
  },
}

// The e2e build also emits the fixture pages the tests open beside the app.
const testFixtureInput = [
  "index.html",
  "e2e/utils/settings-wsl.html",
  "e2e/utils/app-direction.html",
  "e2e/utils/windows-menu.html",
]

const build: UserConfig["build"] = { assetsDir: "_assets", target: "esnext", sourcemap: true }

if (process.env.VITE_OPENCODE_TEST_FIXTURES === "1") build.rolldownOptions = { input: testFixtureInput }

export default defineConfig({
  // SAFETY: the plugins are typed against the different Vite versions their packages depend on, but all of them only
  // use hooks this Vite runs.
  plugins: [
    basePath,
    desktopPlugin,
    icons(channel),
    serviceWorker(fileURLToPath(new URL("./dist", import.meta.url))),
  ] as any,
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3000,
  },
  build,
})
