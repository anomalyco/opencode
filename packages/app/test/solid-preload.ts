// Bun preload that lets `bun test` render real Solid components.
//
// `tsconfig.json` sets `"jsx": "preserve"`, so Bun falls back to the classic React transform and
// rendering throws `ReferenceError: React is not defined`. Switching to the automatic runtime does
// not help either: `solid-js/jsx-runtime` resolves to `dist/solid.js`, which exports no `jsx`/`jsxs`
// factory. Solid requires `babel-preset-solid` to compile JSX into DOM template calls.
//
// The test runner must also be given `--conditions=browser`, or `solid-js/web` resolves to the
// server build and `render()` throws "Client-only API called on the server side". See the
// `test:solid` script in `package.json`.
import { plugin } from "bun"
import path from "node:path"

// @babel/core, babel-preset-solid and @babel/preset-typescript are not direct dependencies, but
// vite-plugin-solid (which is) depends on all three, so they resolve from its directory.
const solidPluginDir = path.dirname(Bun.resolveSync("vite-plugin-solid", process.cwd()))
const babel = await import(Bun.resolveSync("@babel/core", solidPluginDir))
const presetSolid = Bun.resolveSync("babel-preset-solid", solidPluginDir)
const presetTypescript = Bun.resolveSync("@babel/preset-typescript", solidPluginDir)

plugin({
  name: "solid-tsx",
  setup(build) {
    build.onLoad({ filter: /\.tsx$/ }, async (args) => {
      const result = await babel.transformAsync(await Bun.file(args.path).text(), {
        filename: args.path,
        presets: [
          [presetTypescript, { isTSX: true, allExtensions: true }],
          [presetSolid, {}],
        ],
        babelrc: false,
        configFile: false,
        sourceMaps: "inline",
      })
      return { contents: result.code, loader: "js" }
    })
  },
})
