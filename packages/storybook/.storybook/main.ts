import { defineMain } from "storybook-solidjs-vite"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const ui = path.resolve(here, "../../ui")

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
      resolve: {
        dedupe: ["solid-js", "solid-js/web", "@solidjs/meta"],
      },
      worker: {
        format: "es",
      },
      server: {
        fs: {
          allow: [searchForWorkspaceRoot(process.cwd()), ui],
        },
      },
    })
  },
})
