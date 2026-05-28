import { sentryVitePlugin } from "@sentry/vite-plugin"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import desktopPlugin from "./vite"

const appRoot = fileURLToPath(new URL(".", import.meta.url))
const watchRoots = [
  appRoot,
  fileURLToPath(new URL("../core/", import.meta.url)),
  fileURLToPath(new URL("../sdk/js/", import.meta.url)),
  fileURLToPath(new URL("../ui/", import.meta.url)),
]
const ignoredWatchRoots = [
  fileURLToPath(new URL("../ui/src/assets/icons/file-types/", import.meta.url)),
  fileURLToPath(new URL("../ui/src/assets/icons/provider/", import.meta.url)),
]

const sentry =
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
    ? sentryVitePlugin({
        authToken: process.env.SENTRY_AUTH_TOKEN,
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        telemetry: false,
        release: {
          name: process.env.SENTRY_RELEASE ?? process.env.VITE_SENTRY_RELEASE,
        },
        sourcemaps: {
          assets: "./dist/**",
          filesToDeleteAfterUpload: "./dist/**/*.map",
        },
      })
    : false

export default defineConfig({
  plugins: [desktopPlugin, sentry] as any,
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3000,
    watch: {
      ignored: (file) =>
        ignoredWatchRoots.some((root) => file.startsWith(root)) ||
        !watchRoots.some((root) => file.startsWith(root)),
    },
  },
  build: {
    target: "esnext",
    sourcemap: true,
  },
})
