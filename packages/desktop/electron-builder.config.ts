import type { Configuration } from "electron-builder"

const channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
})()

const APP_IDS = {
  dev: "com.venicecode.desktop.dev",
  beta: "com.venicecode.desktop.beta",
  prod: "com.venicecode.desktop",
} as const

const base: Configuration = {
  artifactName: "venicecode-${os}-${arch}.${ext}",
  directories: {
    output: "dist",
    buildResources: "resources",
  },
  files: ["out/**/*", "resources/**/*", "!resources/opencode-cli*"],
  extraResources: [
    ...(channel === "dev"
      ? [
          {
            from: "resources/",
            to: "",
            filter: ["opencode-cli*"],
          },
        ]
      : []),
  ],
  mac: {
    category: "public.app-category.developer-tools",
    icon: `resources/icons/icon.icns`,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.plist",
    entitlementsInherit: "resources/entitlements.plist",
    // No Developer ID yet: ship an ad-hoc signed build and skip notarization.
    identity: null,
    notarize: false,
    target: ["dmg", "zip"],
  },
  dmg: {
    sign: false,
  },
  protocols: {
    name: "VeniceCode",
    schemes: ["opencode"],
  },
}

function getConfig() {
  const appId = APP_IDS[channel]

  switch (channel) {
    case "dev":
      return { ...base, appId, productName: "VeniceCode Dev" }
    case "beta":
      return {
        ...base,
        appId,
        productName: "VeniceCode Beta",
        protocols: { name: "VeniceCode Beta", schemes: ["opencode"] },
        publish: null,
      }
    case "prod":
      return {
        ...base,
        appId,
        productName: "VeniceCode",
        publish: null,
      }
  }
}

export default getConfig()
