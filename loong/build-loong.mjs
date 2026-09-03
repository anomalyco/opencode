// Build a single-file ESM bundle of opencode for loongarch64 (node runtime).
import { createRequire } from "node:module";
import * as path from "node:path";
import { promises as fs } from "node:fs";

const root = "/home/Way-Kwok_Chu/devel/opencode";
const outDir = path.join(root, "dist", "loong");

const jsxRequire = createRequire("/home/Way-Kwok_Chu/jsx-babel/x.js");
const babel = jsxRequire("@babel/core");
const tsMod = jsxRequire("@babel/preset-typescript");
const tsPreset = tsMod.default || tsMod;
const solidMod = jsxRequire("babel-preset-solid");
const solidPreset = solidMod.default || solidMod;

const esbuildDir = path.join(root, "node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild");
const repoRequire = createRequire(path.join(esbuildDir, "package.json"));
const esbuild = repoRequire(esbuildDir);

const packagesDir = path.join(root, "packages");

const solidPlugin = {
  name: "babel-solid-tsx",
  setup(build) {
    build.onLoad({ filter: /\.tsx$/ }, async (args) => {
      if (!args.path.startsWith(packagesDir)) return null;
      const src = await fs.readFile(args.path, "utf8");
      const out = await babel.transformAsync(src, {
        filename: args.path,
        configFile: false,
        babelrc: false,
        presets: [
          [solidPreset, { moduleName: "@opentui/solid", generate: "universal" }],
          [tsPreset, { allowDeclareFields: true }],
        ],
      });
      return { contents: out.code, loader: "js", resolveDir: path.dirname(args.path) };
    });
  },
};

const assetPathPlugin = {
  name: "asset-path",
  setup(build) {
    build.onLoad({ filter: /\.(wasm|mp3|node|png|jpe?g|gif|svg|bin|mp4|wav|scm)$/ }, async (args) => {
      const attrs = args.with || {};
      const type = attrs.type || attrs["type"];
      if (type === "file" || type === "wasm" || /\.(wasm|mp3)$/.test(args.path)) {
        return {
          contents:
            "export default " + JSON.stringify(args.path) + ";\nexport const path = " + JSON.stringify(args.path) + ";",
          loader: "js",
        };
      }
      return null;
    });
  },
};

const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: ["node22"],
  conditions: ["browser"],
  external: ["effect", "effect/*", "jsonc-parser", "web-tree-sitter", "@opentui/core", "@opentui/core/*"],
  alias: {
    "@": path.join(packagesDir, "opencode/src"),
    bun: path.join(root, "loong/bun-shim.mjs"),
    "bun:ffi": path.join(root, "loong/bun-ffi-shim.mjs"),
    "bun:sqlite": path.join(root, "loong/bun-sqlite-shim.mjs"),
  },
  logLevel: "info",
  sourcemap: false,
  minify: false,
  plugins: [solidPlugin, assetPathPlugin],
  legalComments: "none",
};

await fs.mkdir(outDir, { recursive: true });

console.error("[build] main bundle...");
await esbuild.build({
  ...common,
  entryPoints: [path.join(packagesDir, "opencode/src/index.ts")],
  outfile: path.join(outDir, "opencode.mjs"),
});

console.error("[build] worker bundle...");
await esbuild.build({
  ...common,
  entryPoints: [path.join(packagesDir, "opencode/src/cli/tui/worker.ts")],
  outfile: path.join(outDir, "worker.mjs"),
});

// Copy WASM files for tree-sitter
const wasmFiles = [
  "node_modules/.pnpm/web-tree-sitter@0.25.10/node_modules/web-tree-sitter/tree-sitter.wasm",
  "node_modules/.pnpm/tree-sitter-bash@0.25.0/node_modules/tree-sitter-bash/tree-sitter-bash.wasm",
  "node_modules/.pnpm/tree-sitter-powershell@0.25.10/node_modules/tree-sitter-powershell/tree-sitter-powershell.wasm",
];
for (const f of wasmFiles) {
  const src = path.join(root, f);
  const dst = path.join(outDir, path.basename(f));
  await fs.copyFile(src, dst);
  console.error("[build] copied", path.basename(f));
}

console.error("[build] done");
