await Bun.build({
  target: "node",
  entrypoints: ["./src/node.ts"],
  outdir: "./dist",
  format: "esm",
})
