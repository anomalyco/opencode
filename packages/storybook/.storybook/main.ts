import { defineMain } from "storybook-solidjs-vite"
import path from "node:path"
import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import { playgroundCss } from "./playground-css-plugin.ts"

const here = path.dirname(fileURLToPath(import.meta.url))
const ui = path.resolve(here, "../../ui")
const sessionUi = path.resolve(here, "../../session-ui")
const app = path.resolve(here, "../../app/src")
const mocks = path.resolve(here, "./mocks")

export default defineMain({
  framework: {
    name: "storybook-solidjs-vite",
    options: { docgen: false },
  },
  addons: [
    "@storybook/addon-onboarding",
    "@storybook/addon-docs",
    "@storybook/addon-links",
    "@storybook/addon-a11y",
    "@storybook/addon-vitest",
  ],
  staticDirs: [path.resolve(here, "../../app/public")],
  stories: [
    "../../ui/src/**/*.stories.@(js|jsx|mjs|ts|tsx)",
    "../../session-ui/src/**/*.stories.@(js|jsx|mjs|ts|tsx)",
    "../../app/src/**/*.stories.@(js|jsx|mjs|ts|tsx)",
  ],
  async viteFinal(config) {
    const { mergeConfig, searchForWorkspaceRoot } = await import("vite")
    const merged = mergeConfig(config, {
      plugins: [tailwindcss(), playgroundCss()],
      resolve: {
        dedupe: ["solid-js", "solid-js/web", "@solidjs/meta"],
        alias: [
          { find: "@solidjs/router", replacement: path.resolve(mocks, "solid-router.tsx") },
          { find: /^@\/providers\/models\/selection$/, replacement: path.resolve(mocks, "app/context/local.ts") },
          { find: /^@\/workspaces\/files\/model$/, replacement: path.resolve(mocks, "app/context/file.ts") },
          { find: /^@\/shell\/state\/layout$/, replacement: path.resolve(mocks, "app/context/layout.ts") },
          { find: /^@\/workspaces\/location$/, replacement: path.resolve(mocks, "app/context/location.ts") },
          { find: /^@\/composer\/comments$/, replacement: path.resolve(mocks, "app/context/comments.ts") },
          { find: /^@\/shell\/commands\/command$/, replacement: path.resolve(mocks, "app/context/command.ts") },
          { find: /^@\/session\/requests\/permission$/, replacement: path.resolve(mocks, "app/context/permission.ts") },
          { find: /^@\/runtime\/platform\/platform$/, replacement: path.resolve(mocks, "app/context/platform.ts") },
          { find: /^@\/runtime\/server\/global-sync$/, replacement: path.resolve(mocks, "app/context/global-sync.ts") },
          { find: /^@\/runtime\/server\/sync$/, replacement: path.resolve(mocks, "app/context/server-sync.ts") },
          { find: /^@\/runtime\/server\/client$/, replacement: path.resolve(mocks, "app/context/server-sdk.ts") },
          {
            find: /^@\/providers\/catalog\/providers$/,
            replacement: path.resolve(mocks, "app/hooks/use-providers.ts"),
          },
          {
            find: /^@\/providers\/models\/unpaid$/,
            replacement: path.resolve(mocks, "app/components/dialog-select-model-unpaid.tsx"),
          },
          { find: "@", replacement: app },
        ],
      },
      worker: {
        format: "es",
      },
      server: {
        fs: {
          allow: [searchForWorkspaceRoot(process.cwd()), ui, sessionUi, app, mocks],
        },
      },
    })
    merged.plugins = merged.plugins?.flat(8).filter((plugin) => {
      if (!plugin || typeof plugin !== "object" || !("name" in plugin)) return true
      return plugin.name !== "storybook:optimize-deps-plugin"
    })
    return merged
  },
})
