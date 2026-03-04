import { defineMain } from "storybook-solidjs-vite"
import path from "node:path"
import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"

const here = path.dirname(fileURLToPath(import.meta.url))
const ui = path.resolve(here, "../../ui")
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
  stories: ["../../ui/src/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
  async viteFinal(config) {
    const { mergeConfig, searchForWorkspaceRoot } = await import("vite")
    return mergeConfig(config, {
      plugins: [tailwindcss()],
      resolve: {
        dedupe: ["solid-js", "solid-js/web", "@solidjs/meta"],
        alias: [
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
          { find: /^@\/hooks\/use-providers$/, replacement: path.resolve(mocks, "app/hooks/use-providers.ts") },
          {
            find: /^@\/components\/dialog-select-model$/,
            replacement: path.resolve(mocks, "app/components/dialog-select-model.tsx"),
          },
          {
            find: /^@\/components\/dialog-select-model-unpaid$/,
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
          allow: [searchForWorkspaceRoot(process.cwd()), ui, app, mocks],
        },
      },
    })
  },
})
