import { sentryVitePlugin } from "@sentry/vite-plugin"
import { defineConfig } from "electron-vite"
import appPlugin from "../app/vite.js"
import * as fs from "node:fs/promises"
import { realpathSync } from "node:fs"
import { fileURLToPath } from "node:url"

const OPENCODE_SERVER_DIST = "../opencode/dist/node"
const repoRoot = fileURLToPath(new URL("../..", import.meta.url)).replaceAll("\\", "/")
const workspacePath = (target: string) => fileURLToPath(new URL(`../${target}`, import.meta.url)).replaceAll("\\", "/")
const repoPath = (target: string) => fileURLToPath(new URL(`../../${target}`, import.meta.url)).replaceAll("\\", "/")
const copiedWorkspacePackages = (() => {
  try {
    return realpathSync(repoPath("node_modules/@opencode-ai/app")).replaceAll("\\", "/") !== workspacePath("app")
  } catch {
    return false
  }
})()
const rendererWorkspaceAliases = [
  { find: /^@opencode-ai\/app$/, replacement: workspacePath("app/src/index.ts") },
  { find: /^@opencode-ai\/app\/desktop-menu$/, replacement: workspacePath("app/src/desktop-menu.ts") },
  { find: /^@opencode-ai\/app\/updater$/, replacement: workspacePath("app/src/updater.ts") },
  { find: /^@opencode-ai\/app\/wsl\/types$/, replacement: workspacePath("app/src/wsl/types.ts") },
  { find: /^@opencode-ai\/core\/(.+)$/, replacement: `${workspacePath("core/src")}/$1` },
  { find: /^@opencode-ai\/sdk$/, replacement: workspacePath("sdk/js/src/index.ts") },
  { find: /^@opencode-ai\/sdk\/client$/, replacement: workspacePath("sdk/js/src/client.ts") },
  { find: /^@opencode-ai\/sdk\/server$/, replacement: workspacePath("sdk/js/src/server.ts") },
  { find: /^@opencode-ai\/sdk\/v2$/, replacement: workspacePath("sdk/js/src/v2/index.ts") },
  { find: /^@opencode-ai\/sdk\/v2\/client$/, replacement: workspacePath("sdk/js/src/v2/client.ts") },
  { find: /^@opencode-ai\/sdk\/v2\/gen\/client$/, replacement: workspacePath("sdk/js/src/v2/gen/client/index.ts") },
  { find: /^@opencode-ai\/sdk\/v2\/server$/, replacement: workspacePath("sdk/js/src/v2/server.ts") },
  { find: /^@opencode-ai\/ui\/i18n\/(.+)$/, replacement: `${workspacePath("ui/src/i18n")}/$1.ts` },
  { find: /^@opencode-ai\/ui\/pierre$/, replacement: workspacePath("ui/src/pierre/index.ts") },
  { find: /^@opencode-ai\/ui\/pierre\/(.+)$/, replacement: `${workspacePath("ui/src/pierre")}/$1.ts` },
  { find: /^@opencode-ai\/ui\/hooks$/, replacement: workspacePath("ui/src/hooks/index.ts") },
  { find: /^@opencode-ai\/ui\/context$/, replacement: workspacePath("ui/src/context/index.ts") },
  { find: /^@opencode-ai\/ui\/context\/(.+)$/, replacement: `${workspacePath("ui/src/context")}/$1.tsx` },
  { find: /^@opencode-ai\/ui\/styles$/, replacement: workspacePath("ui/src/styles/index.css") },
  { find: /^@opencode-ai\/ui\/styles\/tailwind$/, replacement: workspacePath("ui/src/styles/tailwind/index.css") },
  { find: /^@opencode-ai\/ui\/theme$/, replacement: workspacePath("ui/src/theme/index.ts") },
  { find: /^@opencode-ai\/ui\/theme\/context$/, replacement: workspacePath("ui/src/theme/context.tsx") },
  { find: /^@opencode-ai\/ui\/theme\/(.+)$/, replacement: `${workspacePath("ui/src/theme")}/$1.ts` },
  { find: /^@opencode-ai\/ui\/icons\/provider$/, replacement: workspacePath("ui/src/components/provider-icons/types.ts") },
  { find: /^@opencode-ai\/ui\/icons\/file-type$/, replacement: workspacePath("ui/src/components/file-icons/types.ts") },
  { find: /^@opencode-ai\/ui\/icons\/app$/, replacement: workspacePath("ui/src/components/app-icons/types.ts") },
  { find: /^@opencode-ai\/ui\/fonts\/(.+)$/, replacement: `${workspacePath("ui/src/assets/fonts")}/$1` },
  { find: /^@opencode-ai\/ui\/audio\/(.+)$/, replacement: `${workspacePath("ui/src/assets/audio")}/$1` },
  { find: /^@opencode-ai\/ui\/v2\/styles\/(.+)$/, replacement: `${workspacePath("ui/src/v2/styles")}/$1` },
  { find: /^@opencode-ai\/ui\/v2\/(.+)\.css$/, replacement: `${workspacePath("ui/src/v2/components")}/$1.css` },
  { find: /^@opencode-ai\/ui\/v2\/(.+)$/, replacement: `${workspacePath("ui/src/v2/components")}/$1.tsx` },
  { find: /^@opencode-ai\/ui\/(.+)$/, replacement: `${workspacePath("ui/src/components")}/$1` },
]

const channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  if (process.env.OPENCODE_CHANNEL === "latest") return "prod"
  return "dev"
})()

const nodePtyPkg = `@lydell/node-pty-${process.platform}-${process.arch}`

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
          assets: "./out/renderer/**",
          filesToDeleteAfterUpload: "./out/renderer/**/*.map",
        },
      })
    : false

export default defineConfig({
  main: {
    define: {
      "import.meta.env.OPENCODE_CHANNEL": JSON.stringify(channel),
    },
    build: {
      rollupOptions: {
        input: { index: "src/main/index.ts", sidecar: "src/main/sidecar.ts" },
      },
      externalizeDeps: { include: [nodePtyPkg] },
    },
    plugins: [
      {
        name: "opencode:node-pty-narrower",
        enforce: "pre",
        resolveId(s) {
          if (s === "@lydell/node-pty") return nodePtyPkg
        },
      },
      {
        name: "opencode:virtual-server-module",
        enforce: "pre",
        resolveId(id) {
          if (id === "virtual:opencode-server") return this.resolve(`${OPENCODE_SERVER_DIST}/node.js`)
        },
      },
      {
        name: "opencode:copy-server-assets",
        async writeBundle() {
          for (const l of await fs.readdir(OPENCODE_SERVER_DIST)) {
            if (!l.endsWith(".wasm")) continue
            await fs.writeFile(`./out/main/chunks/${l}`, await fs.readFile(`${OPENCODE_SERVER_DIST}/${l}`))
          }
        },
      },
    ],
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: "src/preload/index.ts" },
        output: {
          format: "cjs",
          entryFileNames: "[name].js",
        },
      },
    },
  },
  renderer: {
    plugins: [appPlugin, sentry],
    publicDir: "../../../app/public",
    root: "src/renderer",
    ...(copiedWorkspacePackages
      ? {
          resolve: {
            alias: rendererWorkspaceAliases,
          },
          optimizeDeps: {
            exclude: ["@opencode-ai/app", "@opencode-ai/core", "@opencode-ai/sdk", "@opencode-ai/ui"],
          },
          server: {
            fs: {
              allow: [repoRoot],
            },
          },
        }
      : {}),
    build: {
      sourcemap: true,
      rollupOptions: {
        input: {
          main: "src/renderer/index.html",
        },
      },
    },
  },
})
