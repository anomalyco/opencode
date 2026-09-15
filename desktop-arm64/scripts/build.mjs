import * as esbuild from "esbuild";
import { cp, mkdir } from "node:fs/promises";

const common = {
  bundle: true,
  sourcemap: false,
  logLevel: "info",
  target: ["node22"],
};

await mkdir("dist/renderer", { recursive: true });

await esbuild.build({
  ...common,
  entryPoints: ["src/main/main.ts"],
  outfile: "dist/main/main.js",
  platform: "node",
  format: "esm",
  external: ["electron"],
});

await esbuild.build({
  ...common,
  entryPoints: ["src/main/preload.ts"],
  outfile: "dist/main/preload.cjs",
  platform: "node",
  format: "cjs",
  external: ["electron"],
});

await esbuild.build({
  ...common,
  entryPoints: ["src/renderer/app.ts"],
  outfile: "dist/renderer/app.js",
  platform: "browser",
  format: "iife",
  target: ["chrome120"],
});

await cp("src/renderer/index.html", "dist/renderer/index.html");
await cp("src/renderer/styles.css", "dist/renderer/styles.css");

console.log("build complete");
