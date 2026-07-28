import { defineMain } from "storybook-solidjs-vite"
import path from "node:path"
import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import { playgroundCss } from "./playground-css-plugin"

const here = path.dirname(fileURLToPath(import.meta.url))
const ui = path.resolve(here, "../../ui")
const sessionUi = path.resolve(here, "../../session-ui")
const app = path.resolve(here, "../../app/src")
const mocks = path.resolve(here, "./mocks")

export default defineMain({
  framework: {
    name: "storybook-solidjs-vite",
    options: {},
  },
  addons: [
    "@storybook/addon-onboarding",
    "@storybook/addon-docs",
    "@storybook/addon-links",
    "@storybook/addon-a11y",
    "@storybook/addon-vitest",
  ],
  stories: [
    "../../ui/src/**/*.stories.@(js|jsx|mjs|ts|tsx)",
    "../../session-ui/src/**/*.stories.@(js|jsx|mjs|ts|tsx)",
    "../../app/src/**/*.stories.@(js|jsx|mjs|ts|tsx)",
  ],
  async viteFinal(config) {
    const { searchForWorkspaceRoot } = await import("vite")

    // Add plugins directly to the existing config
    config.plugins = config.plugins || []
    config.plugins.push(tailwindcss(), playgroundCss())

    // Add aliases directly to the existing config (per storybook docs pattern)
    if (!config.resolve) config.resolve = {}
    if (!config.resolve.alias) config.resolve.alias = []
    if (!Array.isArray(config.resolve.alias)) {
      config.resolve.alias = Object.entries(config.resolve.alias).map(([find, replacement]) => ({ find, replacement: replacement as string }))
    }

    const existingAliases = config.resolve.alias as Array<{ find: string | RegExp; replacement: string }>

    existingAliases.push(
      // Mock aliases for @/ context modules
      { find: "@solidjs/router", replacement: path.resolve(mocks, "solid-router.tsx") },
      { find: /^@\/context\/local$/, replacement: path.resolve(mocks, "app/context/local.ts") },
      { find: /^@\/context\/file$/, replacement: path.resolve(mocks, "app/context/file.ts") },
      { find: /^@\/context\/prompt$/, replacement: path.resolve(mocks, "app/context/prompt.ts") },
      { find: /^@\/context\/layout$/, replacement: path.resolve(mocks, "app/context/layout.ts") },
      { find: /^@\/context\/sdk$/, replacement: path.resolve(mocks, "app/context/sdk.ts") },
      { find: /^@\/context\/sync$/, replacement: path.resolve(mocks, "app/context/sync.ts") },
      { find: /^@\/context\/comments$/, replacement: path.resolve(mocks, "app/context/comments.ts") },
      { find: /^@\/context\/command$/, replacement: path.resolve(mocks, "app/context/command.ts") },
      { find: /^@\/context\/permission$/, replacement: path.resolve(mocks, "app/context/permission.ts") },
      { find: /^@\/context\/language$/, replacement: path.resolve(mocks, "app/context/language.ts") },
      { find: /^@\/context\/platform$/, replacement: path.resolve(mocks, "app/context/platform.ts") },
      { find: /^@\/context\/global-sync$/, replacement: path.resolve(mocks, "app/context/global-sync.ts") },
      { find: /^@\/context\/server-sync$/, replacement: path.resolve(mocks, "app/context/server-sync.ts") },
      { find: /^@\/context\/server-sdk$/, replacement: path.resolve(mocks, "app/context/server-sdk.ts") },
      { find: /^@\/context\/global$/, replacement: path.resolve(mocks, "app/context/global.ts") },
      { find: /^@\/context\/tabs$/, replacement: path.resolve(mocks, "app/context/tabs.ts") },
      { find: /^@\/context\/server$/, replacement: path.resolve(mocks, "app/context/server.ts") },
      { find: /^@\/pages\/layout\/session-tab-avatar$/, replacement: path.resolve(mocks, "app/pages/layout/session-tab-avatar.tsx") },
      { find: /^@\/hooks\/use-providers$/, replacement: path.resolve(mocks, "app/hooks/use-providers.ts") },
      { find: /^@\/components\/dialog-select-model$/, replacement: path.resolve(mocks, "app/components/dialog-select-model.tsx") },
      { find: /^@\/components\/dialog-select-model-unpaid$/, replacement: path.resolve(mocks, "app/components/dialog-select-model-unpaid.tsx") },
      { find: "@", replacement: app },
    )

    // Ensure dedupe
    if (!config.resolve.dedupe) config.resolve.dedupe = []
    config.resolve.dedupe.push("solid-js", "solid-js/web", "@solidjs/meta")

    // File system access
    if (!config.server) config.server = {}
    if (!config.server.fs) config.server.fs = {}
    config.server.fs.allow = [
      searchForWorkspaceRoot(process.cwd()),
      ui,
      sessionUi,
      app,
      mocks,
      path.resolve(here, "../../app"),
      path.resolve(here, "../../app/node_modules"),
    ]

    return config
  },
})
