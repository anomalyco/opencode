import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import { isCoreRuntimeModuleSpecifier, runtimeModuleIdForSpecifier } from "@opentui/core/runtime-plugin"
import { isBuiltin } from "node:module"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { localSource } from "./discovery"
import { transformAsync, types, type PluginObj } from "@babel/core"
import { additional } from "./runtime-plugin-support.bun"

// OpenTUI supplies the defaults; custom host modules come from registration.
const shared = new Set([
  ...Object.keys(additional),
  "@opentui/solid",
  "@opentui/solid/components",
  "@opentui/solid/jsx-runtime",
  "@opentui/solid/jsx-dev-runtime",
  "solid-js",
  "solid-js/store",
])

export async function prepareSource(entrypoint: string, track: (file: string, directory?: boolean) => void) {
  const solid = createSolidTransformPlugin()
  // Snapshot deferred local imports too. Evicting require.cache alone lets an
  // old callback import new code after a failed replacement, breaking fallback.
  const result = await Bun.build({
    entrypoints: [fileURLToPath(entrypoint)],
    target: "bun",
    format: "esm",
    sourcemap: "inline",
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
                return { path: external ? args.path : resolved, external }
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
  const version = URL.createObjectURL(result.outputs[0])
  return { version, dispose: () => URL.revokeObjectURL(version) }
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
    source.value =
      isCoreRuntimeModuleSpecifier(source.value) || shared.has(source.value)
        ? runtimeModuleIdForSpecifier(source.value)
        : pathToFileURL(Bun.resolveSync(source.value, path.dirname(file))).href
  }
  const resolve = (argument: types.Expression) =>
    types.callExpression(
      types.memberExpression(
        types.metaProperty(types.identifier("import"), types.identifier("meta")),
        types.identifier("resolve"),
      ),
      [argument, types.stringLiteral(file)],
    )
  const imports: PluginObj = {
    visitor: {
      ImportDeclaration: (p) => rewrite(p.node.source),
      ExportNamedDeclaration: (p) => {
        if (p.node.source) rewrite(p.node.source)
      },
      ExportAllDeclaration: (p) => rewrite(p.node.source),
      CallExpression: {
        exit: (p) => {
          if (
            p.node.callee.type !== "Import" &&
            !(p.node.callee.type === "Identifier" && p.node.callee.name === "require")
          )
            return
          const argument = p.node.arguments[0]
          if (p.node.callee.type !== "Import" && argument?.type !== "StringLiteral") return
          if (argument?.type === "StringLiteral") {
            try {
              const local = localSource(argument.value, path.dirname(file))
              if (local) Bun.resolveSync(fileURLToPath(local), path.dirname(file))
              rewrite(argument)
              return
            } catch {
              // Optional dependencies must fail inside the plugin's own runtime
              // fallback, not while visiting its source during the build.
            }
          }
          if (!types.isExpression(argument)) return
          if (p.node.callee.type === "Import") {
            // Capture arguments now, but turn resolution errors into rejected
            // promises so import(name).then(ok, fallback) keeps working.
            const parameters = [
              types.identifier("specifier"),
              ...(p.node.arguments.length > 1 ? [types.identifier("options")] : []),
            ]
            p.replaceWith(
              types.callExpression(
                types.arrowFunctionExpression(
                  parameters,
                  types.callExpression(types.import(), [resolve(parameters[0]), ...parameters.slice(1)]),
                  true,
                ),
                p.node.arguments,
              ),
            )
            p.skip()
            return
          }
          p.replaceWith(
            types.callExpression(
              types.memberExpression(
                types.metaProperty(types.identifier("import"), types.identifier("meta")),
                types.identifier("require"),
              ),
              [resolve(argument)],
            ),
          )
          p.skip()
        },
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
    : `const ${name} = { ...import.meta, url: ${JSON.stringify(pathToFileURL(file).href)}, dir: ${JSON.stringify(path.dirname(file))}, dirname: ${JSON.stringify(path.dirname(file))}, path: ${JSON.stringify(file)}, filename: ${JSON.stringify(file)}, resolve: (specifier, parent) => import.meta.resolve(specifier, parent ?? ${JSON.stringify(file)}), require: (specifier) => import.meta.require(import.meta.resolve(specifier, ${JSON.stringify(file)})) };${transformed}`
  // Keep filenames useful in stacks without adding formatter/prelude line
  // drift. Exact original lines still require composing the earlier maps.
  const result = await transformAsync(code, {
    filename: file,
    configFile: false,
    babelrc: false,
    retainLines: true,
    plugins: [imports],
  })
  if (result?.code == null) throw new Error(`Could not transform local plugin source: ${file}`)
  return result.code
}

function isSource(file: string) {
  return !file.split(path.sep).includes("node_modules") && /\.(?:[cm]?[jt]sx?|json)$/.test(file)
}
