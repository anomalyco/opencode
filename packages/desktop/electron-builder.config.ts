import type { Configuration } from "electron-builder"

const channel = process.env.OPENCODE_CHANNEL === "beta" ? "beta" : process.env.OPENCODE_CHANNEL === "prod" ? "prod" : "dev"
const appId = channel === "prod" ? "ai.opencode.desktop" : `ai.opencode.desktop.${channel}`
const productName = channel === "prod" ? "OpenCode" : channel === "beta" ? "OpenCode Beta" : "OpenCode Dev"

const config: Configuration = {
  appId,
  productName,
  directories: {
    output: "dist",
    buildResources: "resources",
  },
  files: ["out/**/*", "package.json"],
  extraResources: [
    {
      from: "resources/icons",
      to: "icons",
    },
    {
      from: "resources/sidecars",
      to: "sidecars",
      filter: ["**/*"],
    },
  ],
  mac: {
    category: "public.app-category.developer-tools",
    icon: "resources/icons/icon.icns",
    entitlements: "resources/entitlements.plist",
    entitlementsInherit: "resources/entitlements.plist",
    hardenedRuntime: true,
    target: ["dmg", "zip"],
  },
  dmg: {
    sign: false,
  },
  win: {
    icon: "resources/icons/icon.ico",
    target: ["nsis", "zip"],
  },
  linux: {
    icon: "resources/icons",
    category: "Development",
    target: ["AppImage", "deb", "tar.gz"],
  },
  publish: null,
}

export default config
