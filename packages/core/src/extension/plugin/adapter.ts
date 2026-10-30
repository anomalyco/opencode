export * as PluginAdapter from "./adapter.js"

import path from "path"
import { Effect } from "effect"
import { FSUtil } from "@opencode/util/fs-util"
import { Extension } from "@opencode/schema/extension"
import { ExtensionSecurity } from "../security.js"

export interface PluginInspectionReport {
  readonly id: string
  readonly name: string
  readonly version: string
  readonly originPlatform: Extension.Platform
  readonly entryPoint?: string
  readonly isNative: boolean
  readonly dependencies: Record<string, string>
  readonly tools: string[]
  readonly hooks: string[]
  readonly permissions: Extension.Permissions
  readonly shimRequired: boolean
  readonly shimCode?: string
  readonly unsupportedFeatures: string[]
  readonly security: Extension.SecurityReport
}

export const inspect = Effect.fn("PluginAdapter.inspect")(function* (pluginDir: string) {
  const fs = yield* FSUtil.Service

  const pkgJsonPath = path.join(pluginDir, "package.json")
  const pkgContent = yield* fs.readFileStringSafe(pkgJsonPath).pipe(Effect.orElseSucceed(() => undefined))

  const security = yield* ExtensionSecurity.scanDirectory(pluginDir)

  if (!pkgContent) {
    // Check if it's a single file script plugin or Antigravity plugin
    const manifestPath = path.join(pluginDir, "manifest.json")
    const manifestContent = yield* fs.readFileStringSafe(manifestPath).pipe(Effect.orElseSucceed(() => undefined))

    if (manifestContent) {
      try {
        const manifest = JSON.parse(manifestContent)
        const id = manifest.id ?? path.basename(pluginDir)
        return {
          id,
          name: manifest.name ?? id,
          version: manifest.version ?? "1.0.0",
          originPlatform: "antigravity" as const,
          isNative: false,
          dependencies: {},
          tools: Array.isArray(manifest.tools) ? manifest.tools : [],
          hooks: Array.isArray(manifest.hooks) ? manifest.hooks : [],
          permissions: {
            filesystem: manifest.permissions?.filesystem ?? [],
            network: manifest.permissions?.network ?? [],
          },
          shimRequired: true,
          shimCode: generateAntigravityShim(id, manifest),
          unsupportedFeatures: [],
          security,
        }
      } catch {
        // ignore
      }
    }

    return undefined
  }

  try {
    const pkg = JSON.parse(pkgContent)
    const id = pkg.name ?? path.basename(pluginDir)
    const isNative = Boolean(pkg.dependencies?.["@opencode/plugin"] || pkg.peerDependencies?.["@opencode/plugin"])

    const originPlatform: Extension.Platform = isNative ? "opencode" : "custom"

    const dependencies = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    }

    const entryPoint = pkg.main ?? pkg.module ?? "index.js"

    // Search for tool registrations in source files
    const tools: string[] = []
    const hooks: string[] = []
    const unsupportedFeatures: string[] = []

    const srcFiles = yield* fs.scan("**/*.{ts,js}", {
      cwd: pluginDir,
      absolute: true,
      include: "file",
      ignore: FSUtil.ignoreGlobs,
    }).pipe(Effect.orElseSucceed(() => []))

    for (const file of srcFiles) {
      const content = yield* fs.readFileStringSafe(file).pipe(Effect.orElseSucceed(() => undefined))
      if (!content) continue

      // Look for tool declarations
      const toolMatches = content.matchAll(/defineTool\s*\(\s*["']([^"']+)["']/g)
      for (const m of toolMatches) {
        if (m[1]) tools.push(m[1])
      }

      // Look for lifecycle hooks
      const hookMatches = content.matchAll(/\b(onInit|onSessionStart|onMessage|beforeToolExecute)\b/g)
      for (const h of hookMatches) {
        if (h[1] && !hooks.includes(h[1])) hooks.push(h[1])
      }
    }

    return {
      id,
      name: pkg.name ?? id,
      version: pkg.version ?? "1.0.0",
      originPlatform,
      entryPoint,
      isNative,
      dependencies,
      tools,
      hooks,
      permissions: {
        filesystem: [pluginDir],
      },
      shimRequired: !isNative,
      shimCode: !isNative ? generateGenericShim(id, entryPoint, tools) : undefined,
      unsupportedFeatures,
      security,
    }
  } catch {
    return undefined
  }
})

function generateAntigravityShim(id: string, manifest: any): string {
  return [
    `// Auto-generated OpenCode compatibility shim for Antigravity plugin: ${id}`,
    `import { define } from "@opencode/plugin/effect/plugin";`,
    `import { Effect } from "effect";`,
    ``,
    `export const Plugin = define({`,
    `  id: "${id}",`,
    `  effect: Effect.fn(function* (ctx) {`,
    `    Effect.logInfo("Initializing Antigravity compatibility shim for ${id}");`,
    `  })`,
    `});`,
  ].join("\n")
}

function generateGenericShim(id: string, entryPoint: string, tools: string[]): string {
  return [
    `// Auto-generated OpenCode compatibility shim for plugin: ${id}`,
    `import { define } from "@opencode/plugin/effect/plugin";`,
    `import { Effect } from "effect";`,
    ``,
    `export const Plugin = define({`,
    `  id: "${id}",`,
    `  effect: Effect.fn(function* (ctx) {`,
    `    Effect.logInfo("Loaded adapted plugin ${id} via compatibility bridge");`,
    `  })`,
    `});`,
  ].join("\n")
}
