import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import { runtimeModuleIdForSpecifier } from "@opentui/core/runtime-plugin"
import { isBuiltin } from "node:module"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { localSource } from "./discovery"
import { transformAsync, types, type PluginObj } from "@babel/core"

const shared = new Set([
  "@opencode-ai/plugin/tui",
  "@opentui/core",
  "@opentui/core/testing",
  "@opentui/solid",
  "@opentui/solid/components",
  "@opentui/solid/jsx-runtime",
  "@opentui/solid/jsx-dev-runtime",
  "solid-js",
  "solid-js/store",
])

export async function prepareSource(
  entrypoint: string,
  version: number,
  track: (file: string, directory?: boolean) => void,
) {
  const solid = createSolidTransformPlugin()
  const result = await Bun.build({
    entrypoints: [fileURLToPath(entrypoint)],
    target: "bun",
    format: "esm",
    throw: false,
    plugins: [
      {
        name: "local-plugin-source",
        async setup(build) {
          build.onResolve({ filter: /.*/ }, (args) => {
            if (!args.importer) return undefined
            const local = localSource(args.path, args.resolveDir)
            if (local) {
              try {
                const resolved = Bun.resolveSync(fileURLToPath(local), args.resolveDir)
                const external = !isSource(resolved)
                return { path: external ? pathToFileURL(resolved).href : resolved, external }
              } catch (error) {
                track(path.dirname(fileURLToPath(local)), true)
                throw error
              }
            }
            return { path: args.path, external: true }
          })
          // Reuse OpenTUI's Solid compiler, preserving per-module source paths
          // before bundling so new URL("./asset", import.meta.url) still works.
          await solid.setup({
            ...build,
            onLoad(options, load) {
              return build.onLoad(options, async (args) => {
                track(args.path)
                const result = await load(args)
                if (!result || !("contents" in result)) return result
                return {
                  ...result,
                  contents: await transformSource(
                    typeof result.contents === "string" ? result.contents : new TextDecoder().decode(result.contents),
                    args.path,
                    "js",
                  ),
                  loader: "js",
                }
              })
            },
          })
          build.onLoad({ filter: /\.[cm]?[jt]s$/ }, async (args) => {
            track(args.path)
            return {
              contents: await transformSource(
                await Bun.file(args.path).text(),
                args.path,
                /\.[cm]?ts$/.test(args.path) ? "ts" : "js",
              ),
              loader: "js",
            }
          })
          build.onLoad({ filter: /\.json$/ }, (args) => {
            track(args.path)
          })
        },
      },
    ],
  })
  if (!result.success) throw new Error(result.logs.map(String).join("\n"))
  const url = URL.createObjectURL(
    new Blob([await result.outputs[0].text(), `\n// generation ${version}\n`], { type: "text/javascript" }),
  )
  return { version: url, dispose: () => URL.revokeObjectURL(url) }
}

async function transformSource(contents: string, file: string, loader: "js" | "ts") {
  // Bun's build onResolve({ external: true }) preserves the original import
  // spelling, ignoring its returned path. Rewrite before bundling so packages
  // resolve beside their importing source, not beside the generated bundle.
  const rewrite = (source: { value: string }) => {
    if (isBuiltin(source.value) || source.value === "bun" || source.value.startsWith("opentui:")) return
    const local = localSource(source.value, path.dirname(file))
    if (local) {
      // Keep build-time resolution (and failed-source watching) for code. Data
      // and native modules stay runtime imports anchored at the original file.
      if (!/\.(?:[cm]?[jt]sx?|json)$/.test(local.pathname) && path.extname(local.pathname)) source.value = local.href
      return
    }
    source.value = shared.has(source.value)
      ? runtimeModuleIdForSpecifier(source.value)
      : pathToFileURL(Bun.resolveSync(source.value, path.dirname(file))).href
  }
  const imports: PluginObj = {
    visitor: {
      ImportDeclaration: (p) => rewrite(p.node.source),
      ExportNamedDeclaration: (p) => {
        if (p.node.source) rewrite(p.node.source)
      },
      ExportAllDeclaration: (p) => rewrite(p.node.source),
      CallExpression: (p) => {
        if (
          p.node.callee.type !== "Import" &&
          !(p.node.callee.type === "Identifier" && p.node.callee.name === "require")
        )
          return
        const argument = p.node.arguments[0]
        if (argument?.type === "StringLiteral") {
          rewrite(argument)
          return
        }
        if (p.node.callee.type === "Import" && types.isExpression(argument)) {
          // Computed imports cannot join a static bundle; preserve their
          // original resolution base rather than resolving beside a blob URL.
          p.node.arguments[0] = types.callExpression(
            types.memberExpression(
              types.metaProperty(types.identifier("import"), types.identifier("meta")),
              types.identifier("resolve"),
            ),
            [argument, types.stringLiteral(file)],
          )
        }
      },
    },
  }
  let name = "__opencodePluginMeta"
  while (contents.includes(name)) name += "_"
  const transformed = new Bun.Transpiler({
    loader,
    target: "bun",
    define: {
      "import.meta": name,
    },
  }).transformSync(contents)
  const code = !transformed.includes(name)
    ? transformed
    : `const ${name} = { ...import.meta,
    url: ${JSON.stringify(pathToFileURL(file).href)},
    dir: ${JSON.stringify(path.dirname(file))},
    dirname: ${JSON.stringify(path.dirname(file))},
    path: ${JSON.stringify(file)},
    filename: ${JSON.stringify(file)},
    resolve: (specifier, parent) => import.meta.resolve(specifier, parent ?? ${JSON.stringify(file)}),
    require: (specifier) => import.meta.require(import.meta.resolve(specifier, ${JSON.stringify(file)})),
  };\n${transformed}`
  const result = await transformAsync(code, { filename: file, configFile: false, babelrc: false, plugins: [imports] })
  if (result?.code == null) throw new Error(`Could not transform local plugin source: ${file}`)
  return result.code
}

function isSource(file: string) {
  return !file.split(path.sep).includes("node_modules") && /\.(?:[cm]?[jt]sx?|json)$/.test(file)
}
