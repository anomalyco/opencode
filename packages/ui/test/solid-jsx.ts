import { plugin } from "bun"

// Bun transpiles TSX against the tsconfig `jsxImportSource`, but `solid-js/jsx-runtime` has no runtime
// exports because Solid's compiler normally replaces JSX. Tests run without that compiler, so compile
// JSX against Solid's hyperscript runtime instead.
const transpiler = new Bun.Transpiler({
  loader: "tsx",
  trimUnusedImports: true,
  tsconfig: { compilerOptions: { jsx: "react-jsx", jsxImportSource: "solid-js/h" } },
})

plugin({
  name: "solid-jsx-runtime",
  setup(build) {
    build.onLoad({ filter: /\.[jt]sx$/ }, async (args) => ({
      contents: transpiler.transformSync(await Bun.file(args.path).text()),
      loader: "js",
    }))
  },
})
